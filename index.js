'use strict';

function etiquetaAgente() {
  // require perezoso: estas alertas corren antes de que el resto del módulo cargue.
  try { const n = require('./negocio'); return `${n.nombreAsesora} ${n.nombreEmpresa}`; } catch { return 'agente'; }
}

function alertarTelegramCrash(tipo, err) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🚨 <b>${tipo} — ${etiquetaAgente()}</b>\n<code>${String(err?.message || err).substring(0, 400)}</code>`,
      parse_mode: 'HTML'
    })
  }).catch(() => {});
}

// Alerta genérica (no solo crashes): la usa la validación de precios y cualquier
// chequeo de calidad. Evita inundar Telegram con la misma alerta: como mucho una
// vez cada 10 minutos por título.
const _ultimaAlerta = new Map();
const _SILENCIO_ALERTA_MS = 10 * 60 * 1000;
function alertar(titulo, detalle) {
  console.error(`[ALERTA] ${titulo}:`, detalle);
  const ahora = Date.now();
  if (ahora - (_ultimaAlerta.get(titulo) ?? 0) < _SILENCIO_ALERTA_MS) return;
  _ultimaAlerta.set(titulo, ahora);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🚨 <b>${titulo} — ${etiquetaAgente()} (WhatsApp)</b>\n<code>${String(detalle).substring(0, 400)}</code>`,
      parse_mode: 'HTML'
    })
  }).catch(() => {});
}

process.on('uncaughtException', (err) => {
  console.error('[FATAL] ERROR NO CAPTURADO:', err);
  alertarTelegramCrash('ERROR CRÍTICO NO CAPTURADO', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] PROMESA RECHAZADA:', err);
  alertarTelegramCrash('PROMESA RECHAZADA', err);
});

require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const OpenAI = require('openai');
const { initDB } = require('./init-db');
const db = require('./db');
const { processRoomImage } = require('./image-processor');
const knowledge = require('./knowledge.json');
const utils = require('./utils');
const { fetchWithRetry } = require('./httpClient');
const imgHash = require('./image-hash');
const fechas = require('./fechas');
const visionCatalogo = require('./vision-catalogo');
const reintentos = require('./reintentos');
const negocio = require('./negocio');
const { construirSystemPrompt } = require('./prompt');
const vigilancia = require('./vigilancia');
const seguimientos = require('./seguimientos');
const memoria = require('./memoria');
const log = require('./log');
const { conReintentos } = reintentos;

// ─── OPENAI ──────────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sin-configurar' });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
// Para tareas simples (resumir la conversación): no hace falta el modelo grande.
const MODELO_RAPIDO = process.env.OPENAI_MODEL_RAPIDO || 'gpt-4o-mini';

// ─── INVENTARIO Y CATÁLOGOS ───────────────────────────────────────────────────

let inventario = {};
// Catálogos cargados desde BD (actualizables sin redeploy)
let catalogosDB = Object.assign({}, knowledge.catalogos || {});
// Precios válidos conocidos del inventario, para detectar precios inventados por Elena.
let preciosInventario = new Set();

// Reconstruye el Set de precios válidos a partir del inventario cargado (objeto por categoría).
function recalcularPreciosInventario() {
  const set = new Set();
  for (const cat of Object.values(inventario)) {
    for (const p of cat.productos || []) {
      const n = Number(p.precio ?? 0);
      if (n) set.add(n);
      // Los precios de las variantes también son válidos: sin esto, en cuanto Elena
      // diera el precio correcto de una medida concreta saltaría la alerta de precio
      // inventado, porque ese importe no existe como precio_base de ningún producto.
      for (const v of p.variantes || []) {
        const nv = Number(v.precio ?? 0);
        if (nv) set.add(nv);
      }
    }
  }
  preciosInventario = set;
}

// Precios válidos conocidos, inyectable para tests (en producción lo llena cargarInventario).
function setPreciosInventarioParaPruebas(nums) {
  preciosInventario = new Set(nums);
}

// Extrae montos en pesos de un texto: "$3.380.000", "3.380.000", "$780000"...
// Solo considera valores >= 10.000 para no confundir medidas ("1.80") ni cantidades.
function extraerPrecios(texto) {
  const nums = [];
  const re = /\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{5,})/g;
  let m;
  while ((m = re.exec(texto ?? '')) !== null) {
    const n = parseInt(m[1].replace(/[.,]/g, ''));
    if (n >= 10000) nums.push(n);
  }
  return nums;
}

// Monitorea precios inventados: cualquier precio en la respuesta que no exista en el
// inventario ni haya salido de una herramienta en este turno (p.ej. total de carrito)
// es sospechoso. No se bloquea el mensaje (evita romper la conversación por un falso
// positivo), pero se alerta para poder corregir el prompt si Elena empieza a inventar.
function validarPrecios(telefono, texto, preciosVistos) {
  const sospechosos = extraerPrecios(texto).filter(
    n => !preciosInventario.has(n) && !preciosVistos.has(n)
  );
  if (sospechosos.length) {
    alertar('Posible precio inventado por Elena', `tel=${telefono} precios=${sospechosos.join(', ')} | msg="${String(texto).substring(0, 160)}"`);
  }
  return sospechosos; // devuelto para poder testearlo; el caller no necesita usarlo
}

async function cargarInventario() {
  try {
    const nuevo = await db.getInventarioFromDB();
    if (nuevo && Object.keys(nuevo).length > 0) {
      inventario = nuevo;
      utils.setInventario(inventario);
      recalcularPreciosInventario();
      console.log('[INVENTARIO] ✅ Cargado:', Object.keys(inventario).length, 'categorías,', preciosInventario.size, 'precios');
    }
  } catch (err) {
    console.error('[INVENTARIO] ❌ Error:', err.message);
  }
}

// ─── HASH DE IMÁGENES DE CATÁLOGO (identificar fotos reenviadas/capturadas) ───

let hashesCatalogo = new Map(); // nombre -> { hash, imagen }

function productosPlanos() {
  const plano = [];
  for (const cat of Object.values(inventario)) {
    for (const p of cat.productos || []) {
      if (p.imagen) plano.push({ nombre: p.nombre, imagen: p.imagen });
    }
  }
  return plano;
}

async function sincronizarHashesCatalogo() {
  try {
    const existentes = await db.getHashesProductos();
    hashesCatalogo = new Map(existentes.map(r => [r.producto_nombre, { hash: r.hash, imagen: r.imagen_url }]));

    // Solo se procesan productos nuevos o cuya foto cambió — evita redescargar todo
    // el catálogo en cada refresco de inventario (cada 30 min). Además se limita
    // cuántos se procesan por ciclo: con un catálogo grande (cientos de fotos) no
    // conviene bajarlas todas de un tirón en un servidor con poca RAM — el resto
    // se completa en los siguientes ciclos.
    const LOTE_MAX = 60;
    const todosPendientes = productosPlanos().filter(p => hashesCatalogo.get(p.nombre)?.imagen !== p.imagen);
    const pendientes = todosPendientes.slice(0, LOTE_MAX);
    for (const p of pendientes) {
      try {
        const hash = await imgHash.hashDesdeUrl(p.imagen);
        await db.upsertHashProducto(p.nombre, p.imagen, hash);
        hashesCatalogo.set(p.nombre, { hash, imagen: p.imagen });
      } catch (e) {
        console.warn(`[hash-imagen] no se pudo procesar "${p.nombre}":`, e.message);
      }
      await new Promise(r => setTimeout(r, 150));
    }
    if (pendientes.length) {
      console.log(`[hash-imagen] ${pendientes.length} fotos de catálogo indexadas${todosPendientes.length > LOTE_MAX ? ` (${todosPendientes.length - LOTE_MAX} quedan para el próximo ciclo)` : ''}`);
    }
  } catch (e) {
    console.error('[hash-imagen] Error sincronizando:', e.message);
  }
}

// Identificación visual por categoría (vision-catalogo.js): clasifica el mueble de la
// foto y lo compara con las fotos de los productos de ESA categoría. Devuelve el bloque
// de contexto para el modelo, o null si no aportó nada (sin inventario, error de red…).
// Nunca rompe el flujo: si falla, la foto sigue su camino al modelo como antes.
async function identificarImagenPorCategoria(from, imagen) {
  const inventarioPlano = [];
  const categorias = [];
  for (const [clave, cat] of Object.entries(inventario)) {
    categorias.push({ clave, nombre: cat.nombre || clave });
    for (const p of cat.productos || []) {
      inventarioPlano.push({ nombre: p.nombre, imagen: p.imagen || null, medidas: p.medidas || '', material: p.material || '', precio: p.precio, categoria: clave });
    }
  }
  if (!inventarioPlano.length) return null;

  try {
    const resultado = await visionCatalogo.identificarPorVision(openai, imagen, {
      inventarioPlano,
      categorias,
      resolverPorNombre: texto => resolverProductoExacto(texto),
    });
    if (!resultado) return null;
    console.log(`[vision-catalogo] ${from}: ${resultado.tipo} · cat=${resultado.clasificacion.categorias.join(',') || '-'} · top=${resultado.coincidencias.map(c => `${c.nombre}(${c.similitud})`).join(', ') || '-'} · tokens ${resultado.tokens.entrada}/${resultado.tokens.salida}`);
    evento(from, 'vision_catalogo', `${resultado.tipo}: ${resultado.producto?.nombre ?? resultado.coincidencias[0]?.nombre ?? resultado.clasificacion.categorias.join(',') ?? '-'}`);
    const formatear = p => `${p.nombre} — ${p.precio}${p.medidas ? ` — ${p.medidas}` : ''}${p.material ? ` — ${p.material}` : ''}`;
    return visionCatalogo.construirContextoVision(resultado, formatear);
  } catch (e) {
    console.warn('[vision-catalogo] no se pudo identificar la imagen:', e.message);
    return null;
  }
}

// Compara una imagen entrante contra el catálogo indexado y devuelve el nombre
// del producto si hay coincidencia confiable (misma foto, reescalada/recomprimida/
// recortada en un screenshot), o null si no hay match.
async function identificarProductoPorImagen(buffer) {
  if (!hashesCatalogo.size) return null;
  try {
    const hashesEntrada = await imgHash.hashesCandidatos(buffer);
    const catalogoArr = [...hashesCatalogo.entries()].map(([nombre, v]) => [nombre, v.hash]);
    const match = imgHash.mejorCoincidencia(hashesEntrada, catalogoArr);
    return match?.nombre ?? null;
  } catch (e) {
    console.warn('[hash-imagen] no se pudo comparar imagen entrante:', e.message);
    return null;
  }
}

async function cargarCatalogos() {
  try {
    const [rows] = await db.pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave LIKE 'catalogo_%'"
    );
    if (rows.length > 0) {
      for (const row of rows) {
        const key = row.clave.replace('catalogo_', '');
        catalogosDB[key] = row.valor;
      }
      console.log('[CATALOGOS] ✅ Cargados', rows.length, 'catálogos desde BD');
    }
  } catch (err) {
    // Si la tabla configuracion no existe o falla, usar knowledge.json como fallback
    console.warn('[CATALOGOS] Usando fallback desde knowledge.json');
  }
}

// ─── DEDUP DE MENSAJES ───────────────────────────────────────────────────────

// MessageSid dedup: evita que reintentos de Twilio procesen el mismo mensaje dos veces
const _processedSids = new Set();
// Cuenta imágenes/capturas seguidas que la IA no logró identificar, por cliente (se resetea al reiniciar el servidor)
const _capturasNoIdentificadas = new Map();

// Evita repetir el aviso "tu mensaje fue recibido" (y la notificación al sistema de
// ventas) en cada mensaje que el cliente mande mientras espera al asesor — como mucho
// una vez cada 2 minutos por cliente.
const _avisosEsperaEnviados = new Map();
function debeEnviarAvisoEspera(telefono) {
  const ultima = _avisosEsperaEnviados.get(telefono) || 0;
  const ahora = Date.now();
  if (ahora - ultima < 2 * 60 * 1000) return false;
  _avisosEsperaEnviados.set(telefono, ahora);
  return true;
}

// Guarda en el perfil del cliente lo que se ha ido sabiendo de él. La mayor parte se captura
// sola de lo que ya pasa por las herramientas (el presupuesto de buscar_por_presupuesto, los
// productos que se le muestran, el nombre al agendar): solo lo cualitativo necesita que el
// modelo lo cuente con recordar_preferencia. Nunca debe romper el turno.
async function actualizarPerfil(from, cambios) {
  try {
    const actual = await db.getPerfil(from);
    await db.setPerfil(from, memoria.fusionarPerfil(actual, cambios));
  } catch (e) {
    console.warn('[memoria] no se pudo actualizar el perfil:', e.message);
  }
}

// Lo que core/seguimientos.js necesita del agente para hacer su trabajo: cómo enviar, cómo
// saber si se puede escribir y cómo consultar la base de datos. Se pasa como dependencias
// para que el módulo se pueda probar entero sin red ni BD.
function depsSeguimientos() {
  return {
    db,
    // Sin toNumber (esto no nace de un webhook), enviarTexto cae a TWILIO_WHATSAPP_NUMBER:
    // por eso esa variable es obligatoria si se usan seguimientos.
    enviar: (telefono, texto) => enviarTexto(`whatsapp:${String(telefono).replace('whatsapp:', '')}`, null, texto),
    minutosDesdeUltimoMensaje: telefono => db.minutosDesdeUltimaInteraccion(telefono),
    hayAsesorAtendiendo: async telefono => (await db.estaTransferida(telefono)) || (await db.tomadaPorAsesor(telefono)),
    guardarEnHistorial: (telefono, texto) => db.addMensaje(`whatsapp:${String(telefono).replace('whatsapp:', '')}`, 'assistant', texto).catch(() => {}),
    evento: (telefono, tipo, detalle) => evento(telefono, tipo, detalle),
  };
}

// Minutos que el cliente llevaba sin escribir, medidos al entrar el turno (antes de
// refrescar last_interaction). Los consume runAgentLoop y se borran al usarlos.
const _ausenciaTurno = new Map();

// Fallos técnicos recientes por cliente: sirve para escalar a un asesor solo si el
// problema se repite, en vez de crear una tarjeta en el primer tropiezo de red.
const _fallosTecnicos = new Map();
const _VENTANA_FALLO_MS = 10 * 60 * 1000;
function registrarFalloTecnico(telefono) {
  const previo = _fallosTecnicos.get(telefono);
  const ahora = Date.now();
  _fallosTecnicos.set(telefono, ahora);
  if (_fallosTecnicos.size > 500) {
    for (const [k, t] of _fallosTecnicos) if (ahora - t > _VENTANA_FALLO_MS) _fallosTecnicos.delete(k);
  }
  return !!previo && ahora - previo < _VENTANA_FALLO_MS;
}

function yaFueProcesado(sid) {
  if (!sid) return false;
  if (_processedSids.has(sid)) return true;
  _processedSids.add(sid);
  // Limpiar SIDs viejos si el set crece demasiado
  if (_processedSids.size > 500) {
    const iter = _processedSids.values();
    for (let i = 0; i < 100; i++) _processedSids.delete(iter.next().value);
  }
  return false;
}

// ─── BUFFER DE RÁFAGAS + COLA SERIALIZADA POR CLIENTE ────────────────────────

// En WhatsApp la gente escribe en burbujas sueltas ("hola" / "quiero una cama" / "de
// 2 metros"), o manda una foto y justo después el texto que la explica. Antes cada
// burbuja disparaba su propio turno y, peor, un cooldown de 1,5 s DESCARTABA en
// silencio las que llegaran seguidas: el cliente escribía tres cosas y Elena solo veía
// la primera. Ahora se acumula toda la ráfaga en una ventana de debounce y se procesa
// como un único turno, con todo el contexto junto y una sola respuesta.
//
// Además el procesamiento de un mismo cliente se serializa: sin esto, dos ráfagas
// seguidas podían correr en paralelo y escribir el historial intercalado, dejando la
// conversación en un orden que no ocurrió.
const DEBOUNCE_MS = 2800;
const _buffers = new Map(); // telefono -> { textos, media, toNumber, timer }
const _colas   = new Map(); // telefono -> Promise (cadena de ejecución)

// Encadena la tarea después de la última del mismo cliente (mutex por teléfono).
// La cadena que se guarda va siempre "silenciada": si una tarea falla, la siguiente
// debe correr igual y el rechazo no puede quedar sin manejar — un unhandledRejection
// aquí tumbaría el proceso entero y con él las conversaciones de todos los clientes.
function encolar(telefono, tarea) {
  const anterior = _colas.get(telefono) ?? Promise.resolve();
  const cadena   = anterior.then(tarea, tarea).catch(e => {
    console.error(`[COLA] tarea de ${telefono} falló:`, e?.message ?? e);
  });
  _colas.set(telefono, cadena);
  cadena.finally(() => { if (_colas.get(telefono) === cadena) _colas.delete(telefono); });
  return cadena;
}

// Punto de entrada desde el webhook. Acumula lo que llegue dentro de la ventana y lo
// procesa una sola vez.
function recibirMensaje({ from, toNumber, texto, mediaUrl, mediaType, profileName }) {
  let buf = _buffers.get(from);
  if (!buf) {
    buf = { textos: [], media: null, toNumber, profileName: null, timer: null };
    _buffers.set(from, buf);
  }

  if (toNumber) buf.toNumber = toNumber;
  if (profileName) buf.profileName = profileName;
  if (texto) buf.textos.push(texto);
  // Si en la misma ráfaga llegan varios adjuntos se conserva el último; lo normal es
  // uno solo por turno, y el texto que lo acompaña sí se acumula entero.
  if (mediaUrl) buf.media = { mediaUrl, mediaType };

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => {
    _buffers.delete(from);
    encolar(from, () => procesarMensaje({
      from,
      toNumber:    buf.toNumber,
      incomingMsg: buf.textos.join('\n'),
      mediaUrl:    buf.media?.mediaUrl ?? null,
      mediaType:   buf.media?.mediaType ?? null,
      profileName: buf.profileName,
    }).catch(e => {
      console.error('[ERROR] procesarMensaje:', e.message, e.stack?.split('\n')[1]);
      alertar('procesarMensaje falló', `${from} — ${e.message}`);
    }));
  }, DEBOUNCE_MS);
}

// ─── EXPRESS & TWILIO VALIDATION ─────────────────────────────────────────────

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function validateTwilioRequest(req, res, next) {
  if (!process.env.TWILIO_AUTH_TOKEN) return next();
  const twilioSignature = req.headers['x-twilio-signature'];
  if (!twilioSignature) {
    if (req.body?.From) return res.status(403).send('Forbidden');
    return next();
  }
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const url = `${proto}://${host}${req.originalUrl}`;
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN, twilioSignature, url, req.body
  );
  if (!isValid) return res.status(403).send('Forbidden');
  next();
}

app.use(validateTwilioRequest);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parsearPrecio(precio) {
  const m = String(precio || '').match(/\d[\d.]*/);
  return m ? parseInt(m[0].replace(/\./g, '')) : 0;
}

// Formato de moneda según el locale configurado para el negocio.
function formatearMoneda(valor) {
  return negocio.formatearMoneda(valor);
}

// Normaliza texto para búsquedas (elimina acentos, caracteres especiales)
function normalizarTexto(texto) {
  return String(texto || '').toLowerCase()
    .replace(/[aáàäâ]/g, 'a').replace(/[eéèëê]/g, 'e')
    .replace(/[iíìïî]/g, 'i').replace(/[oóòöô]/g, 'o')
    .replace(/[uúùüû]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Distancia de edición (Levenshtein) para tolerar erratas y variantes fonéticas al
// buscar ("fiji" → "figy", "comedro" → "comedor"). Corte rápido si difieren mucho en
// largo, para no gastar cómputo en pares que nunca van a coincidir.
function distanciaEdicion(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + costo);
    }
    prev = cur;
  }
  return prev[n];
}

// ¿La palabra de la consulta "casa" con algún token del nombre del producto? Acepta:
//  - subcadena exacta (comportamiento anterior),
//  - misma palabra pegada o separada ("sofacama" ↔ "sofa cama"),
//  - erratas/variantes fonéticas cercanas ("fiji" ↔ "figy"): mismo prefijo de 2 letras
//    y a lo sumo 2 ediciones de diferencia (la guarda de prefijo evita falsos positivos).
function tokenCoincide(p, tokensNombre, nombreCompacto) {
  if (p.length < 3) return false;
  if (nombreCompacto.includes(p)) return true;
  for (const t of tokensNombre) {
    if (t.length < 3) continue;
    if (t.includes(p) || p.includes(t)) return true;
    if (p.length >= 4 && t.length >= 4 &&
        p.slice(0, 2) === t.slice(0, 2) &&
        distanciaEdicion(p, t) <= 2) return true;
  }
  return false;
}

// Sedes, categorías y demás datos del negocio salen de negocio.json (ver negocio.js):
// para desplegar el agente para otro cliente se edita ese archivo, no este código.
const { UBICACIONES, SEDE_NOMBRE, SEDE_TIENDA_ID } = negocio;

// ─── NOTIFICACIONES → SISTEMA DE VENTAS DECASA ───────────────────────────────

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor', extra = {}) {
  const apiUrl   = process.env.DECASA_API_URL;
  const apiToken = process.env.DECASA_AGENT_TOKEN;
  if (!apiUrl) {
    console.warn('[REDES] DECASA_API_URL no configurado — notificación omitida');
    return;
  }

  const telefonoLimpio = telefono.replace(/\D/g, '');
  // El nombre que dio el cliente al agendar manda; si no hay, se usa el de su perfil de
  // WhatsApp (ProfileName), para que el asesor no reciba solo un número.
  const nombreCliente  = extra.nombre || await db.getNombreCliente(telefono);
  const whatsappUrl    = `https://wa.me/${telefonoLimpio}`;

  const titulos = {
    asesor:         'Solicitud de asesor',
    pedido:         'Nuevo pedido confirmado',
    cita:           'Nueva cita agendada',
    personalizacion: 'Solicitud de personalización'
  };

  let resumen = titulos[tipo] || 'Notificación';
  if (extra.producto) resumen += ` — ${extra.producto}`;
  if (mensaje)        resumen += `\n${String(mensaje).substring(0, 300)}`;

  const payload = {
    tipo:           tipo,
    telefono:       telefono.replace('whatsapp:', ''),
    nombre_cliente: nombreCliente,
    resumen:        resumen,
    historial:      (historial || []).slice(-8).map(m => ({ role: m.role, content: String(m.content).substring(0, 150) })),
    whatsapp_url:   whatsappUrl,
    contacto_url:   whatsappUrl,
    fuente:         'whatsapp',
    ...(extra.carrito    && { carrito:    extra.carrito }),
    ...(extra.datos_cita && { datos_cita: extra.datos_cita }),
    ...(extra.tienda_id  && { tienda_id:  extra.tienda_id }),
  };

  // El error se PROPAGA a propósito: quien llama (notificarRedes) lo necesita para
  // encolar el reintento. Si se tragara aquí, un fallo de la API haría desaparecer la
  // solicitud del asesor sin que nadie se entere.
  await fetchWithRetry(`${apiUrl}/api/redes/webhook`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Token': apiToken || '' },
    body:    JSON.stringify(payload)
  }, 2, 25000);
  console.log(`[REDES] Notificación ${tipo} enviada al sistema`);
}

// Notifica al sistema de ventas SIN bloquear la respuesta al cliente: el envío puede
// tardar hasta ~56 s (timeout de 25 s + reintento) y no tiene sentido que el cliente
// espere todo eso para leer "voy a conectarte con un asesor". Si el envío directo
// falla, la notificación se encola en BD para que el worker la reintente con backoff
// en vez de perderse.
function notificarRedes(telefono, mensaje, historial, tipo = 'asesor', extra = {}) {
  enviarNotificacionTelegram(telefono, mensaje, historial, tipo, extra)
    .catch(async e => {
      console.warn(`[REDES] envío directo falló (${tipo} ${telefono}), encolando para reintento:`, e.message);
      try {
        await db.encolarNotificacion(telefono, tipo, {
          mensaje,
          extra,
          historial: (historial || []).slice(-8).map(m => ({ role: m.role, content: String(m.content).substring(0, 150) })),
        });
      } catch (enqErr) {
        alertar(`No se pudo encolar notificación ${tipo}`, `${telefono} — ${enqErr.message}`);
      }
    });
}

// ¿El sistema de ventas rechazó la notificación de forma definitiva? Un 4xx (payload
// inválido, tipo desconocido, token equivocado) no se arregla reintentando; un 408/429 sí.
// El mensaje de error viene de fetchWithRetry con la forma "HTTP 422 ...".
function esRechazoPermanente(e) {
  const m = /HTTP (\d{3})/.exec(String(e?.message ?? ''));
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

// Worker: reintenta las notificaciones encoladas. Corre en intervalo desde startServer.
let _procesandoCola = false;
async function procesarColaNotificaciones() {
  if (_procesandoCola) return; // evita solapamiento si un ciclo tarda más que el intervalo
  _procesandoCola = true;
  try {
    const pendientes = await db.getNotificacionesPendientes(10);
    for (const n of pendientes) {
      const { mensaje, extra, historial } = n.payload;
      try {
        await enviarNotificacionTelegram(n.telefono, mensaje, historial ?? [], n.tipo, extra ?? {});
        await db.eliminarNotificacion(n.id);
        console.log(`[REDES] notificación encolada #${n.id} (${n.tipo}) enviada tras reintento`);
      } catch (e) {
        const intentos = (n.intentos ?? 0) + 1;
        // Un rechazo permanente (payload inválido, tipo desconocido, token equivocado) no
        // se arregla repitiéndolo: antes se reintentaba durante más de un día y la alerta
        // llegaba cuando ya nadie se acordaba del cliente. Se avisa al primer intento.
        if (esRechazoPermanente(e)) {
          await db.eliminarNotificacion(n.id);
          alertar(`Notificación ${n.tipo} RECHAZADA por el sistema de ventas`, `${n.telefono}: ${e.message} — revisar payload/tipo; hay que crear la tarjeta a mano`);
        } else if (intentos >= 8) {
          // El backoff llega hasta 2 h entre intentos; 8 intentos es más de un día.
          await db.eliminarNotificacion(n.id);
          alertar(`Notificación ${n.tipo} descartada tras ${intentos} intentos`, `${n.telefono}: ${e.message}`);
        } else {
          await db.reprogramarNotificacion(n.id, intentos, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[REDES] error procesando cola:', e.message);
  } finally {
    _procesandoCola = false;
  }
}

// ─── ENVÍO SALIENTE (Twilio REST) ────────────────────────────────────────────

// Todas las respuestas salen por la API REST, no por TwiML. TwiML obliga a contestar
// dentro de la ventana del webhook (Twilio corta a los 15 s), y eso dejaba sin
// respuesta cualquier consulta que necesitara varias rondas de herramientas. Por REST
// el webhook se cierra al instante y el mensaje se envía cuando esté listo, sin techo
// de tiempo — es el mismo patrón que ya usaban los flujos de imagen y audio.
let _twilioClient = null;
function getTwilioClient() {
  if (!_twilioClient) {
    _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _twilioClient;
}

// WhatsApp rechaza cuerpos de más de 1600 caracteres. Elena responde corto, pero una
// comparación larga o un listado puede pasarse: se parte por párrafos (y si un párrafo
// solo ya es enorme, por frases) en vez de perder el mensaje entero.
const LIMITE_WHATSAPP = 1500;
function trocearTexto(texto) {
  if (texto.length <= LIMITE_WHATSAPP) return [texto];
  const partes = [];
  let actual = '';
  for (const bloque of texto.split(/\n\n+/)) {
    const trozos = bloque.length > LIMITE_WHATSAPP
      ? bloque.match(new RegExp(`[\\s\\S]{1,${LIMITE_WHATSAPP}}(?=\\s|$)|[\\s\\S]{1,${LIMITE_WHATSAPP}}`, 'g')) ?? [bloque]
      : [bloque];
    for (const trozo of trozos) {
      if (actual && actual.length + trozo.length + 2 > LIMITE_WHATSAPP) {
        partes.push(actual);
        actual = trozo;
      } else {
        actual = actual ? `${actual}\n\n${trozo}` : trozo;
      }
    }
  }
  if (actual) partes.push(actual);
  return partes;
}

// Número propio desde el que se responde. Normalmente llega en el webhook (campo To);
// el env var es la red de seguridad para los casos en que Twilio no lo mande.
function numeroSalida(toNumber) {
  return toNumber || process.env.TWILIO_WHATSAPP_NUMBER || '';
}

// Devuelve true solo si el mensaje salió de verdad. Antes se tragaba el error y quien
// llamaba guardaba la respuesta en el historial como si el cliente la hubiera recibido:
// en el turno siguiente Elena daba por dicho algo que nunca llegó, y nadie se enteraba
// del envío fallido.
async function enviarTexto(from, toNumber, texto) {
  if (!texto || !String(texto).trim()) return false;
  const desde = numeroSalida(toNumber);
  if (!desde) {
    alertar('No se pudo responder al cliente', `Sin número de salida (To vacío y TWILIO_WHATSAPP_NUMBER sin configurar) — ${from}`);
    return false;
  }
  try {
    const cliente = getTwilioClient();
    // Con reintentos: un 5xx o un rate limit puntual de Twilio dejaba al cliente sin
    // respuesta aunque el turno se hubiera completado entero.
    for (const parte of trocearTexto(String(texto).trim())) {
      await conReintentos(
        () => cliente.messages.create({ from: desde, to: from, body: parte }),
        { intentos: 3, baseMs: 600, contexto: `twilio texto ${from}` }
      );
    }
    return true;
  } catch (e) {
    console.error('[TWILIO] Error enviando texto:', e.message, e.code || '', e.status || '');
    alertar('No se pudo entregar la respuesta al cliente', `${from} — ${e.message} (code ${e.code ?? '-'})`);
    return false;
  }
}

// Envía un mensaje adicional via Twilio (para fotos de productos y catálogos)
async function enviarMensajeAdicional(from, toNumber, body, mediaUrl) {
  try {
    const msg = { from: numeroSalida(toNumber), to: from };
    if (body) msg.body = body;
    if (mediaUrl) msg.mediaUrl = [mediaUrl];
    await getTwilioClient().messages.create(msg);
  } catch (e) {
    console.error('[TWILIO] Error enviando mensaje adicional:', e.message, e.code || '', e.status || '');
  }
}

// ─── VARIANTES DE PRECIO ──────────────────────────────────────────────────────

// Traduce las variantes de un producto a los campos que ve el modelo. La regla clave:
// si las opciones tienen precios distintos, NO se le entrega un `precio` suelto — se le
// da el rango y la lista, para que no pueda comprometer un importe que solo vale para
// una de las medidas. Si todas cuestan igual (color, acabado), el precio es único y las
// opciones son solo información que enriquece la respuesta.
function infoPrecioVariantes(p) {
  const variantes = (p.variantes || []).filter(v => v.etiqueta && v.precio > 0);
  if (variantes.length === 0) return { precio: p.precio };

  const precios = [...new Set(variantes.map(v => v.precio))];
  const opciones = variantes.map(v => ({ opcion: v.etiqueta, precio: v.precio }));

  if (precios.length === 1) {
    return {
      precio: p.precio,
      opciones: variantes.map(v => v.etiqueta),
      tipo_opcion: variantes[0].tipo,
    };
  }

  return {
    precio: null,
    precio_desde: Math.min(...precios),
    precio_hasta: Math.max(...precios),
    tipo_variante: variantes[0].tipo,
    variantes: opciones,
    nota_variantes: 'Este producto tiene varias opciones con PRECIOS DISTINTOS. No des un precio único ni menciones solo el más bajo como si fuera el precio: dile el rango (desde X hasta Y), enumera las opciones disponibles y pregúntale cuál necesita. Cuando la elija, dale el precio exacto de ESA opción.',
  };
}

// Precio con el que comparar contra el presupuesto del cliente: el más bajo al que
// puede llevarse el producto.
function precioMinimo(p) {
  const variantes = (p.variantes || []).filter(v => v.precio > 0);
  if (!variantes.length) return parsearPrecio(p.precio);
  return Math.min(...variantes.map(v => v.precio));
}

// Busca una variante por lo que escribió el cliente ("1.60", "6 pts", "flor morado").
// Tolerante con la puntuación porque en la BD conviven "1,40", "1.40" y "160".
function encontrarVariante(producto, textoVariante) {
  const variantes = (producto?.variantes || []).filter(v => v.etiqueta && v.precio > 0);
  if (!variantes.length || !textoVariante) return null;
  const norm = s => normalizarTexto(String(s)).replace(/[.,\s]/g, '');
  const buscado = norm(textoVariante);
  if (!buscado) return null;

  const exacta = variantes.find(v => norm(v.etiqueta) === buscado);
  if (exacta) return exacta;

  // Coincidencia parcial solo si es INEQUÍVOCA. Antes "2" (de "la de 2 metros") hacía
  // match con la primera etiqueta que contuviera un 2 ("1.20", la más barata) y el
  // pedido salía con la medida y el precio equivocados. Con varias candidatas se
  // devuelve null para que la herramienta le pida al cliente que elija.
  const parciales = variantes.filter(v => {
    const e = norm(v.etiqueta);
    return e.includes(buscado) || buscado.includes(e);
  });
  return parciales.length === 1 ? parciales[0] : null;
}

// ─── BÚSQUEDA EN INVENTARIO ───────────────────────────────────────────────────

// El cliente pide "4 puestos/personas" y en el catálogo eso vive en medidas como
// "(4 Puestos)". Da un empujón fuerte al producto cuyo nº de puestos coincide, para
// que las bases del tamaño pedido queden de primeras.
function boostPuestos(q, medidas) {
  const pedido = q.match(/(\d+)\s*(puesto|persona|sitio)/);
  if (!pedido) return 0;
  return new RegExp('\\b' + pedido[1] + '\\s*puesto').test(normalizarTexto(medidas || '')) ? 45 : 0;
}

// "redonda/circular/forma de copa/pedestal": en el catálogo las bases redondas de
// pedestal dicen "Diametro" en medidas (o "REDONDA" en el nombre). Sin esto, "mesa
// redonda" o "en forma de copa" no encontraban ninguna.
function boostForma(q, medidas, nombre) {
  if (!/\b(redond[oa]|circular|copa|pedestal|columna)\b/.test(q)) return 0;
  return (normalizarTexto(medidas || '').includes('diametro') || /redond/.test(normalizarTexto(nombre || ''))) ? 35 : 0;
}

function buscarEnInventario(consulta, categoria, limite = 6) {
  const q = normalizarTexto(consulta);
  // Se conservan los números de 1 dígito (p.ej. "4" puestos); las demás palabras deben
  // tener ≥2 letras para no meter ruido.
  const palabras = q.split(/\s+/).filter(p => p.length >= 2 || /^\d+$/.test(p));

  const cats = categoria && inventario[categoria]
    ? { [categoria]: inventario[categoria] }
    : inventario;

  const resultados = [];
  for (const [catKey, catData] of Object.entries(cats)) {
    if (!catData?.productos) continue;
    for (const prod of catData.productos) {
      const nombre = normalizarTexto(prod.nombre);
      const material = normalizarTexto(prod.material || '');
      const medidas = normalizarTexto(prod.medidas || '');
      const tokensNombre = nombre.split(/\s+/).filter(Boolean);
      const nombreCompacto = nombre.replace(/\s+/g, '');
      let score = 0;
      for (const p of palabras) {
        if (nombre.includes(p)) score += p.length * 2;
        // Coincidencia difusa en el nombre (pegado/separado o errata): casi tanto peso
        // como la exacta, para que "sofacama" o "fiji" encuentren su producto.
        else if (tokenCoincide(p, tokensNombre, nombreCompacto)) score += p.length * 2 - 1;
        else if (material.includes(p)) score += p.length;
        else if (medidas.includes(p)) score += p.length;
      }
      // Empujones por nº de puestos y forma (comedores) — clave para "4 puestos",
      // "mesa redonda", "en forma de copa".
      score += boostPuestos(q, prod.medidas);
      score += boostForma(q, prod.medidas, prod.nombre);
      if (score > 0) {
        resultados.push({
          nombre: prod.nombre, precio: prod.precio,
          material: prod.material || null, medidas: prod.medidas || null,
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null, imagen2: prod.imagen2 || null,
          variantes: prod.variantes || [],
          categoria: catKey, categoriaNombre: catData.nombre, score
        });
      }
    }
  }

  // Si no hay resultados por nombre y hay categoría, devolver todos de esa cat
  if (resultados.length === 0 && categoria && inventario[categoria]) {
    return inventario[categoria].productos.slice(0, limite).map(p => ({
      nombre: p.nombre, precio: p.precio,
      material: p.material || null, medidas: p.medidas || null,
      tieneImagen: !!p.imagen, imagen: p.imagen || null, imagen2: p.imagen2 || null,
      variantes: p.variantes || [],
      categoria, categoriaNombre: inventario[categoria].nombre, score: 0
    }));
  }

  return resultados.sort((a, b) => b.score - a.score).slice(0, limite);
}

function buscarEnInventarioPorPresupuesto(presupuestoMax, categoria, limite = 5) {
  const cats = categoria && inventario[categoria]
    ? { [categoria]: inventario[categoria] }
    : inventario;

  const resultados = [];
  for (const [catKey, catData] of Object.entries(cats)) {
    if (!catData?.productos) continue;
    for (const prod of catData.productos) {
      // Con variantes cuenta el precio de entrada: si el cliente tiene $3.000.000 y la
      // cama en 1.40 vale $2.980.000, el producto entra aunque la de 2 metros se pase.
      const precio = precioMinimo(prod);
      if (precio > 0 && precio <= presupuestoMax) {
        resultados.push({
          nombre: prod.nombre, precio: prod.precio, precioNumerico: precio,
          material: prod.material || null, medidas: prod.medidas || null,
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null, imagen2: prod.imagen2 || null,
          variantes: prod.variantes || [],
          categoria: catKey, categoriaNombre: catData.nombre
        });
      }
    }
  }
  // Ordenar del más cercano al presupuesto al más barato
  return resultados
    .sort((a, b) => b.precioNumerico - a.precioNumerico)
    .slice(0, limite);
}

// Resuelve UN producto del inventario con certeza a partir de un nombre. Para acciones
// que el cliente ve o que generan dinero (foto, carrito, pedido) no vale el "más
// parecido" de buscarEnInventario: se exige que lo pedido esté de verdad en el nombre.
// `soloConImagen` restringe a productos con foto (para enviar_foto).
function resolverProductoExacto(nombreProducto, { soloConImagen = false } = {}) {
  const q = normalizarTexto(nombreProducto);
  const palabras = q.split(/\s+/).filter(p => p.length >= 2);
  if (!q) return null;

  let mejor = null, mejorScore = 0;
  for (const catData of Object.values(inventario)) {
    for (const prod of (catData.productos || [])) {
      if (soloConImagen && !prod.imagen) continue;
      const nombre = normalizarTexto(prod.nombre);
      const tokensNombre = nombre.split(/\s+/).filter(Boolean);
      const nombreCompacto = nombre.replace(/\s+/g, '');
      let score = 0;
      // El nombre exacto manda sobre cualquier parecido (ver buscarImagenProducto).
      if (nombre === q) score += 1000;
      for (const p of palabras) {
        if (nombre.includes(p)) score += p.length * 2;
        else if (tokenCoincide(p, tokensNombre, nombreCompacto)) score += p.length * 2 - 1;
      }
      // A igualdad de puntos gana el nombre más corto: añade menos palabras no pedidas.
      if (score > mejorScore || (score === mejorScore && score > 0 && mejor && nombre.length < normalizarTexto(mejor.nombre).length)) {
        mejorScore = score; mejor = prod;
      }
    }
  }
  if (!mejor) return null;

  // Lo pedido tiene que estar realmente en el nombre (tolerando nombres pegados, no
  // erratas): "nevera" está a dos letras de "negra" y colaba una LAMPARA DE MESA NEGRA.
  const nombreMejor   = normalizarTexto(mejor.nombre);
  const compactoMejor = nombreMejor.replace(/\s+/g, '');
  const significativas = palabras.filter(p => p.length >= 3);
  if (significativas.length) {
    const cubiertas = significativas.filter(p => nombreMejor.includes(p) || compactoMejor.includes(p)).length;
    if (cubiertas / significativas.length < 0.6) return null;
  }
  return mejor;
}

function buscarImagenProducto(nombreProducto) {
  const q = normalizarTexto(nombreProducto);
  const palabras = q.split(/\s+/).filter(p => p.length >= 2);

  let mejor = null, mejorScore = 0;
  for (const catData of Object.values(inventario)) {
    for (const prod of (catData.productos || [])) {
      if (!prod.imagen) continue;
      const nombre = normalizarTexto(prod.nombre);
      const tokensNombre = nombre.split(/\s+/).filter(Boolean);
      const nombreCompacto = nombre.replace(/\s+/g, '');
      let score = 0;
      // El nombre exacto manda sobre cualquier parecido. Sin esto, "SOFA TORELLO" y
      // "SOFA CAMA TORELLO DOS PUESTOS" empataban (ambos contienen las dos palabras
      // pedidas) y ganaba el que saliera antes al recorrer el inventario: pedir la foto
      // del SOFA TORELLO mandaba la del sofá cama. Afectaba a 11 productos reales.
      if (nombre === q) score += 1000;
      for (const p of palabras) {
        if (nombre.includes(p)) score += p.length * 2;
        else if (tokenCoincide(p, tokensNombre, nombreCompacto)) score += p.length * 2 - 1;
      }
      // A igualdad de puntos gana el nombre más corto: es el que añade menos palabras
      // que el cliente no pidió.
      if (score > mejorScore || (score === mejorScore && score > 0 && mejor && nombre.length < normalizarTexto(mejor.nombre).length)) {
        mejorScore = score; mejor = prod;
      }
    }
  }
  if (!mejor) return null;

  // Que haya "algo de parecido" no basta para mandarle una foto al cliente: con el
  // score suelto, pedir "nevera" enviaba la foto de una LAMPARA DE MESA NEGRA y
  // "televisor" la de una SILLA AUX ELE. Se exige que lo pedido esté de verdad en el
  // nombre del producto (tolerando nombres pegados, pero no erratas: "nevera" está a
  // dos letras de "negra"). Las erratas de quien escribe las absorbe buscar_productos,
  // que es donde un resultado aproximado sí tiene sentido.
  const nombreMejor   = normalizarTexto(mejor.nombre);
  const compactoMejor = nombreMejor.replace(/\s+/g, '');
  const significativas = palabras.filter(p => p.length >= 3);
  if (significativas.length) {
    const cubiertas = significativas.filter(p => nombreMejor.includes(p) || compactoMejor.includes(p)).length;
    if (cubiertas / significativas.length < 0.6) return null;
  }

  return { nombre: mejor.nombre, imagen: mejor.imagen, imagen2: mejor.imagen2 || null };
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

// El system prompt se genera desde la configuración del negocio (ver prompt.js y
// negocio.json). Antes eran ~120 líneas con los datos de DeCasa escritos a mano aquí y
// otras tantas en el agente de Instagram, que ya habían divergido entre sí.
function buildSystemPrompt() {
  return construirSystemPrompt('whatsapp');
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el catálogo por nombre, descripción o categoría. Entiende también el número de puestos de una mesa/comedor ("4 puestos", "6 personas") y la forma ("redonda", "en forma de copa", "ovalada") — inclúyelos en la consulta tal como los dijo el cliente. Solo devuelve precio, material y medidas. NO incluye stock ni disponibilidad en tiendas.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Texto de búsqueda: nombre, descripción, nº de puestos o forma (ej: "cama doble", "comedor 4 puestos", "mesa redonda", "base en forma de copa", "sofa modular")'
          },
          categoria: {
            type: 'string',
            description: 'Categoría para filtrar (opcional): camas, bases_comedores, sillas_comedor, sillas_auxiliares, sillas_barra, mesas_centro, mesas_auxiliares, mesas_noche, mesas_tv, sofas, sofas_modulares, sofas_camas, cajoneros_bifes, escritorios, colchones'
          },
          limite: { type: 'number', description: 'Máximo de resultados (default 5, max 10)' }
        },
        required: ['consulta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'buscar_por_presupuesto',
      description: 'Busca productos dentro del presupuesto del cliente. Úsalo cuando el cliente mencione un límite de precio o pida opciones económicas.',
      parameters: {
        type: 'object',
        properties: {
          presupuesto_max: {
            type: 'number',
            description: 'Presupuesto máximo en pesos colombianos, sin puntos ni símbolo $ (ej: 2000000 para $2.000.000)'
          },
          categoria: {
            type: 'string',
            description: 'Categoría específica para filtrar (opcional)'
          }
        },
        required: ['presupuesto_max']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'consultar_estado',
      description: 'Consulta el estado actual del cliente: carrito, citas agendadas y último producto visto. Úsalo cuando el cliente pregunte por su carrito, sus citas o quiera retomar una conversación.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ver_carrito',
      description: 'Muestra los productos en el carrito del cliente con precios y total.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agregar_al_carrito',
      description: 'Agrega un producto al carrito. SOLO cuando el cliente haya confirmado explícitamente que quiere ese producto.',
      parameters: {
        type: 'object',
        properties: {
          producto: { type: 'string', description: 'Nombre exacto del producto tal como aparece en el inventario' },
          precio: { type: 'string', description: 'Precio del producto tal como aparece en el inventario (ej: "$1.200.000")' },
          variante: { type: 'string', description: 'Opción elegida por el cliente cuando el producto tiene variantes con precios distintos (ej: "1.60", "6 pts", "piedra sinterizada"). Obligatorio en esos productos: sin ella no se puede saber el precio.' },
          cantidad: { type: 'number', description: 'Cantidad a agregar (default: 1)' }
        },
        required: ['producto', 'precio']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'quitar_del_carrito',
      description: 'Quita un producto del carrito o vacía todo el carrito.',
      parameters: {
        type: 'object',
        properties: {
          producto: { type: 'string', description: 'Nombre (parcial) del producto a quitar. Omitir para vaciar todo el carrito.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'confirmar_pedido',
      description: 'Confirma la compra de todos los productos en el carrito. Solo cuando el cliente diga que quiere finalizar/confirmar la compra.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enviar_foto',
      description: 'Envía la foto de un producto al cliente. Puedes llamar esta función varias veces si el cliente quiere ver múltiples productos.',
      parameters: {
        type: 'object',
        properties: {
          nombre_producto: { type: 'string', description: 'Nombre del producto cuya foto se quiere enviar' }
        },
        required: ['nombre_producto']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'enviar_catalogo',
      description: 'Envía el catálogo PDF de una categoría al cliente.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description: 'Categoría del catálogo: sofas, bases_comedores, sillas_comedor, sillas_auxiliares, sillas_barra, mesas_centro, mesas_noche, mesas_tv, camas, sofas_camas, sofas_modulares, mesas_auxiliares, cajoneros_bifes'
          }
        },
        required: ['categoria']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reportar_imagen_no_identificada',
      description: 'Llama esta función SIEMPRE que analices una imagen (foto o captura de pantalla) y NO puedas identificar con confianza qué producto es, incluso después de intentar leer el texto visible y clasificar el tipo de mueble. Es solo para seguimiento interno, no se le muestra al cliente tal cual.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'agendar_cita',
      description: 'Guarda una cita de visita a tienda. Recopila TODA la info primero y luego llama esta función. El nombre debe ser solo el nombre (sin "me llamo" ni "mi nombre es").',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo del cliente (solo el nombre, sin frases introductorias)' },
          ubicacion: { type: 'number', description: 'Número de sede (1-5)' },
          dia: { type: 'string', description: 'Fecha de la visita con día de la semana, número de día, mes y año (ej: "miércoles 3 de junio de 2026", "lunes 20 de julio de 2026"). SIEMPRE incluye el año. NUNCA inventes ni asumas el año — confírmalo con el cliente si es ambiguo.' },
          hora: { type: 'string', description: 'Hora en formato HH:MM (ej: "14:00", "09:30")' },
          motivo: { type: 'string', description: 'Motivo de la visita (opcional, solo si el cliente lo menciona)' }
        },
        required: ['nombre', 'ubicacion', 'dia', 'hora']
      }
    }
  },
  {
    type: 'function',
      function: {
      name: 'cancelar_cita',
      description: 'Cancela una cita ya agendada del cliente. Úsalo cuando diga que no puede ir, que quiere cancelar o que quiere cambiar la fecha/hora de su visita (para cambiarla: primero cancela y luego agenda la nueva con agendar_cita). Si el cliente tiene varias citas y no está claro cuál, llámalo sin cita_id: la herramienta te devuelve la lista para que le preguntes.',
      parameters: {
        type: 'object',
        properties: {
          cita_id: { type: 'number', description: 'Id de la cita a cancelar, tal como lo devuelve esta misma herramienta o consultar_estado. Omítelo si el cliente solo tiene una cita o si aún no sabes cuál es.' },
          motivo:  { type: 'string', description: 'Motivo de la cancelación si el cliente lo menciona (opcional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'transferir_asesor',
      description: 'Transfiere al cliente con un asesor humano cuando lo solicite o cuando no puedas resolver su consulta.',
      parameters: {
        type: 'object',
        properties: {
          razon: { type: 'string', description: 'Motivo de la transferencia' },
          tipo: {
            type: 'string',
            enum: ['asesor', 'personalizacion'],
            description: "Usa 'personalizacion' cuando el cliente quiere un mueble a la medida, un color o acabado especial, o una restauración/reparación. Para todo lo demás usa 'asesor'."
          }
        },
        required: ['razon']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'recordar_preferencia',
      description: 'Guarda lo que el cliente cuenta de sí mismo para no hacérselo repetir en otra conversación: para qué espacio busca el mueble ("apartamento pequeño", "sala de la casa nueva", "cuarto de mi hija") y qué le gusta o necesita ("madera clara", "que resista mascotas", "tela que no se manche"). Llámalo en cuanto lo diga, sin anunciárselo. NO guardes datos sensibles ni nada que no sirva para venderle mejor.',
      parameters: {
        type: 'object',
        properties: {
          espacio:      { type: 'string', description: 'Para qué espacio o persona busca el mueble' },
          preferencias: { type: 'array', items: { type: 'string' }, description: 'Gustos o necesidades concretas (material, color, resistencia)' },
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reportar_objecion',
      description: 'Úsalo cuando el cliente muestra interés pero pone un freno que tú no puedes resolver: dice que está caro, que lo va a pensar, que lo consulta con su pareja, que lo ve más adelante, o compara con otra tienda. NO le digas al cliente que estás reportando nada y NO te despidas: sigue atendiéndolo con normalidad e intenta resolver la objeción (opciones más económicas, beneficios, financiación). Esto solo avisa al equipo de ventas para que un humano decida si vale la pena hacer seguimiento.',
      parameters: {
        type: 'object',
        properties: {
          objecion: { type: 'string', description: 'Qué dijo el cliente, en sus palabras o resumido (ej: "dice que está caro", "lo va a consultar con su esposo")' },
          producto: { type: 'string', description: 'Producto sobre el que puso el freno, si lo hay' },
        },
        required: ['objecion']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reportar_proveedor',
      description: 'Úsalo cuando la persona NO es un cliente sino un PROVEEDOR o alguien que quiere VENDERLE a la empresa o proponer una colaboración/alianza comercial (ej: "somos importadores/fabricantes de X", "quiero enviarles mi portafolio", "les ofrezco materia prima/tapas/piedra", "propuesta comercial", "trabajar juntos"). NO lo trates como cliente, NO agendes visita, NO le des ningún número. Solo se notifica internamente al equipo de compras.',
      parameters: {
        type: 'object',
        properties: {
          resumen: { type: 'string', description: 'Qué ofrece y el nombre/empresa de la persona si lo mencionó' }
        },
        required: ['resumen']
      }
    }
  },
];

// Horario real de atención, leído de negocio.json (horario.semana / horario.sabado).
// (La versión anterior solo miraba la hora 21-8 e ignoraba el día de la semana,
// así que un mensaje sábado en la tarde o cualquier hora del domingo no avisaba
// nada aunque el asesor solo fuera a responder hasta el siguiente día hábil.)
// `margenCierreMin`: minutos antes del cierre a partir de los cuales ya se considera
// fuera de horario. Se usa para las transferencias: una solicitud que entra a las 4:50
// pm ya no la va a atender nadie ese día, así que para el cliente es "mañana".
// `proximaApertura` es el texto para decirle al cliente cuándo le responderá el asesor.
function estadoHorario(margenCierreMin = 0, ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: negocio.zonaHoraria, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(ahora);
  const dia    = partes.find(p => p.type === 'weekday')?.value;
  let hora     = parseInt(partes.find(p => p.type === 'hour')?.value);
  if (hora === 24) hora = 0;
  const minuto = parseInt(partes.find(p => p.type === 'minute')?.value) || 0;
  const min    = hora * 60 + minuto;

  const h        = negocio.horario;
  const rango    = dia === 'Sat' ? h.sabado : h.semana;
  const apertura = rango.abre * 60;
  const cierre   = rango.cierra * 60 - margenCierreMin;
  const abierto  = !(dia === 'Sun' && h.domingoCerrado) && min >= apertura && min < cierre;

  let proximaApertura;
  if (abierto)                             proximaApertura = null;
  else if (dia === 'Sun')                  proximaApertura = 'mañana lunes a partir de las 8am';
  else if (min < apertura)                 proximaApertura = 'hoy a partir de las 8am';
  else if (dia === 'Fri' || dia === 'Sat') proximaApertura = 'el lunes a partir de las 8am';
  else                                     proximaApertura = 'mañana a partir de las 8am';

  return { abierto, proximaApertura };
}

function avisoFueraHorario() {
  return estadoHorario().abierto
    ? null
    : `Estamos fuera de nuestro horario de atención (${negocio.horarioTexto}). Avisa al cliente que el asesor puede que le responda hasta el próximo horario hábil, pero que harán su mejor esfuerzo. Agradece su paciencia.`
}

// Minutos antes del cierre a partir de los cuales una transferencia ya se trata como
// fuera de horario (Lun-Vie desde las 4:40 pm, Sáb desde las 11:40 am).
const MARGEN_CIERRE_TRANSFERENCIA_MIN = negocio.margenCierreTransferenciaMin;

// ─── EJECUTAR HERRAMIENTAS ────────────────────────────────────────────────────

// Registro de eventos para métricas, fire-and-forget: nunca debe romper el flujo ni
// hacer esperar al cliente.
function evento(telefono, tipo, detalle) {
  db.registrarEvento(telefono, tipo, detalle).catch(e => console.error('[metricas] evento falló:', e.message));
}

// Guarda (compacto) los productos que se le acaban de mostrar al cliente, para poder
// resolver "esa / la segunda / la de $X" en el mensaje siguiente. No debe romper el
// flujo si falla.
async function recordarMostrados(from, productos) {
  try {
    // Con variantes se guarda el precio de entrada: "la de $X" del cliente se resuelve
    // por el precio más bajo, que es el que se le mostró como "desde".
    await db.setUltimosMostrados(from, productos.slice(0, 6).map(p => ({
      nombre: p.nombre,
      precio: (p.variantes?.length ? formatearMoneda(precioMinimo(p)) : p.precio)
    })));
    // Lo que se le muestra queda también en su perfil: si vuelve en unos días, el agente
    // sabe por dónde iba sin que él tenga que repetirlo.
    actualizarPerfil(from, { productos_interes: productos.slice(0, 3).map(p => p.nombre) }).catch(() => {});
  } catch (e) { console.warn('[mostrados] no se pudo guardar:', e.message); }
}

// Construye una instrucción de contexto con los productos recién mostrados al cliente,
// para que Elena resuelva "esa / la segunda / la de $X" con el nombre EXACTO. Efímero:
// no se guarda en historial. Devuelve null si no hay nada vigente.
async function construirContextoMostrados(from) {
  try {
    const mostrados = await db.getUltimosMostrados(from);
    if (!mostrados?.length) return null;
    const lista = mostrados.map((p, i) => {
      const n = Number(String(p.precio ?? '').replace(/[^\d]/g, ''));
      const precio = n ? `$${n.toLocaleString('es-CO')}` : String(p.precio ?? '');
      return `${i + 1}) ${p.nombre}${precio ? ` — ${precio}` : ''}`;
    }).join('; ');
    return `Productos que le mostraste al cliente hace un momento: ${lista}. Si el cliente dice "esa", "la segunda", "la primera", "la de $X", "la última", etc., se refiere a uno de estos — resuélvelo con esta lista y usa el nombre EXACTO.`;
  } catch { return null; }
}

async function ejecutarHerramienta(nombre, args, from, historial) {
  const telefono = from.replace('whatsapp:', '');

  switch (nombre) {

    case 'buscar_productos': {
      const { consulta, categoria, limite = 5 } = args;
      evento(telefono, 'busqueda', consulta);
      const resultados = buscarEnInventario(consulta, categoria, Math.min(Number(limite) || 5, 10));
      if (resultados.length === 0) {
        return {
          encontrados: 0,
          mensaje: `No encontré productos para "${consulta}".`,
          sugerencia: 'Prueba con otra categoría o un término diferente.'
        };
      }
      for (const p of resultados) evento(telefono, 'producto_visto', p.nombre);
      await recordarMostrados(from, resultados);
      return {
        encontrados: resultados.length,
        productos: resultados.map(p => ({
          nombre: p.nombre,
          ...infoPrecioVariantes(p),
          material: p.material, medidas: p.medidas,
          foto_disponible: p.tieneImagen, categoria: p.categoriaNombre
        }))
      };
    }

    case 'buscar_por_presupuesto': {
      const { presupuesto_max, categoria } = args;
      const presupuesto = Number(presupuesto_max);
      // El presupuesto del cliente llega aquí gratis: se guarda para no tener que
      // preguntárselo otra vez si vuelve en unos días.
      if (presupuesto > 0) actualizarPerfil(from, { presupuesto }).catch(() => {});
      if (!presupuesto || presupuesto <= 0) {
        return { exito: false, error: 'Presupuesto inválido.' };
      }
      const resultados = buscarEnInventarioPorPresupuesto(presupuesto, categoria);
      if (resultados.length === 0) {
        // Buscar el más económico global en esa categoría
        const todos = buscarEnInventario('', categoria, 1);
        const masBarato = todos[0];
        return {
          encontrados: 0,
          presupuesto: formatearMoneda(presupuesto),
          mensaje: `No encontré productos en ${formatearMoneda(presupuesto)}.${masBarato ? ` El más económico en ${masBarato.categoriaNombre} es ${masBarato.nombre} a ${masBarato.precio}.` : ''}`
        };
      }
      for (const p of resultados) evento(telefono, 'producto_visto', p.nombre);
      await recordarMostrados(from, resultados);
      return {
        encontrados: resultados.length,
        presupuesto: formatearMoneda(presupuesto),
        productos: resultados.map(p => ({
          nombre: p.nombre,
          ...infoPrecioVariantes(p),
          material: p.material, medidas: p.medidas,
          foto_disponible: p.tieneImagen, categoria: p.categoriaNombre
        }))
      };
    }

    case 'consultar_estado': {
      const items = await db.verCarrito(from);
      const estado = await db.getEstado(from);
      let citasRecientes = [];
      try {
        // Se incluye el id para que el modelo pueda pasárselo a cancelar_cita.
        const [citas] = await db.pool.query(
          'SELECT id, nombre, dia, hora, ubicacion, razon, estado FROM citas_agentes WHERE telefono = ? ORDER BY created_at DESC LIMIT 3',
          [telefono]
        );
        citasRecientes = citas.map(c => ({
          id: c.id, nombre: c.nombre, dia: c.dia, hora: c.hora,
          sede: UBICACIONES[c.ubicacion] || `Sede ${c.ubicacion}`,
          motivo: c.razon, estado: c.estado
        }));
      } catch {}

      return {
        carrito: items.length > 0 ? {
          items: items.map(i => ({ producto: i.producto, precio: i.precio, cantidad: i.cantidad || 1 })),
          total: formatearMoneda(items.reduce((s, i) => s + parsearPrecio(i.precio) * (i.cantidad || 1), 0))
        } : null,
        ultimo_producto_visto: estado.ultimo_producto
          ? { nombre: estado.ultimo_producto.nombre, precio: estado.ultimo_producto.precio }
          : null,
        citas_agendadas: citasRecientes.length > 0 ? citasRecientes : null,
        transferido: estado.transferido
      };
    }

    case 'ver_carrito': {
      const items = await db.verCarrito(from);
      if (!items || items.length === 0) {
        return { vacio: true, mensaje: 'El carrito está vacío.' };
      }
      let total = 0;
      const itemsFormateados = items.map(item => {
        const cant = item.cantidad || 1;
        const precio = parsearPrecio(item.precio);
        total += precio * cant;
        return { producto: item.producto, precio: item.precio, cantidad: cant };
      });
      return {
        items: itemsFormateados, total: formatearMoneda(total),
        totalNumerico: total, cantidad_items: items.length
      };
    }

    case 'agregar_al_carrito': {
      const { producto, cantidad = 1 } = args;
      // El precio NUNCA sale del argumento del modelo: se resuelve el producto de forma
      // estricta contra el inventario y el importe se toma de la BD. Antes, para los
      // productos sin variantes, el `precio` que generaba GPT-4o iba directo al carrito y
      // al pedido — toda la validación anti-precios-inventados quedaba burlada justo en el
      // paso que genera dinero. Y la búsqueda difusa podía resolver a OTRO producto.
      const prodInventario = resolverProductoExacto(producto);
      if (!prodInventario) {
        const cercanos = buscarEnInventario(producto, null, 3).map(p => p.nombre);
        return {
          exito: false,
          error: `No existe "${producto}" con ese nombre exacto en el inventario, así que no se puede agregar.${cercanos.length ? ` Los más parecidos son: ${cercanos.join(', ')}. Confirma con el cliente cuál quiere y vuelve a llamar agregar_al_carrito con el nombre EXACTO.` : ' Busca primero con buscar_productos.'}`
        };
      }
      const nombreReal = prodInventario.nombre;
      let precio = prodInventario.precio; // texto "$1.480.000" tal como viene de la BD

      // Un producto con variantes de precio no puede entrar al carrito "a secas": el
      // pedido llegaría al sistema de ventas con un importe que no corresponde a lo que
      // el cliente quiere. Se exige la opción y el precio sale de la BD, no del modelo.
      const variantesPrecio = (prodInventario.variantes || []).filter(v => v.etiqueta && v.precio > 0);
      const preciosDistintos = new Set(variantesPrecio.map(v => v.precio)).size > 1;

      let etiquetaVariante = null;
      if (preciosDistintos) {
        const elegida = encontrarVariante(prodInventario, args.variante);
        if (!elegida) {
          return {
            exito: false,
            requiere_variante: true,
            opciones: variantesPrecio.map(v => ({ opcion: v.etiqueta, precio: formatearMoneda(v.precio) })),
            error: `"${nombreReal}" se vende en varias opciones con precios distintos${args.variante ? ` y "${args.variante}" no identifica una sola de ellas` : ''}. Pregúntale al cliente cuál quiere (enumerándole las opciones con su precio) y vuelve a llamar agregar_al_carrito con el campo variante EXACTO. NO lo agregues ni le des un precio hasta que elija.`
          };
        }
        etiquetaVariante = elegida.etiqueta;
        precio = formatearMoneda(elegida.precio); // el precio manda desde la BD
      }

      // Si el modelo pasó un precio distinto al real, se registra: es señal de que está
      // inventando importes y conviene revisar el prompt.
      if (args.precio && parsearPrecio(args.precio) !== parsearPrecio(precio)) {
        alertar('Modelo pasó un precio distinto al de la BD en agregar_al_carrito', `tel=${telefono} producto="${nombreReal}" modelo=${args.precio} bd=${precio}`);
      }

      const nombreCarrito = etiquetaVariante ? `${nombreReal} (${etiquetaVariante})` : nombreReal;

      const items = await db.verCarrito(from);
      if (items.length >= negocio.maxItemsCarrito) {
        return { exito: false, error: `El carrito está lleno (máximo ${negocio.maxItemsCarrito} productos). Confirma la compra o elimina algo primero.` };
      }
      const existe = items.find(i => i.producto.toLowerCase() === nombreCarrito.toLowerCase());
      if (existe) {
        const nuevaCantidad = Number(cantidad) || existe.cantidad || 1;
        existe.cantidad = nuevaCantidad;
        await db.updateEstado(from, { carrito: items });
        const total = items.reduce((s, i) => s + parsearPrecio(i.precio) * (i.cantidad || 1), 0);
        return {
          exito: true, mensaje: `Cantidad de "${nombreCarrito}" actualizada a ${nuevaCantidad} unidad${nuevaCantidad > 1 ? 'es' : ''}.`,
          items_en_carrito: items.length, total_carrito: formatearMoneda(total)
        };
      }
      // Guardar también como último producto visto (con el nombre real del catálogo,
      // sin la variante, para que enviar_foto siga encontrando su imagen)
      await db.setUltimoProducto(from, { nombre: nombreReal, precio, imagen: prodInventario.imagen || null, ts: Date.now() });
      await db.agregarAlCarrito(from, nombreCarrito, precio, Number(cantidad) || 1);
      const itemsActualizados = await db.verCarrito(from);
      const total = itemsActualizados.reduce((s, i) => s + parsearPrecio(i.precio) * (i.cantidad || 1), 0);

      // Si el cliente no vuelve, se le escribe UNA vez a las 24 h. Se reprograma con cada
      // producto que añade, así el mensaje habla siempre de lo último que le interesó.
      seguimientos.programarCarritoAbandonado(depsSeguimientos(), {
        destinatario: telefono,
        producto:     nombreCarrito,
        nombre:       await db.getNombreCliente(from).catch(() => null),
      }).catch(e => console.warn('[seguimientos] carrito abandonado no programado:', e.message));

      return {
        exito: true, mensaje: `${nombreCarrito} agregado al carrito por ${precio}.`,
        variante: etiquetaVariante,
        items_en_carrito: itemsActualizados.length, total_carrito: formatearMoneda(total)
      };
    }

    case 'quitar_del_carrito': {
      const { producto } = args;
      if (!producto) {
        await db.limpiarCarrito(from);
        // Sin carrito no hay carrito que recordar.
        seguimientos.cancelar(depsSeguimientos(), { destinatario: telefono, tipo: seguimientos.TIPOS.CARRITO_ABANDONADO }).catch(() => {});
        return { exito: true, mensaje: 'Carrito vaciado completamente.' };
      }
      const items = await db.verCarrito(from);
      // Antes se comparaba por los primeros 12 caracteres normalizados: "quita el sofá"
      // con dos sofás en el carrito borraba LOS DOS. Ahora se busca la coincidencia más
      // específica y, si hay varias candidatas, se le pide al cliente que aclare.
      const q = normalizarTexto(producto);
      const coincide = i => {
        const n = normalizarTexto(i.producto);
        return n === q || n.includes(q) || q.includes(n);
      };
      let candidatos = items.filter(coincide);
      if (candidatos.length > 1) {
        // Coincidencia exacta como desempate (el cliente dio el nombre completo).
        const exactos = candidatos.filter(i => normalizarTexto(i.producto) === q);
        if (exactos.length === 1) candidatos = exactos;
      }
      if (candidatos.length === 0) {
        return { exito: false, error: `No encontré "${producto}" en el carrito.`, items_actuales: items.map(i => i.producto) };
      }
      if (candidatos.length > 1) {
        return {
          exito: false,
          ambiguo: true,
          coincidencias: candidatos.map(i => i.producto),
          error: `"${producto}" coincide con varios productos del carrito: ${candidatos.map(i => i.producto).join(', ')}. Pregúntale al cliente cuál quiere quitar y vuelve a llamar quitar_del_carrito con el nombre completo. NO quites ninguno todavía.`
        };
      }
      const aQuitar = candidatos[0];
      const actualizados = items.filter(i => i !== aQuitar);
      await db.updateEstado(from, { carrito: actualizados });
      return { exito: true, mensaje: `"${aQuitar.producto}" eliminado del carrito.`, items_restantes: actualizados.length };
    }

    case 'confirmar_pedido': {
      const items = await db.verCarrito(from);
      if (!items || items.length === 0) {
        return { exito: false, error: 'El carrito está vacío. Agrega productos primero.' };
      }
      let total = 0;
      const resumenItems = items.map((item, i) => {
        const cant = item.cantidad || 1;
        const precio = parsearPrecio(item.precio);
        total += precio * cant;
        return `${i + 1}. ${item.producto} - ${item.precio}${cant > 1 ? ` (${cant} uds)` : ''}`;
      });
      for (const item of items) {
        await db.guardarPedido(telefono, item.producto, item.precio, item.cantidad || 1);
      }
      await db.marcarPedidoConfirmado(from);
      // El carrito ya es un pedido: recordárselo sería absurdo.
      seguimientos.cancelar(depsSeguimientos(), { destinatario: telefono, tipo: seguimientos.TIPOS.CARRITO_ABANDONADO }).catch(() => {});
      // Se vacía el carrito (ya es un pedido) pero NO se borra el historial ni el estado:
      // antes `resetearEstadoSinPedido` + `limpiarConversaciones` dejaban al cliente sin
      // contexto justo después de comprar, así que un "¿cuándo me llega?" a los dos
      // minutos encontraba a Elena sin saber de qué pedido le hablaban. (Además el reset
      // ponía tiene_pedido de nuevo en false, anulando la marca de la línea anterior.)
      await db.limpiarCarrito(from);
      await db.limpiarFlujosEnCurso(from);
      evento(telefono, 'pedido', `$${total.toLocaleString('es-CO')}`);
      notificarRedes(telefono, resumenItems.join('\n'), historial, 'pedido', { carrito: items });
      // Mensaje de confirmación con resumen exacto — el campo 'mensaje_enviado' le indica a la IA que no lo repita
      const avisoHorarioPedido = avisoFueraHorario();
      return {
        exito: true,
        resumen: resumenItems.join('\n'),
        total: formatearMoneda(total),
        mensaje_confirmacion: `¡Pedido confirmado! 🎉\n\n${resumenItems.join('\n')}\n\n*Total: ${formatearMoneda(total)}*\n\nUn asesor de ${negocio.nombreEmpresa} te contactará pronto para coordinar el pago y la entrega. ¡Gracias por elegir ${negocio.nombreEmpresa}! 😊`,
        aviso_horario: avisoHorarioPedido,
        instruccion_ia: `Comparte el mensaje_confirmacion tal cual al cliente, sin cambiar nada. Luego solo añade una frase corta de despedida.${avisoHorarioPedido ? ' Y como es fuera de horario, avísale que un asesor lo contactará en el próximo horario hábil para que no espere.' : ''}`
      };
    }

    case 'enviar_foto': {
      const { nombre_producto } = args;
      const resultado = buscarImagenProducto(nombre_producto);
      if (!resultado) {
        // Antes se enviaba el producto más parecido aunque no tuviera nada que ver.
        // Ahora se admite que no está y se ofrecen alternativas para que Elena pregunte.
        const cercanos = buscarEnInventario(nombre_producto, null, 3).map(p => p.nombre);
        return {
          exito: false,
          error: cercanos.length
            ? `No tenemos "${nombre_producto}" en el catálogo. NO le mandes otra foto como si fuera ese producto. Lo más parecido es: ${cercanos.join(', ')}. Pregúntale al cliente si alguno le sirve.`
            : `No tenemos "${nombre_producto}" en el catálogo. Díselo con amabilidad y pregúntale qué tipo de mueble busca.`
        };
      }
      // Actualizar último producto visto (imagen incluida para visualización)
      evento(telefono, 'producto_visto', resultado.nombre);
      await db.setUltimoProducto(from, { nombre: resultado.nombre, imagen: resultado.imagen || null, ts: Date.now() });
      // No devolver el URL al modelo: evita que lo escriba en el texto como markdown
      return { exito: true, nombre: resultado.nombre, _imagenUrl: resultado.imagen, _imagen2Url: resultado.imagen2 || null, mensaje: `Foto de ${resultado.nombre} enviada al cliente.` };
    }

    case 'enviar_catalogo': {
      const { categoria } = args;
      const catNorm = normalizarTexto(categoria).replace(/\s+/g, '_');
      const url = catalogosDB[catNorm] ?? catalogosDB[categoria];
      if (!url) {
        // Primero buscar por prefijo exacto, luego por substring (evita confundir sofas con sofas_modulares)
        const entrada = Object.entries(catalogosDB).find(([k]) => k === catNorm)
          ?? Object.entries(catalogosDB).find(([k]) => k.startsWith(catNorm) || catNorm.startsWith(k));
        if (entrada) return { exito: true, url: entrada[1], categoria: entrada[0] };
        return {
          exito: false,
          error: `No hay catálogo PDF para "${categoria}". Puedo mostrarte los productos en texto usando buscar_productos.`
        };
      }
      return { exito: true, url, categoria };
    }

    case 'agendar_cita': {
      const { nombre, ubicacion, dia, hora, motivo } = args;

      if (!negocio.sedeValida(ubicacion)) {
        return { exito: false, error: `Sede inválida. Debe ser un número del ${negocio.sedeMin} al ${negocio.sedeMax}.` };
      }

      // La fecha se valida de verdad (ver fechas.js): que exista, que no haya pasado, que
      // no sea domingo y que el día de la semana que dijo el modelo coincida con la fecha.
      // Antes bastaba con que apareciera la palabra "martes" en el texto, y el asesor
      // recibía citas como "martes 3 de junio de 2026" (que es miércoles) sin saber a
      // cuál de los dos días atenerse.
      const val = fechas.validarFechaHoraCita(dia, hora);
      if (!val.ok) return { exito: false, error: val.error };

      const horaFormateada = val.hora;
      // Texto canónico con el día correcto ("Miércoles 3 de junio de 2026"), no lo que
      // escribió el modelo.
      const diaCapitalizado = val.fecha.texto.charAt(0).toUpperCase() + val.fecha.texto.slice(1);
      // Limpiar el nombre de frases introductorias comunes
      const nombreLimpio = nombre.replace(/^(me llamo|mi nombre es|soy)\s+/i, '').trim();

      // Una cita ya registrada para el mismo día no se duplica: el modelo a veces vuelve a
      // llamar la herramienta cuando el cliente confirma por segunda vez ("sí, perfecto").
      if (await db.existeCitaPendiente(from, val.fecha.iso)) {
        return {
          exito: true,
          ya_existia: true,
          mensaje: `El cliente YA tiene una cita registrada para el ${val.fecha.texto}. No la registres de nuevo: confírmale que sigue en pie (${SEDE_NOMBRE[Number(ubicacion)] ?? ''} a las ${horaFormateada}) y pregúntale si quiere cambiarla o si necesita algo más.`
        };
      }

      await db.guardarCita(from, {
        nombre: nombreLimpio, ubicacion: Number(ubicacion),
        dia: diaCapitalizado, fecha: val.fecha.iso, hora: horaFormateada, razon: motivo
      });

      const sedeNombre = SEDE_NOMBRE[Number(ubicacion)] ?? UBICACIONES[Number(ubicacion)]
      const tiendaId   = SEDE_TIENDA_ID[Number(ubicacion)] ?? null

      // Recordatorios: el día antes y un par de horas antes. Es el seguimiento con menos
      // riesgo y más valor — el cliente PIDIÓ la cita, así que el mensaje es esperado — y
      // reduce que no se presente, que cuesta asesor y producto preparado.
      seguimientos.programarRecordatoriosCita(depsSeguimientos(), {
        destinatario: telefono,
        referencia:   val.fecha.iso,
        fechaIso:     val.fecha.iso,
        hora:         horaFormateada,
        nombre:       nombreLimpio,
        sede:         sedeNombre,
      }).catch(e => console.warn('[seguimientos] no se programaron los recordatorios:', e.message));
      const motivoFinal = motivo || null
      const datosCita  = { nombre: nombreLimpio, ubicacion: Number(ubicacion), sede_nombre: sedeNombre, dia: diaCapitalizado, hora: horaFormateada, motivo: motivoFinal }

      evento(telefono, 'cita', `${sedeNombre} — ${diaCapitalizado} ${horaFormateada}`)
      const resumenCita = `${nombreLimpio} — ${sedeNombre} — ${diaCapitalizado} ${horaFormateada}${motivoFinal ? ` — ${motivoFinal}` : ''}`
      notificarRedes(
        telefono,
        resumenCita,
        historial,
        'cita',
        { datos_cita: datosCita, tienda_id: tiendaId, nombre: nombreLimpio }
      );

      const lineaMotivo = motivoFinal ? `\nMotivo: ${motivoFinal}` : ''
      return {
        exito: true,
        mensaje: `¡Listo! Tu cita quedó agendada ✅\n\n👤 *${nombreLimpio}*\n📍 ${sedeNombre}\n📅 ${diaCapitalizado} a las ${horaFormateada}${lineaMotivo}\n\nNuestro equipo te confirmará la visita pronto 😊\n\n¿Hay algo más en lo que pueda ayudarte?`
      };
    }

    case 'cancelar_cita': {
      const vigentes = await db.getCitasVigentes(from);
      if (!vigentes.length) {
        return { exito: false, error: 'El cliente no tiene ninguna cita vigente registrada. Dile que no encuentras una visita agendada a su nombre y pregúntale si quiere agendar una.' };
      }

      const describir = c => `#${c.id} — ${c.dia}${c.hora ? ` a las ${c.hora}` : ''} en ${SEDE_NOMBRE[Number(c.ubicacion)] ?? `sede ${c.ubicacion}`}`;

      let cita = null;
      if (args.cita_id) {
        cita = vigentes.find(c => Number(c.id) === Number(args.cita_id)) ?? null;
        if (!cita) {
          return { exito: false, error: `No encontré la cita ${args.cita_id} entre las vigentes del cliente.`, citas: vigentes.map(describir) };
        }
      } else if (vigentes.length === 1) {
        cita = vigentes[0];
      } else {
        // Varias citas y sin saber cuál: no se cancela nada a ciegas.
        return {
          exito: false,
          requiere_eleccion: true,
          citas: vigentes.map(describir),
          error: 'El cliente tiene varias citas vigentes. Enumérale las opciones y pregúntale cuál quiere cancelar; luego vuelve a llamar cancelar_cita con el cita_id correspondiente.'
        };
      }

      const cancelada = await db.cancelarCita(from, cita.id);
      if (!cancelada) {
        return { exito: false, error: 'No pude cancelar la cita en este momento. Dile al cliente que un asesor lo va a confirmar y llama a transferir_asesor.' };
      }

      const sedeNombre = SEDE_NOMBRE[Number(cita.ubicacion)] ?? UBICACIONES[Number(cita.ubicacion)] ?? `Sede ${cita.ubicacion}`;
      evento(telefono, 'cita_cancelada', `${sedeNombre} — ${cita.dia} ${cita.hora}`);
      // Sin esto, el cliente que canceló recibiría igual el recordatorio de una visita que
      // ya no existe.
      if (cita.fecha) {
        const fechaRef = cita.fecha instanceof Date ? cita.fecha.toISOString().slice(0, 10) : String(cita.fecha).slice(0, 10);
        seguimientos.cancelar(depsSeguimientos(), { destinatario: telefono, referencia: fechaRef })
          .catch(e => console.warn('[seguimientos] no se cancelaron los recordatorios:', e.message));
      }
      // El panel de ventas tiene que enterarse: si no, el asesor prepara el producto y
      // espera a un cliente que ya avisó que no va.
      notificarRedes(
        telefono,
        `CITA CANCELADA por el cliente\n${cita.nombre ?? ''} — ${sedeNombre} — ${cita.dia} ${cita.hora}${args.motivo ? `\nMotivo: ${args.motivo}` : ''}`,
        historial,
        'cita',
        { datos_cita: { cancelada: true, cita_id: cita.id, dia: cita.dia, hora: cita.hora, sede_nombre: sedeNombre, motivo: args.motivo ?? null }, tienda_id: SEDE_TIENDA_ID[Number(cita.ubicacion)] ?? null }
      );

      return {
        exito: true,
        cita_cancelada: describir(cita),
        mensaje: `Cita cancelada ✅ (${cita.dia}${cita.hora ? ` a las ${cita.hora}` : ''}, ${sedeNombre}). Confírmaselo al cliente con amabilidad y pregúntale si quiere agendar otra fecha; si te dice cuándo, llama agendar_cita con la fecha nueva.`
      };
    }

    case 'reportar_imagen_no_identificada': {
      evento(telefono, 'imagen_no_identificada');
      const intentos = (_capturasNoIdentificadas.get(telefono) ?? 0) + 1;
      _capturasNoIdentificadas.set(telefono, intentos);
      if (intentos >= 2) {
        _capturasNoIdentificadas.set(telefono, 0);
        notificarRedes(
          telefono,
          `El cliente ha enviado ${intentos} imágenes/capturas seguidas que la IA no pudo identificar en el inventario. Revisar la conversación y ayudarle manualmente a encontrar el producto.`,
          historial,
          'asesor'
        );
        return { ok: true, escalado: true, aviso_horario: avisoFueraHorario(), mensaje: `Se avisó a un asesor porque ya van varios intentos sin identificar la imagen. Coméntale al cliente que un asesor también le va a ayudar con esto, sin dejar de mostrarle opciones parecidas.${avisoFueraHorario() ? ' Como es fuera de horario, avísale que el asesor le responderá en el próximo horario hábil para que no espere.' : ''}` };
      }
      return { ok: true, escalado: false, mensaje: 'Registrado. Sigue el flujo normal: pregunta si el cliente puede leer el nombre y muéstrale opciones parecidas según el tipo de mueble que identifiques.' };
    }

    case 'transferir_asesor': {
      const { razon } = args;
      // El tipo llega al panel de ventas para que la tarjeta se etiquete como
      // "Solicitud de personalización" en vez de una petición de asesor genérica.
      const tipoTransferencia = args.tipo === 'personalizacion' ? 'personalizacion' : 'asesor';
      // Adjuntar contexto del estado aunque Elena no lo haya incluido en razon
      const estadoActual = await db.getEstado(from);
      const ultimoProd   = estadoActual?.ultimo_producto ? (typeof estadoActual.ultimo_producto === 'string' ? JSON.parse(estadoActual.ultimo_producto) : estadoActual.ultimo_producto) : null;
      const carritoActual = estadoActual?.carrito ? (typeof estadoActual.carrito === 'string' ? JSON.parse(estadoActual.carrito) : estadoActual.carrito) : [];
      let razonFinal = razon || 'Solicitud de asesor';
      if (ultimoProd?.nombre && !razonFinal.includes(ultimoProd.nombre)) {
        razonFinal += `\nÚltimo producto visto: ${ultimoProd.nombre}`;
      }
      if (carritoActual.length > 0 && !razonFinal.toLowerCase().includes('carrito')) {
        const resumenCarrito = carritoActual.map(i => `${i.producto} ×${i.cantidad || 1}`).join(', ');
        razonFinal += `\nCarrito: ${resumenCarrito}`;
      }
      // Fuera de horario (o a menos de 20 min del cierre): nadie va a tomar la tarjeta
      // hasta el próximo día hábil, así que NO se silencia a la IA — antes el cliente
      // quedaba toda la noche hablando con nadie. La tarjeta se crea igual (el asesor la
      // ve al abrir y al pulsar "Tomar" la IA se calla), y Elena le dice al cliente cuándo
      // le responderán y sigue atendiéndolo mientras tanto. Si ya hay una tarjeta
      // pendiente de este cliente, no se crea otra: el asesor ya va a contactarlo.
      const horario = estadoHorario(MARGEN_CIERRE_TRANSFERENCIA_MIN);
      if (!horario.abierto) {
        const yaPendiente = await db.solicitudAsesorPendiente(from);
        if (!yaPendiente) {
          evento(telefono, 'transferencia', `${tipoTransferencia} (fuera de horario): ${razon}`);
          notificarRedes(telefono, razonFinal, historial, tipoTransferencia, { carrito: carritoActual.length ? carritoActual : undefined });
        }
        return {
          exito: true,
          fuera_de_horario: true,
          mensaje: `FUERA DE HORARIO: ${yaPendiente ? 'la solicitud de asesor de este cliente ya estaba registrada' : 'la solicitud quedó registrada'} y un asesor le escribirá ${horario.proximaApertura} (horario: ${negocio.horarioTexto}). Díselo al cliente con calidez y deja claro que MIENTRAS TANTO tú sigues aquí para ayudarle con lo que necesite (productos, precios, fotos, medidas, carrito). NO te despidas ni dejes de atenderlo, y NO vuelvas a llamar transferir_asesor por este mismo motivo.`,
        };
      }

      evento(telefono, 'transferencia', `${tipoTransferencia}: ${razon}`);
      notificarRedes(telefono, razonFinal, historial, tipoTransferencia, { carrito: carritoActual.length ? carritoActual : undefined });
      await db.marcarTransferida(from);
      // El historial NO se borra: la nota de reactivación le dice a Elena que "use el
      // historial para ver qué buscaba" cuando el asesor libera el chat, y si se borraba
      // aquí no quedaba nada que mirar.
      return { exito: true, mensaje: 'Asesor notificado. Confírmale al cliente que lo estás conectando con un asesor que lo atenderá pronto 😊.' };
    }

    case 'recordar_preferencia': {
      await actualizarPerfil(from, { espacio: args.espacio, preferencias: args.preferencias });
      return { ok: true, mensaje: 'Anotado. NO se lo menciones al cliente: sigue la conversación con normalidad.' };
    }

    case 'reportar_objecion': {
      // Una objeción es el momento de más valor de la conversación: el cliente quiere el
      // producto pero algo lo frena. El agente sigue intentándolo, pero el equipo se
      // entera para poder trabajarlo a mano si vale la pena. Al cliente NO se le dice nada
      // de esto y la IA no se calla: solo es una señal interna.
      const objecion = String(args.objecion ?? '').substring(0, 200);
      evento(telefono, 'objecion', objecion);
      const estadoObj = await db.getEstado(from);
      const carritoObj = Array.isArray(estadoObj?.carrito) ? estadoObj.carrito : [];
      notificarRedes(
        telefono,
        `OBJECIÓN SIN RESOLVER 🤔\n${objecion}${args.producto ? `\nProducto: ${args.producto}` : ''}${carritoObj.length ? `\nCarrito: ${carritoObj.map(i => i.producto).join(', ')}` : ''}\nEl cliente sigue hablando con la IA; esto es solo para que ventas decida si hace seguimiento.`,
        historial,
        'asesor',
        { carrito: carritoObj.length ? carritoObj : undefined }
      );
      return {
        ok: true,
        mensaje: 'Registrado para el equipo de ventas. NO le menciones esto al cliente ni te despidas: sigue atendiéndolo e intenta resolver la objeción tú misma (opciones más económicas con buscar_por_presupuesto, beneficios del producto, formas de pago).'
      };
    }

    case 'reportar_proveedor': {
      // El número del encargado va SOLO en la notificación interna (el equipo lo ve en
      // el sistema de ventas), nunca en la respuesta al proveedor.
      const resumenProv = `PROVEEDOR / PROPUESTA COMERCIAL 🏭\n${args.resumen || 'Sin detalle'}\nReenviar al encargado de compras${process.env.COMPRAS_WHATSAPP ? ` (WhatsApp ${process.env.COMPRAS_WHATSAPP})` : ''}.`;
      evento(telefono, 'proveedor', (args.resumen ?? '').substring(0, 120));
      // Tipo 'asesor' y no 'otro': los tipos que acepta el sistema de ventas son
      // asesor|pedido|cita|personalizacion, así que 'otro' podía ser rechazado con un 4xx y
      // el lead del proveedor terminaba descartado tras los reintentos. La naturaleza de la
      // solicitud ya va clarísima en el resumen ('PROVEEDOR / PROPUESTA COMERCIAL').
      notificarRedes(telefono, resumenProv, historial, 'asesor');
      return { ok: true, mensaje: 'Registrado como propuesta de proveedor/colaboración. Agradécele con amabilidad, dile que su propuesta ya fue enviada a nuestro equipo de compras y que lo contactarán por este mismo medio si hay interés. NO agendes visita, NO le des ningún número, NO le pidas datos como si fuera un cliente.' };
    }

    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

// ─── LLAMADA A OPENAI CON TOOL LOOP ──────────────────────────────────────────

// Log del consumo de tokens de un turno, con costo estimado (tarifas gpt-4o:
// $2.50/1M tokens de entrada, $10/1M de salida). Permite auditar el gasto desde los
// logs sin depender solo del dashboard de OpenAI.
// `cacheados` son los tokens de entrada que OpenAI sirvió desde su caché de prefijo, a
// mitad de precio. Se logean para poder comprobar que el caché está funcionando: si sale
// 0 a partir del segundo mensaje de una conversación, algo cambiante se está colando
// delante del prompt estable (ver cómo se arma `messages` en runAgentLoop).
function logUsoTokens(from, promptTok, completionTok, rondas, etiqueta = '', cacheados = 0) {
  const costo = ((promptTok - cacheados) / 1e6) * 2.5 + (cacheados / 1e6) * 1.25 + (completionTok / 1e6) * 10;
  const pctCache = promptTok ? Math.round((cacheados / promptTok) * 100) : 0;
  console.log(`[tokens]${etiqueta ? ' ' + etiqueta : ''} ${from} · ${rondas} ronda(s) · entrada ${promptTok} (${pctCache}% en caché) · salida ${completionTok} · ~$${costo.toFixed(4)}`);
}

// Único loop de agente del bot. Antes había TRES copias casi idénticas (texto, visión y
// el respaldo cuando falla la visualización de sala) que ya habían divergido entre sí:
// solo la de texto inyectaba el contexto de reactivación tras asesor, solo dos
// construían el contexto de "productos recién mostrados", y la de respaldo ni siquiera
// guardaba la conversación en el historial. Cada mejora había que aplicarla tres veces.
//
// Opciones:
//   imagenBase64/mimeType  — activa visión (la foto se manda a máxima calidad)
//   historial              — mensajes previos ya leídos por el llamador
//   instruccionesExtra     — se anexa al system prompt (reglas específicas de visión)
//   maxRondas / maxTokens  — límites del turno
//   etiqueta               — distingue el origen en los logs de tokens
async function runAgentLoop(from, mensajeUsuario, opciones = {}) {
  const {
    imagenBase64 = null,
    mimeType = 'image/jpeg',
    historial = [],
    instruccionesExtra = null,
    maxRondas = 6,
    maxTokens = 900,
    etiqueta = '',
  } = opciones;

  const contextoMostrados = await construirContextoMostrados(from);
  const reactivado = await db.consumirReactivacionAsesor(from);
  // Se distingue si un asesor llegó a atenderlo: cuando nadie tomó la tarjeta y la red de
  // seguridad liberó la conversación, preguntarle "¿cómo quedaste con el asesor?" no tiene
  // sentido — no habló con nadie y lo que toca es disculparse por la espera.
  const notaReactivacion = !reactivado ? null
    : reactivado.atendido
      ? 'Este cliente venía siendo atendido por un asesor humano y la conversación acaba de volver a ti. NO arranques de cero ni repitas el saludo largo de bienvenida: reconoce que ya venía en conversación (usa el historial para ver qué buscaba) y pregúntale amablemente en qué le puedes seguir ayudando o cómo quedó con el asesor. Si necesita de nuevo un asesor, transfiérelo.'
      : 'Este cliente pidió hablar con un asesor y NINGÚN asesor llegó a atenderlo; la conversación acaba de volver a ti. NO le preguntes cómo le fue con el asesor (nunca habló con nadie): discúlpate con naturalidad por la demora, retoma lo que estaba buscando según el historial y sigue ayudándole tú. Si insiste en hablar con una persona, vuelve a transferirlo.';

  // Si el cliente vuelve después de un rato, el modelo debe saberlo: con el carrito y el
  // historial ya conservados (antes se borraban a los 45 min), sin este aviso Elena
  // seguiría la conversación como si no hubiera pasado nada. El valor se mide al ENTRAR el
  // turno (ver procesarMensaje): a esta altura `last_interaction` ya se refrescó y
  // preguntarlo aquí daría siempre 0.
  const minutosAusente = _ausenciaTurno.get(from) ?? null;
  _ausenciaTurno.delete(from);

  // Lo que ya se sabe del cliente (presupuesto, espacio, gustos, productos que vio) y el
  // resumen de lo hablado si la conversación se hizo larga. Ninguno de los dos debe romper
  // el turno si falla.
  let contextoPerfil = null, contextoResumen = null;
  try {
    contextoPerfil = memoria.construirContextoPerfil(await db.getPerfil(from), { formatearMoneda });
    const resumen = await db.getResumenConversacion(from);
    contextoResumen = memoria.construirContextoResumen(resumen);
  } catch (e) {
    console.warn('[memoria] no se pudo cargar el contexto del cliente:', e.message);
  }
  const notaRegreso = (!reactivado && minutosAusente !== null && minutosAusente >= db.VENTANA_CONVERSACION_MINUTOS)
    ? `El cliente vuelve tras ${minutosAusente >= 120 ? `${Math.round(minutosAusente / 60)} horas` : `${minutosAusente} minutos`} sin escribir. Su carrito y lo que ya habló siguen guardados (mira el historial). Salúdalo brevemente reconociendo que había pasado un rato, retoma donde quedó (sin repetir el saludo largo de bienvenida ni volver a preguntarle todo) y confirma si sigue interesado en lo mismo.`
    : null;

  // Referencia viva al mensaje del usuario: en las rondas siguientes se le quita la
  // imagen (ver más abajo) sin re-facturar los tokens de visión.
  const userMsg = {
    role: 'user',
    content: imagenBase64
      ? [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imagenBase64}`, detail: 'high' } },
          { type: 'text', text: mensajeUsuario },
        ]
      : mensajeUsuario,
  };

  const messages = [
    // El primer mensaje es el prompt grande y SIEMPRE idéntico: es el prefijo que OpenAI
    // cachea (y cobra más barato). Todo lo que cambia —fecha, reglas de visión, notas del
    // turno— va detrás, en mensajes aparte. Antes la fecha iba dentro del prompt y las
    // instrucciones de visión se le concatenaban, así que el prefijo cambiaba cada día y en
    // cada turno con foto: el caché no llegaba a usarse nunca.
    { role: 'system', content: buildSystemPrompt() },
    ...(instruccionesExtra ? [{ role: 'system', content: instruccionesExtra }] : []),
    { role: 'system', content: fechas.bloqueFechaParaPrompt() },
    ...(notaReactivacion ? [{ role: 'system', content: notaReactivacion }] : []),
    ...(notaRegreso ? [{ role: 'system', content: notaRegreso }] : []),
    ...(contextoPerfil ? [{ role: 'system', content: contextoPerfil }] : []),
    ...(contextoResumen ? [{ role: 'system', content: contextoResumen }] : []),
    ...(contextoMostrados ? [{ role: 'system', content: contextoMostrados }] : []),
    ...historial.map(m => ({ role: m.role, content: m.content })),
    userMsg,
  ];

  // Puede haber múltiples imágenes (comparaciones)
  const imagenesParaEnviar = [];

  // Contadores de tokens para auditar el gasto real por conversación.
  let tokPrompt = 0, tokCompletion = 0, tokCacheados = 0;
  // Precios que salieron de herramientas en este turno (p.ej. total de carrito): son válidos.
  const preciosVistos = new Set();

  // Un asesor puede pulsar "Tomar" en el panel de Redes mientras este turno está en
  // curso (entre el debounce y las rondas de OpenAI pasan varios segundos). Se re-chequea
  // antes de devolver la respuesta: si ya tiene el chat, se descarta entera (texto y
  // fotos) para no escribirle al cliente encima de la conversación del asesor. La
  // excepción es cuando fue la propia IA quien llamó a transferir_asesor en este turno:
  // ahí debe poder decirle al cliente que lo está conectando.
  let transfiriendo = false;
  const DESCARTADA = { texto: null, imagenesParaEnviar: [], descartada: true };
  const asesorTomoElChat = async (rondas) => {
    if (transfiriendo || !(await db.asesorAtendiendo(from))) return false;
    console.log(`[TRANSFERIDO] ${from}: un asesor tomó el chat a mitad del turno — se descarta la respuesta`);
    logUsoTokens(from, tokPrompt, tokCompletion, rondas, etiqueta, tokCacheados);
    return true;
  };

  for (let ronda = 0; ronda < maxRondas; ronda++) {
    // Con reintentos: un 429 o un 5xx pasajero de OpenAI ya no tumba el turno ni dispara
    // una tarjeta de asesor. Temperatura baja (0.3): la regla número uno de este agente es
    // no inventar precios ni nombres de producto, y la calidez la da el prompt, no el
    // muestreo. Antes estaba en 0.7 mientras el agente de Instagram usaba 0.5.
    const response = await conReintentos(
      () => openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: maxTokens
      }),
      { contexto: `openai ${from} ronda ${ronda + 1}` }
    );

    if (response.usage) {
      tokPrompt     += response.usage.prompt_tokens     ?? 0;
      tokCompletion += response.usage.completion_tokens ?? 0;
      tokCacheados  += response.usage.prompt_tokens_details?.cached_tokens ?? 0;
    }

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      messages.push({
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: choice.message.tool_calls
      });

      for (const toolCall of choice.message.tool_calls) {
        let toolArgs = {};
        try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

        log.info('herramienta', { nombre: toolCall.function.name, args: JSON.stringify(toolArgs).substring(0, 120) });
        if (toolCall.function.name === 'transferir_asesor') transfiriendo = true;
        const resultado = await ejecutarHerramienta(toolCall.function.name, toolArgs, from, historial);

        // Coleccionar imágenes de productos (permite comparaciones con múltiples fotos)
        // Los catálogos PDF NO se envían como attachment — Google Drive no sirve como CDN
        // directo y WhatsApp falla silenciosamente. La URL va en el texto de la respuesta.
        if (toolCall.function.name === 'enviar_foto' && resultado.exito) {
          if (resultado._imagenUrl) imagenesParaEnviar.push({ url: resultado._imagenUrl, nombre: resultado.nombre });
          if (resultado._imagen2Url) imagenesParaEnviar.push({ url: resultado._imagen2Url, nombre: resultado.nombre });
        }

        const resultadoStr = JSON.stringify(resultado);
        for (const n of extraerPrecios(resultadoStr)) preciosVistos.add(n);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultadoStr
        });
      }

      // La foto ya se analizó a máxima calidad en la ronda 0. En las siguientes el
      // modelo solo procesa resultados de herramientas y no necesita "verla" de nuevo:
      // se quita para no re-facturar los tokens de visión, que en 'high' son caros.
      if (imagenBase64 && Array.isArray(userMsg.content)) {
        userMsg.content = mensajeUsuario;
      }

    } else {
      if (await asesorTomoElChat(ronda + 1)) return DESCARTADA;
      const texto = choice.message.content || 'Disculpa, no pude generar una respuesta. Por favor intenta de nuevo. 😊';
      validarPrecios(from, texto, preciosVistos);
      logUsoTokens(from, tokPrompt, tokCompletion, ronda + 1, etiqueta, tokCacheados);
      return { texto, imagenesParaEnviar };
    }
  }

  // Se agotaron las rondas sin que el modelo cerrara con una respuesta. Antes esto solo
  // devolvía "intenta de nuevo" y nadie se enteraba: el cliente quedaba colgado y el
  // lead se perdía en silencio. Ahora se escala a un asesor humano.
  if (await asesorTomoElChat(maxRondas)) return DESCARTADA;
  evento(from, 'sin_resolver', 'limite de rondas');
  logUsoTokens(from, tokPrompt, tokCompletion, maxRondas, etiqueta, tokCacheados);
  notificarRedes(
    from,
    'La IA no pudo resolver la solicitud tras varios intentos (límite de rondas de herramientas alcanzado). Revisar la conversación y contactar al cliente.',
    historial,
    'asesor'
  );
  const avisoRondas = avisoFueraHorario();
  return {
    texto: `Tuve un problema procesando tu solicitud. Un asesor te contactará pronto 🙏${avisoRondas ? `\n\n${avisoRondas}` : ''}`,
    imagenesParaEnviar: []
  };
}

// Reglas que solo aplican cuando el cliente manda una foto. Van aparte del prompt base
// para no gastar tokens en cada turno de texto, y se anexan al system prompt vía
// runAgentLoop({ instruccionesExtra }).
const INSTRUCCIONES_VISION = `

INSTRUCCIÓN PARA IMÁGENES: Cuando el cliente envía una foto:
0. Si es una CAPTURA DE PANTALLA de una publicación de red social (se ve interfaz de la app, texto de descripción, nombre de usuario, etc. — muy común en clientes mayores que no saben usar "compartir" y en su lugar mandan un screenshot): primero intenta LEER cualquier texto visible que pueda ser el nombre del producto. Si logras leer un nombre y aparece en el inventario, llama buscar_productos con ese nombre exacto y preséntalo directamente. Si la captura se ve claramente recortada arriba (el encabezado o la descripción quedan tapados por la barra de estado del celular) dile al cliente que en vez de una captura comparta la publicación o foto directamente — así se puede leer el nombre completo. Si NO logras leer un nombre, o no aparece en el inventario: llama reportar_imagen_no_identificada, dile al cliente algo como "No alcancé a ver el nombre del producto en la imagen 🙏 ¿me dices si tú lo alcanzas a leer, o qué tipo de mueble es? Mientras tanto te muestro opciones parecidas:" y continúa con el paso 1 usando el tipo de mueble que identifiques visualmente.
0b. Si el mensaje del sistema ya dice "La imagen coincide con este producto de nuestro catálogo": es una coincidencia automática por comparación de foto, no una adivinanza — llama buscar_productos con ese nombre exacto y preséntalo directamente, saltando el paso 0. Preséntalo con el nombre, precio, medidas y material EXACTOS que devuelva la herramienta, palabra por palabra: NUNCA cambies ni acortes el nombre, NUNCA inventes medidas ni material, y NO describas lo que "ves" en la foto si contradice esos datos — el catálogo manda. Si algún dato no aparece, dile al cliente que ese detalle lo confirma un asesor.
0c. Si el mensaje trae un bloque "[COINCIDENCIA VISUAL ALTA…]", "[PARECIDOS VISUALES…]", "[IMAGEN ANALIZADA…]" o "[IDENTIFICADO POR EL TEXTO DE LA IMAGEN…]": la foto YA fue comparada contra las fotos del catálogo de su misma categoría. Sigue la instrucción de ese bloque al pie de la letra y SALTA los pasos 0, 1 y 2 — no vuelvas a preguntar qué tipo de mueble es ni muestres la categoría entera.
1. Identifica el TIPO de mueble (silla de comedor, sofá, cama, mesa, etc.) y la CATEGORÍA del catálogo.
2. Llama buscar_productos DOS VECES:
   a) Primera con la categoría exacta y limite:10 para obtener TODOS los productos de esa línea.
   b) Segunda (opcional) con descripción visual si hay características muy específicas.
3. Presenta los productos encontrados con precio, material y medidas.
4. Para los primeros 2-3 resultados con foto, llama enviar_foto INMEDIATAMENTE sin pedir permiso.
5. Dile al cliente: "Estas son todas nuestras opciones de [tipo]. ¿Alguna te llama la atención?"
NUNCA preguntes "¿quieres ver la foto?" — envíala directamente.
NUNCA digas que no puedes identificar productos. Clasifica el tipo y muestra el catálogo completo de esa categoría.`;

// Descarga la foto del cliente, intenta reconocerla contra el catálogo por hash de
// imagen y se la pasa al agente con visión activada. Antes esto estaba duplicado en dos
// sitios (el flujo normal y el respaldo de la visualización de sala) y las dos copias
// habían divergido: la de respaldo no guardaba nada en el historial ni construía el
// contexto de productos mostrados, así que la conversación perdía el hilo.
async function analizarImagenCliente({ from, toNumber, mediaUrl, mediaType, textoCliente, instruccionFinal, etiqueta }) {
  const { downloadFromTwilio } = require('./image-processor');
  const imageBuffer = await downloadFromTwilio(mediaUrl);
  const base64 = imageBuffer.toString('base64');
  const mime = (mediaType || 'image/jpeg').split(';')[0];

  // Cascada de identificación: primero el hash exacto (misma foto del catálogo, casi
  // gratis); si no, visión por categoría (vision-catalogo.js): clasifica qué mueble es y
  // compara SOLO con las fotos de esa categoría. Antes, cuando el hash fallaba, el modelo
  // recibía la foto sin ninguna referencia visual del catálogo y "parecido" lo decidía
  // por los nombres en texto: al cliente le llegaban las tres primeras bases de comedor
  // aunque ninguna se pareciera a la de su captura.
  const nombreDetectado = await identificarProductoPorImagen(imageBuffer);
  let contextoUsuario;
  if (nombreDetectado) {
    contextoUsuario = `[La imagen coincide con este producto de nuestro catálogo (misma foto o muy similar): "${nombreDetectado}". Trátalo como identificado con certeza, sin pedirle al cliente que lea nada.]\n${textoCliente}`;
  } else {
    const contextoVision = await identificarImagenPorCategoria(from, { base64, mime });
    contextoUsuario = contextoVision ? `${contextoVision}\n${textoCliente}` : textoCliente;
  }

  const historial = await db.getHistorial(from, 6);
  const { texto, imagenesParaEnviar, descartada } = await runAgentLoop(
    from,
    `${contextoUsuario}\n\n${instruccionFinal}`,
    {
      imagenBase64: base64,
      mimeType: mime,
      historial,
      instruccionesExtra: INSTRUCCIONES_VISION,
      maxRondas: 5,
      maxTokens: 800,
      etiqueta,
    }
  );

  await db.addMensaje(from, 'user', contextoUsuario);
  // Un asesor tomó el chat mientras se analizaba la foto: queda guardado lo que mandó
  // el cliente (contexto para cuando la IA retome), pero no se le envía nada.
  if (descartada) return;
  await db.actualizarLastInteraction(from);

  // Texto primero, luego imágenes por separado (más confiable en WhatsApp). La respuesta
  // solo entra al historial si de verdad se entregó: si el envío falla, en el turno
  // siguiente Elena no debe darla por dicha.
  const entregado = await enviarTexto(from, toNumber, texto);
  if (entregado) await db.addMensaje(from, 'assistant', texto);
  for (const img of imagenesParaEnviar) {
    await enviarMensajeAdicional(from, toNumber, `📸 ${img.nombre}`, img.url);
  }
}

// ─── SALUDO INICIAL ───────────────────────────────────────────────────────────

// El texto del saludo vive en negocio.json (saludos.whatsapp).
const SALUDO_INICIAL = negocio.saludo('whatsapp');

// ─── WEBHOOK PRINCIPAL ────────────────────────────────────────────────────────

// El webhook solo acusa recibo y encola: nada de trabajo pesado aquí dentro. La
// respuesta al cliente sale después por la API REST (ver enviarTexto), así que ya no
// hay carrera contra el corte de Twilio a los 15 s.
app.post('/webhook', (req, res) => {
  const incomingMsg = (req.body.Body || '').trim();
  const from = req.body.From || 'unknown';
  const toNumber = req.body.To || '';
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;
  const messageSid = req.body.MessageSid || req.body.SmsSid || '';
  // Nombre con el que el cliente tiene configurado su WhatsApp. Twilio lo manda en cada
  // webhook y antes se descartaba, así que el asesor recibía la solicitud con el número
  // pelado aunque el nombre viniera gratis.
  const profileName = (req.body.ProfileName || '').trim();

  res.status(200).send('');

  log.info('mensaje_recibido', { cliente: from, texto: (incomingMsg || '[media]').substring(0, 120) });

  if (!incomingMsg && !mediaUrl) return;

  // Rechazar reintentos de Twilio para el mismo mensaje. Dos barreras: el Set en memoria
  // corta al instante los reintentos que llegan dentro del mismo proceso, y la tabla
  // wa_sids_procesados cubre lo que el Set no puede — un redeploy de Render entre el
  // mensaje y su reintento, o más de una instancia corriendo. Sin la segunda, tras cada
  // reinicio el cliente recibía dos veces la misma respuesta.
  if (yaFueProcesado(messageSid)) {
    console.log(`[DEDUP] ${from} — SID ya procesado (memoria): ${messageSid}`);
    return;
  }

  db.registrarSid(messageSid)
    .then(esNuevo => {
      // Solo se descarta cuando la BD dice EXPLÍCITAMENTE que es duplicado: cualquier
      // otra respuesta se trata como mensaje nuevo, porque perder el mensaje de un
      // cliente es mucho peor que responderle dos veces.
      if (esNuevo === false) {
        console.log(`[DEDUP] ${from} — SID ya procesado (BD): ${messageSid}`);
        return;
      }
      recibirMensaje({ from, toNumber, texto: incomingMsg, mediaUrl, mediaType, profileName });
    })
    .catch(e => {
      // Ante un fallo de BD se procesa igual: mejor arriesgar un duplicado que perder el
      // mensaje del cliente.
      console.error('[DEDUP] no se pudo registrar el SID, se procesa igual:', e.message);
      recibirMensaje({ from, toNumber, texto: incomingMsg, mediaUrl, mediaType, profileName });
    });
});

// Procesa un turno completo del cliente (ya agrupado por el buffer de ráfagas).
async function procesarMensaje(datos) {
  // Todo lo que ocurra dentro de este turno queda etiquetado con el mismo id, el canal y el
  // cliente (ver core/log.js): así se puede reconstruir qué pasó con una persona concreta
  // aunque se estén atendiendo varias a la vez.
  return log.conContexto({ canal: 'whatsapp', cliente: datos.from }, () => _procesarMensaje(datos));
}

async function _procesarMensaje({ from, toNumber, incomingMsg, mediaUrl, mediaType, profileName }) {
  try {
    // Cuánto llevaba el cliente sin escribir, medido ANTES de que getOrCreateUsuario
    // refresque last_interaction. runAgentLoop lo usa para que Elena retome la
    // conversación en vez de seguir como si no hubiera pasado nada.
    const ausencia = await db.minutosDesdeUltimaInteraccion(from);
    if (Number.isFinite(ausencia)) _ausenciaTurno.set(from, ausencia);

    await db.verificarYLimpiarInactividad(from);
    await db.getOrCreateUsuario(from, profileName);

    // Métrica: una conversación nueva empieza cuando no hay historial previo (tras el
    // posible limpiado por inactividad de arriba). Fire-and-forget, no bloquea el flujo.
    try {
      const previa = await db.getHistorial(from, 1);
      if (!previa || previa.length === 0) evento(from, 'conversacion');
    } catch { /* métrica no crítica */ }

    // ── USUARIO TRANSFERIDO A ASESOR ───────────────────────────────
    // Mientras siga transferido, la IA NO interviene bajo ninguna circunstancia
    // (ni con un saludo, ni por palabras clave de producto) — un asesor humano
    // puede estar hablando activamente con el cliente. Se libera cuando el asesor
    // da "Terminar" en el panel de Redes; si nadie ha tomado la tarjeta todavía, hay
    // además una red de seguridad por inactividad (ver TIMEOUT_TRANSFERIDO_MINUTOS en
    // db.js).
    //
    // Este chequeo va ANTES de los flujos de imagen y audio: si quedaba después, una
    // foto o una nota de voz enviadas durante la transferencia disparaban igualmente
    // una respuesta de Elena, pisando al asesor en plena conversación.
    //
    // Importante: NO se vuelve a notificar al sistema de ventas en cada mensaje del
    // cliente mientras espera — eso creaba una tarjeta "pendiente" nueva por cada
    // mensaje, como si fuera otra solicitud sin reclamar, aunque el cliente ya
    // estuviera siendo atendido. La solicitud original ya tiene el historial.
    if (await db.estaTransferida(from)) {
      await db.actualizarLastInteraction(from);
      // Se guarda lo que el cliente escriba MIENTRAS lo atiende el asesor, para que la
      // IA tenga contexto cuando retome el chat. Sin esto, al liberar la transferencia
      // Elena sabía que el cliente venía de un asesor pero no una sola palabra de lo
      // que había pedido en el intervalo.
      const contenidoCliente = incomingMsg?.trim() || (mediaUrl ? '[el cliente envió una imagen o nota de voz]' : null);
      if (contenidoCliente) await db.addMensaje(from, 'user', contenidoCliente).catch(() => {});
      // El aviso "el asesor te responderá pronto" solo tiene sentido mientras NADIE ha
      // tomado la tarjeta. Con el chat ya tomado, el asesor está hablando con el
      // cliente y este aviso automático se metía cada dos minutos en medio de esa
      // conversación, como si fuera otra persona interrumpiendo.
      if (!(await db.tomadaPorAsesor(from)) && debeEnviarAvisoEspera(from)) {
        await enviarTexto(from, toNumber, '✅ Tu mensaje fue recibido. El asesor te responderá pronto. 😊');
      }
      return;
    }

    // ── IMAGEN RECIBIDA DEL CLIENTE ─────────────────────────────────
    if (mediaUrl && mediaType?.startsWith('image/')) {
      // Visualización de sala: solo si el cliente lo pide explícitamente
      const esVisualizacion = !!incomingMsg &&
        /\b(sala|cuarto|habitaci[oó]n|ambiente|visualiz|pon\s+(el|la)|c[oó]mo\s+(quedar[íi]a[n]?|se\s+ver[íi]a[n]?|luce[n]?|queda[n]?)|quedar[íi]a[n]?\s+(bien|aqu[íi]|ac[aá]|en)|se\s+ver[íi]a[n]?\s+(bien|aqu[íi]|ac[aá])|queda[n]?\s+(bien|aqu[íi]|ac[aá]|en\s+este|en\s+mi)|ver\s+c[oó]mo\s+queda|quiero\s+ver\s+c[oó]mo)\b/i.test(incomingMsg);

      await enviarTexto(from, toNumber, esVisualizacion
        ? '⏳ Procesando tu foto para mostrarte cómo quedaría el mueble... 🛋️'
        : '🔍 Recibí tu imagen, analizándola...');

      try {
        if (esVisualizacion) {
          // ── Replicate: superponer mueble en foto de sala ──────────
          const estado = await db.getEstado(from);
          const ultimoProd = estado.ultimo_producto;
          const sofaInfo = ultimoProd ? { nombre: ultimoProd.nombre, imagen: ultimoProd.imagen || null } : null;
          const result = await processRoomImage(mediaUrl, sofaInfo);
          if (result.success) {
            await enviarMensajeAdicional(
              from, toNumber,
              `¡Así quedaría${ultimoProd ? ` el ${ultimoProd.nombre}` : ' el mueble'} en tu espacio! 😊\n¿Te gusta? ¿Lo agregamos al carrito?`,
              result.imageUrl
            );
          } else {
            // No se pudo generar la visualización: al menos se analiza la foto y se
            // muestran opciones del catálogo, con el mismo flujo de visión de siempre.
            await enviarTexto(from, toNumber, 'La visualización en tu espacio no está disponible ahora mismo 🛠️ Pero te muestro las mejores opciones de nuestro catálogo con fotos:');
            await analizarImagenCliente({
              from, toNumber, mediaUrl, mediaType,
              textoCliente: incomingMsg || 'El cliente quiere ver opciones de muebles similares.',
              instruccionFinal: 'Identifica el tipo de mueble y muestra opciones del catálogo con fotos.',
              etiqueta: 'vision-fallback',
            });
          }

        } else {
          await analizarImagenCliente({
            from, toNumber, mediaUrl, mediaType,
            textoCliente: incomingMsg || 'El cliente envió una foto de un mueble.',
            instruccionFinal: 'Describe las características visuales del mueble en la foto y busca opciones similares en nuestro catálogo con sus precios.',
            etiqueta: 'vision',
          });
        }

      } catch (err) {
        console.error('[IMG] Error:', err.message);
        // La foto suele ser el producto que el cliente quiere: si no se pudo procesar,
        // se escala en vez de dejarlo repitiendo el envío.
        let historialImg = [];
        try { historialImg = await db.getHistorial(from, 8); } catch { /* sin historial */ }
        notificarRedes(
          from,
          `No se pudo procesar la imagen que envió el cliente (${err.message}). Revisar la conversación y ayudarle manualmente.`,
          historialImg,
          'asesor'
        );
        await enviarTexto(from, toNumber, '¡Recibí tu imagen! No pude procesarla en este momento 🙏 ¿Me describes el mueble que buscas? Un asesor también te va a ayudar con esto 😊');
      }
      return;
    }

    // ── AUDIO RECIBIDO DEL CLIENTE ──────────────────────────────
    if (mediaUrl && mediaType?.startsWith('audio/')) {
      await enviarTexto(from, toNumber, '🎧 Escuché tu audio, un momento...');

      try {
        const { downloadFromTwilio } = require('./image-processor');
        const { toFile } = require('openai');
        const audioBuffer = await downloadFromTwilio(mediaUrl);
        const mimeClean = (mediaType || 'audio/ogg').split(';')[0];
        const ext = mimeClean.split('/')[1] || 'ogg';
        const audioFile = await toFile(audioBuffer, `audio.${ext}`, { type: mimeClean });

        const transcripcion = await openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: audioFile,
          language: 'es',
        });

        const textoTranscrito = transcripcion.text?.trim();
        if (!textoTranscrito) {
          await enviarTexto(from, toNumber, 'No pude entender el audio. ¿Podrías escribir tu consulta? 😊');
          return;
        }

        console.log(`[AUDIO→TEXTO] ${from}: ${textoTranscrito}`);

        const historialAudio = await db.getHistorial(from, 12);
        const resultadoAudio = await runAgentLoop(from, textoTranscrito, { historial: historialAudio, etiqueta: 'audio' });

        await db.addMensaje(from, 'user', `🎤 ${textoTranscrito}`);
        // Un asesor tomó el chat mientras se procesaba el audio: no se le envía nada.
        if (resultadoAudio.descartada) return;
        await db.actualizarLastInteraction(from);

        // Solo se guarda como dicho lo que se entregó (ver enviarTexto).
        const entregadoAudio = await enviarTexto(from, toNumber, resultadoAudio.texto);
        if (entregadoAudio) await db.addMensaje(from, 'assistant', resultadoAudio.texto);
        for (const img of resultadoAudio.imagenesParaEnviar) {
          const caption = `📸 ${img.nombre}`;
          await enviarMensajeAdicional(from, toNumber, caption, img.url);
        }
      } catch (err) {
        console.error('[AUDIO] Error:', err.message);
        await enviarTexto(from, toNumber, 'No pude procesar tu audio. ¿Puedes escribir tu consulta? 😊');
      }
      return;
    }

    // ── OTRO ADJUNTO QUE NO PODEMOS LEER ───────────────────────────
    // Videos, PDFs, contactos, ubicaciones… Antes pasaban el filtro del webhook (traen
    // mediaUrl) y llegaban al modelo con el texto vacío: Elena respondía a nada. Ahora se
    // le dice al cliente qué sí podemos recibir, y si escribió algo junto al adjunto se
    // atiende ese texto con normalidad.
    if (mediaUrl && !mediaType?.startsWith('image/') && !mediaType?.startsWith('audio/')) {
      const tipo = (mediaType || '').split('/')[0];
      const aviso = tipo === 'video'
        ? 'Recibí tu video, pero por aquí solo alcanzo a ver fotos 🙏 ¿Me mandas una foto del mueble o me dices su nombre? Así te ayudo enseguida 😊'
        : 'Recibí tu archivo, pero por aquí solo puedo abrir fotos y notas de voz 🙏 ¿Me mandas una foto del mueble o me cuentas qué estás buscando? 😊';
      await enviarTexto(from, toNumber, aviso);
      db.addMensaje(from, 'user', `[el cliente envió un adjunto que no podemos leer: ${mediaType || 'desconocido'}]`).catch(() => {});
      db.addMensaje(from, 'assistant', aviso).catch(() => {});
      await db.actualizarLastInteraction(from);
      if (!incomingMsg) return;
      // Con texto acompañando el adjunto, se sigue al flujo normal para atenderlo.
    }

    const msgLow = incomingMsg.toLowerCase().replace(/^[¡!¿?\s]+/, '');

    // ── SALUDO PURO ────────────────────────────────────────────────
    // Solo en el PRIMER mensaje. Antes aplicaba siempre, así que un cliente en mitad del
    // flujo de compra que escribía "buenas" recibía otra vez el bloque de bienvenida
    // completo con categorías y horario, como si Elena no lo conociera.
    const esSoloSaludo = /^(hola|holis|holi|holaa|holaaa|buenas?|buenos\s*(dias?|tardes?|noches?)|que\s*tal|hi\b|hello\b|hey\b|saludos|como\s*est[aá]s?)[\s!.¡?]*$/.test(msgLow);
    // En conversaciones largas se pasan los últimos mensajes literales más un resumen de
    // los anteriores: antes se truncaba en 12 sin resumen y el agente olvidaba el principio,
    // incluido lo que el cliente ya había descartado.
    const { mensajes: historialPrevio } = await memoria.prepararHistorial(
      { db }, from, { openai, modeloRapido: MODELO_RAPIDO }
    );

    if (esSoloSaludo && historialPrevio.length === 0) {
      const saludado = await enviarTexto(from, toNumber, SALUDO_INICIAL);
      db.addMensaje(from, 'user', incomingMsg).catch(() => {});
      // Si el saludo no salió, no queda en el historial: así el próximo mensaje del
      // cliente vuelve a entrar como primer contacto y sí recibe la bienvenida.
      if (saludado) db.addMensaje(from, 'assistant', SALUDO_INICIAL).catch(() => {});
      return;
    }

    // ── LLAMADA A OPENAI ───────────────────────────────────────────
    // Sin carrera contra reloj: la respuesta sale por REST cuando esté lista, así que
    // el modelo puede usar todas sus rondas de herramientas (buscar, enviar fotos,
    // consultar carrito) sin que se corte a mitad.
    const { texto, imagenesParaEnviar, descartada } = await runAgentLoop(from, incomingMsg, { historial: historialPrevio });

    // Guardar en historial
    await db.addMensaje(from, 'user', incomingMsg);
    // Un asesor tomó el chat mientras la IA generaba la respuesta: queda guardado lo que
    // dijo el cliente (contexto para cuando la IA retome), pero no se le envía nada.
    if (descartada) return;
    await db.actualizarLastInteraction(from);

    log.info('respuesta', { texto: texto.substring(0, 120) });

    // La respuesta entra al historial solo si se entregó (ver enviarTexto): si Twilio
    // falla, en el turno siguiente Elena no puede darla por dicha.
    const entregadoTexto = await enviarTexto(from, toNumber, texto);
    if (entregadoTexto) await db.addMensaje(from, 'assistant', texto);

    // Las imágenes van como mensajes aparte, después del texto
    for (const img of imagenesParaEnviar) {
      const caption = `📸 ${img.nombre}`;
      await enviarMensajeAdicional(from, toNumber, caption, img.url);
    }

  } catch (error) {
    console.error('[ERROR] procesarMensaje:', error.message, error.stack?.split('\n')[1]);
    // Si un asesor ya está con el cliente, no tiene sentido ni el aviso de error ni
    // otra tarjeta pidiendo asesor: él ya lo está atendiendo.
    if (await db.asesorAtendiendo(from).catch(() => false)) return;
    // Si OpenAI está caído (ya se reintentó con backoff), no se molesta a un asesor por
    // cada cliente: durante una caída de dos minutos con 30 clientes activos eso eran 30
    // tarjetas falsas en el panel. Se le pide paciencia al cliente y solo se escala si el
    // fallo se repite en su siguiente mensaje — o si es un error nuestro, que sí hay que
    // atender a mano.
    const falloProveedor = reintentos.esFalloDelProveedor(error);
    const yaFalloAntes   = registrarFalloTecnico(from);

    if (falloProveedor && !yaFalloAntes) {
      alertar('OpenAI no responde', `${from} — ${error.message}`);
      await enviarTexto(from, toNumber, 'Se me complicó la conexión un momento 🙏 ¿Me repites tu último mensaje? Ya te atiendo 😊');
      return;
    }

    // Un error técnico deja al cliente sin respuesta útil: se avisa a un asesor con el
    // historial para que lo retome a mano, en vez de perderlo con un "intenta más tarde".
    let historialError = [];
    try { historialError = await db.getHistorial(from, 8); } catch { /* sin historial */ }
    notificarRedes(
      from,
      `Error técnico procesando el mensaje del cliente: ${error.message}. Revisar y contactar manualmente.`,
      historialError,
      'asesor'
    );
    const avisoError = avisoFueraHorario();
    await enviarTexto(from, toNumber, `Tuve un problema procesando tu mensaje. Un asesor te contactará pronto 🙏${avisoError ? `\n\n${avisoError}` : ''}`);
  }
}

// ─── RUTAS DE UTILIDAD ────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  res.json({ status: 'ok', agente: `${negocio.nombreAsesora} - ${negocio.nombreEmpresa}`, modelo: MODEL });
});

// Los endpoints administrativos exponen teléfonos, nombres, pedidos y citas de
// clientes reales, y permiten modificar citas. Antes cualquiera que conociera la URL
// podía llamarlos: validateTwilioRequest solo rechaza peticiones con `From` en el body y
// sin firma, así que un GET sin body pasaba limpio. Se protegen con el mismo token que
// ya usa el agente frente al sistema de ventas (header X-Agent-Token o ?token=). Sin
// token configurado se rechaza todo: mejor un 401 que exponer datos por defecto.
function requireAgentToken(req, res, next) {
  const token = process.env.DECASA_AGENT_TOKEN;
  const dado  = req.headers['x-agent-token'] ?? req.query.token;
  if (!token || dado !== token) return res.status(401).json({ error: 'no autorizado' });
  next();
}

app.post('/refresh-inventario', requireAgentToken, async (req, res) => {
  await cargarInventario();
  await cargarCatalogos();
  sincronizarHashesCatalogo().catch(e => console.error('[hash-imagen] error:', e.message));
  res.json({ status: 'ok', categorias: Object.keys(inventario).length, catalogos: Object.keys(catalogosDB).length });
});

// Métricas de negocio: el embudo del agente. Mismo formato que /stats del agente de
// Instagram para poder sumarlos en un panel único.
app.get('/stats', requireAgentToken, async (req, res) => {
  try {
    const dias = Math.min(Math.max(parseInt(req.query.dias ?? '30') || 30, 1), 365);
    res.json(await db.getMetricas(dias));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', async (req, res) => {
  let usuarios = 0, pedidos = 0, citas = 0;
  try {
    // citas_agentes es la tabla que escribe este agente (init-db.js); `citas` es la de
    // Laravel y aquí se consultaba por error.
    const [[u], [p], [c]] = await Promise.all([
      db.pool.query('SELECT COUNT(*) as c FROM clientes_wa'),
      db.pool.query('SELECT COUNT(*) as c FROM pedidos'),
      db.pool.query('SELECT COUNT(*) as c FROM citas_agentes')
    ]);
    usuarios = u[0].c; pedidos = p[0].c; citas = c[0].c;
  } catch {}
  res.json({
    status: 'ok', usuarios, pedidos, citas,
    categorias: Object.keys(inventario).length,
    catalogos: Object.keys(catalogosDB).length,
    modelo: MODEL
  });
});

// Endpoint para que el asesor marque una cita como confirmada o cancelada
app.post('/citas/:id/estado', requireAgentToken, async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body; // 'confirmada' | 'cancelada'
  if (!['confirmada', 'cancelada', 'pendiente'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido. Usa: confirmada, cancelada, pendiente' });
  }
  try {
    await db.pool.query('UPDATE citas_agentes SET estado = ? WHERE id = ?', [estado, id]);
    res.json({ status: 'ok', id, estado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para ver pedidos y citas (útil para el asesor)
app.get('/admin/resumen', requireAgentToken, async (req, res) => {
  try {
    const [[pedidos], [citas], [usuarios]] = await Promise.all([
      db.pool.query('SELECT p.id, u.telefono, p.producto, p.precio, p.cantidad, p.estado, p.created_at FROM pedidos p JOIN clientes_wa u ON p.usuario_id = u.id ORDER BY p.created_at DESC LIMIT 20'),
      db.pool.query('SELECT id, telefono, nombre, dia, hora, ubicacion, razon, estado, created_at FROM citas_agentes ORDER BY created_at DESC LIMIT 20'),
      db.pool.query('SELECT COUNT(*) as total FROM clientes_wa')
    ]);
    res.json({ usuarios: usuarios[0].total, pedidos, citas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── INICIO DEL SERVIDOR ──────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// Aviso al arrancar si el token con el que el agente se identifica ante el sistema de
// ventas sigue siendo uno de los valores por defecto: cualquiera que lo adivine podría
// inyectar pedidos y citas falsos en el panel.
function revisarSeguridad() {
  if (!process.env.OPENAI_API_KEY) console.error('[seguridad] ❌ OPENAI_API_KEY ausente: el agente no podrá responder.');
  const t = process.env.DECASA_AGENT_TOKEN;
  const debiles = ['', 'decasa_agent_2026', 'changeme', 'token', 'secret'];
  if (!t || debiles.includes(t)) {
    console.warn('[seguridad] ⚠️ DECASA_AGENT_TOKEN ausente o débil. Rótalo por un valor largo y aleatorio.');
  }
  if (!process.env.TWILIO_AUTH_TOKEN) {
    console.warn('[seguridad] ⚠️ TWILIO_AUTH_TOKEN ausente: la validación de firma del webhook queda desactivada.');
  }
}

async function startServer() {
  console.log(`[SERVER] 🔵 Iniciando ${negocio.nombreAsesora} - ${negocio.nombreEmpresa}...`);
  revisarSeguridad();
  try {
    await initDB();
    console.log('[SERVER] ✅ Base de datos conectada');
  } catch (err) {
    console.error('[SERVER] ❌ Error BD:', err.message);
  }

  const refrescarInventarioYHashes = async () => {
    await cargarInventario();
    await sincronizarHashesCatalogo();
  };
  await refrescarInventarioYHashes();
  await cargarCatalogos();
  setInterval(() => {
    refrescarInventarioYHashes().catch(e => console.error('[INVENTARIO] error refrescando:', e.message));
  }, 30 * 60 * 1000);
  setInterval(cargarCatalogos, 60 * 60 * 1000); // Catálogos cada hora

  const server = app.listen(PORT, () => {
    console.log(`[SERVER] ✅ Puerto ${PORT} | Modelo: ${MODEL}`);
  });

  setInterval(async () => {
    try { await db.limpiarConversacionesInactivas(db.VENTANA_CONVERSACION_MINUTOS); } catch {}
  }, 30 * 60 * 1000);

  // El historial ya no se borra por inactividad corta (el cliente vuelve al día
  // siguiente y su carrito y su conversación siguen ahí), así que hace falta un barrido
  // de fondo como el del agente de Instagram.
  db.limpiarHistorialAntiguo().catch(e => console.error('[DB] limpieza historial:', e.message));
  setInterval(() => {
    db.limpiarHistorialAntiguo().catch(e => console.error('[DB] limpieza historial:', e.message));
    db.limpiarSidsAntiguos().catch(e => console.error('[DB] limpieza sids:', e.message));
  }, 24 * 60 * 60 * 1000);

  // Worker de la cola de notificaciones al sistema de ventas: reintenta lo que no se
  // pudo entregar (API caída, timeout) para que ninguna solicitud de asesor, cita o
  // pedido se pierda en silencio.
  setInterval(() => {
    procesarColaNotificaciones().catch(e => console.error('[REDES] worker cola:', e.message));
  }, 60 * 1000);

  // Vigilancia del negocio: avisa si el agente deja de vender EN SILENCIO (inventario
  // vacío, ninguna conversación en horario, notificaciones que no llegan al panel). Las
  // otras alertas solo cubren que el proceso se caiga; esto cubre que siga en pie sin
  // servir para nada.
  vigilancia.iniciarVigilancia({
    contarConversaciones:          horas => db.contarConversacionesRecientes(horas),
    contarInventario:              () => Object.values(inventario).reduce((n, c) => n + (c.productos?.length ?? 0), 0),
    contarNotificacionesAtascadas: () => db.contarNotificacionesAtascadas(),
    estadoHorario:                 () => estadoHorario(),
    alertar,
  }, 30);

  // Seguimientos: recordatorios de cita y carrito abandonado. Solo se envían dentro de la
  // ventana de 24 h de la plataforma y nunca por encima de un asesor humano (ver
  // core/seguimientos.js).
  seguimientos.iniciarWorker(depsSeguimientos(), 10);

  const gracefulShutdown = (signal) => {
    console.log(`\n[SERVER] ${signal} recibido. Cerrando...`);
    server.close(() => { db.pool.end().catch(() => {}); });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer().catch(err => {
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}

module.exports = {
  app, startServer, TOOLS, extraerPrecios, validarPrecios, setPreciosInventarioParaPruebas,
  // Expuestos para pruebas del buffer de ráfagas y del troceo de mensajes largos.
  recibirMensaje, procesarMensaje, encolar, trocearTexto, DEBOUNCE_MS,
  // Expuestos para pruebas de variantes de precio.
  cargarInventario, infoPrecioVariantes, precioMinimo, encontrarVariante, recalcularPreciosInventario,
  buscarImagenProducto, buscarEnInventario,
  estadoHorario, MARGEN_CIERRE_TRANSFERENCIA_MIN,
};
