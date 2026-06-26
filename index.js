'use strict';

function alertarTelegramCrash(tipo, err) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🚨 <b>${tipo} — Elena DeCasa</b>\n<code>${String(err?.message || err).substring(0, 400)}</code>`,
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
const { MessagingResponse } = twilio.twiml;
const OpenAI = require('openai');
const { initDB } = require('./init-db');
const db = require('./db');
const { processRoomImage } = require('./image-processor');
const knowledge = require('./knowledge.json');
const utils = require('./utils');
const { fetchWithRetry } = require('./httpClient');

// ─── OPENAI ──────────────────────────────────────────────────────────────────

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ─── INVENTARIO Y CATÁLOGOS ───────────────────────────────────────────────────

let inventario = {};
// Catálogos cargados desde BD (actualizables sin redeploy)
let catalogosDB = Object.assign({}, knowledge.catalogos || {});

async function cargarInventario() {
  try {
    const nuevo = await db.getInventarioFromDB();
    if (nuevo && Object.keys(nuevo).length > 0) {
      inventario = nuevo;
      utils.setInventario(inventario);
      console.log('[INVENTARIO] ✅ Cargado:', Object.keys(inventario).length, 'categorías');
    }
  } catch (err) {
    console.error('[INVENTARIO] ❌ Error:', err.message);
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

// ─── RATE LIMITING ───────────────────────────────────────────────────────────

const _rateLimitMap = new Map();
// MessageSid dedup: evita que reintentos de Twilio procesen el mismo mensaje dos veces
const _processedSids = new Set();

function estaEnCooldown(telefono) {
  const ultima = _rateLimitMap.get(telefono) || 0;
  const ahora = Date.now();
  if (ahora - ultima < 1500) return true;
  _rateLimitMap.set(telefono, ahora);
  return false;
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

setInterval(() => {
  const limite = Date.now() - 60 * 60 * 1000;
  for (const [key, ts] of _rateLimitMap.entries()) {
    if (ts < limite) _rateLimitMap.delete(key);
  }
}, 60 * 60 * 1000);

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

function formatearMoneda(valor) {
  return '$' + Number(valor).toLocaleString('es-CO');
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

const UBICACIONES = {
  1: 'Avenida Bolívar # 16 N 26, Armenia, Quindío',
  2: 'Km 2 vía El Edén, Armenia, Quindío',
  3: 'Km 1 vía Jardines, Armenia, Quindío',
  4: 'C.C. Unicentro, Pereira, Risaralda',
  5: 'Cra. 14 #11-93, Pereira, Risaralda'
};

const SEDE_NOMBRE = {
  1: 'Decasa Bolívar — Av. Bolívar # 16 N 26, Armenia',
  2: 'Decasa Vía El Edén — Km 2 vía El Edén, Armenia',
  3: 'Decasa Vía Jardines — Km 1 vía Jardines, Armenia',
  4: 'Decasa Unicentro — C.C. Unicentro, Pereira',
  5: 'Decasa Circunvalar — Cra. 14 #11-93, Pereira',
};

const SEDE_TIENDA_ID = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

// ─── NOTIFICACIONES → SISTEMA DE VENTAS DECASA ───────────────────────────────

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor', extra = {}) {
  const apiUrl   = process.env.DECASA_API_URL;
  const apiToken = process.env.DECASA_AGENT_TOKEN;
  if (!apiUrl) {
    console.warn('[REDES] DECASA_API_URL no configurado — notificación omitida');
    return;
  }

  const telefonoLimpio = telefono.replace(/\D/g, '');
  const nombreCliente  = extra.nombre || null;
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

  try {
    await fetchWithRetry(`${apiUrl}/api/redes/webhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': apiToken || '' },
      body:    JSON.stringify(payload)
    }, 2, 25000);
    console.log(`[REDES] Notificación ${tipo} enviada al sistema`);
  } catch (e) {
    console.error('[REDES] Error enviando notificación:', e.message);
  }
}

// Envía un mensaje adicional via Twilio (para segunda foto en comparaciones)
async function enviarMensajeAdicional(from, toNumber, body, mediaUrl) {
  try {
    const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const msg = { from: toNumber, to: from };
    if (body) msg.body = body;
    if (mediaUrl) msg.mediaUrl = [mediaUrl];
    await twilioClient.messages.create(msg);
  } catch (e) {
    console.error('[TWILIO] Error enviando mensaje adicional:', e.message, e.code || '', e.status || '');
  }
}

// ─── BÚSQUEDA EN INVENTARIO ───────────────────────────────────────────────────

function buscarEnInventario(consulta, categoria, limite = 6) {
  const q = normalizarTexto(consulta);
  const palabras = q.split(/\s+/).filter(p => p.length >= 2);

  const cats = categoria && inventario[categoria]
    ? { [categoria]: inventario[categoria] }
    : inventario;

  const resultados = [];
  for (const [catKey, catData] of Object.entries(cats)) {
    if (!catData?.productos) continue;
    for (const prod of catData.productos) {
      const nombre = normalizarTexto(prod.nombre);
      const material = normalizarTexto(prod.material || '');
      let score = 0;
      for (const p of palabras) {
        if (nombre.includes(p)) score += p.length * 2;
        else if (material.includes(p)) score += p.length;
        // Fuzzy: acepta palabras similares con 1 carácter diferente
        else if (p.length >= 5) {
          for (const pn of nombre.split(/\s+/)) {
            if (Math.abs(p.length - pn.length) <= 1 && pn.startsWith(p.substring(0, p.length - 1))) {
              score += p.length;
            }
          }
        }
      }
      if (score > 0) {
        resultados.push({
          nombre: prod.nombre, precio: prod.precio,
          material: prod.material || null, medidas: prod.medidas || null,
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null, imagen2: prod.imagen2 || null,
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
      const precio = parsearPrecio(prod.precio);
      if (precio > 0 && precio <= presupuestoMax) {
        resultados.push({
          nombre: prod.nombre, precio: prod.precio, precioNumerico: precio,
          material: prod.material || null, medidas: prod.medidas || null,
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null, imagen2: prod.imagen2 || null,
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

function buscarImagenProducto(nombreProducto) {
  const q = normalizarTexto(nombreProducto);
  const palabras = q.split(/\s+/).filter(p => p.length >= 2);

  let mejor = null, mejorScore = 0;
  for (const catData of Object.values(inventario)) {
    for (const prod of (catData.productos || [])) {
      if (!prod.imagen) continue;
      const nombre = normalizarTexto(prod.nombre);
      let score = 0;
      for (const p of palabras) {
        if (nombre.includes(p)) score += p.length;
      }
      if (score > mejorScore) { mejorScore = score; mejor = prod; }
    }
  }
  return mejorScore > 0 ? { nombre: mejor.nombre, imagen: mejor.imagen, imagen2: mejor.imagen2 || null } : null;
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const _SYSTEM_PROMPT_BASE = `Eres Elena, asesora de ventas experta y amable de DeCasa, tienda especializada en muebles de madera Flor Morado de alta calidad.

IDENTIDAD:
- Nombre: Elena | Empresa: DeCasa
- Especialidad: Muebles de madera Flor Morado
- Horario: Lunes-Viernes 8am-5pm | Sábado 8am-12pm
- Instagram: @muebles_decasa

SEDES (usa el número en agendar_cita):
1. Avenida Bolívar # 16 N 26, Armenia, Quindío
2. Km 2 vía El Edén, Armenia, Quindío
3. Km 1 vía Jardines, Armenia, Quindío
4. C.C. Unicentro, Pereira, Risaralda
5. Cra. 14 #11-93, Pereira, Risaralda

CATEGORÍAS DE PRODUCTOS:
camas | bases_comedores | sillas_comedor | sillas_auxiliares | sillas_barra
mesas_centro | mesas_auxiliares | mesas_noche | mesas_tv
sofas | sofas_modulares | sofas_camas | cajoneros_bifes | escritorios | colchones

INSTRUCCIONES OBLIGATORIAS:
1. SIEMPRE usa buscar_productos antes de mencionar cualquier producto o precio
2. NUNCA inventes precios, nombres o disponibilidad — solo lo que veas en el inventario
3. Cuando el cliente mencione un presupuesto o diga "barato/económico" → usa buscar_por_presupuesto
4. Cuando el cliente pregunte sobre disponibilidad ("¿tienes X?", "¿hay X?", "¿en qué tienda está?", "¿dónde lo puedo ver?") → responde siempre: "¡Seguramente sí! 😊 En DeCasa manejamos buen stock y lo que no tengamos en tienda lo fabricamos al mismo precio desde nuestro taller. ¿Quieres que te comunique con un asesor para confirmar disponibilidad y coordinar?" — luego espera su respuesta. Si el cliente dice que sí quiere confirmar → llama transferir_asesor. NUNCA menciones una tienda específica.
4. Para ver carrito → llama ver_carrito
5. Para fotos de productos → usa enviar_foto. En tu texto escribe algo como "Te envío la foto a continuación 👇" para que el cliente sepa que la imagen llega justo después (se envía como mensaje separado)
6. Para catálogos PDF → usa enviar_catalogo y muestra la URL tal cual (sin markdown), para que WhatsApp la haga tappable
7. Para agendar visita → recopila nombre, sede (1-5), día con fecha exacta (ej: "martes 3 de junio"), hora, y pregunta el motivo una sola vez al final ("¿Tienes algún producto o motivo de visita en mente? (no es obligatorio)"). Si el cliente no lo da, llama agendar_cita sin motivo. NUNCA inventes ni inferras el motivo del contexto.
8. SOLO llama agregar_al_carrito cuando el cliente CONFIRME explícitamente que quiere comprar ese producto. "Me gusta", "me parece bien", "bonita", "qué chévere", "me gustó" NO son confirmaciones — pregunta primero "¿La agrego al carrito?" antes de llamar agregar_al_carrito. Solo agrega si el cliente dice cosas como "sí agrégala", "quiero comprarla", "ponla en el carrito", "sí la quiero".
9. Si el cliente dice "quita X", "ya no quiero X", "elimina X", "borra X del carrito" → llama quitar_del_carrito con el nombre del producto
10. Si quiere vaciar todo el carrito → llama quitar_del_carrito sin el campo producto
11. Para finalizar la compra → llama confirmar_pedido (solo cuando el cliente confirme explícitamente)
NUNCA llames transferir_asesor cuando el cliente quiera comprar — usa siempre el flujo de carrito

DISPONIBILIDAD EN TIENDAS — REGLA ABSOLUTA:
- NUNCA digas en qué tienda específica está un producto — no tienes esa información en tiempo real
- Si el cliente pregunta "¿tienes X?", "¿está disponible?", "¿en qué tienda?", "¿hay unidades?" → responde siempre de forma positiva general: "¡Seguramente sí! En DeCasa manejamos buen stock y lo que no esté en tienda lo fabricamos al mismo precio 🏭" y ofrece conectar con asesor
- Si el cliente quiere confirmar disponibilidad exacta o coordinar visita → llama transferir_asesor
- NUNCA menciones una tienda específica ni inventes dónde está disponible

ENTREGA Y VISITAS:
- DeCasa hace entregas a domicilio — el cliente NO necesita ir a la tienda para comprar
- Menciónalo proactivamente cuando el cliente muestre interés real: "te lo llevamos a tu casa 🚚, no tienes que desplazarte"
- Si el cliente dice que quiere ir a verlo ("quiero verlo", "voy a la tienda", "prefiero ir", "paso por allá") → invítalo a agendar una cita: "¡Perfecto! Para que te atendamos bien y tengamos el producto listo, agendemos tu visita 😊 ¿Cómo te llamas?" y sigue el flujo de agendar_cita
- COSTO DE ENVÍO: GRATIS en todo el Quindío y en Pereira (Risaralda). Para destinos fuera del Quindío o Risaralda hay un costo adicional de transportadora — infórmalo y pregunta: "¿Quieres que te comunique con un asesor para que te dé el valor exacto del envío?" → solo transfiere si el cliente dice que sí
- Para preguntas sobre tiempo de entrega, instalación o garantía → transfiere al asesor

CUÁNDO TRANSFERIR AL ASESOR (llama transferir_asesor INMEDIATAMENTE):
- El cliente lo pide explícitamente ("quiero hablar con alguien", "necesito un asesor", "me comunicas")
- El cliente confirma que SÍ quiere hablar con el asesor para detalles de ADDI, cuotas, financiación o descuentos exactos
- El cliente pide un producto a medida, color especial o personalización
- El cliente confirma que SÍ quiere hablar con el asesor para saber el costo de envío fuera del Quindío/Risaralda, o pregunta por instalación o garantía
- buscar_productos devuelve 0 resultados y el cliente insiste en ese producto
- El cliente lleva 2+ mensajes con la misma duda sin resolución
- El cliente expresa frustración ("no me ayudas", "no entiendes", "esto no sirve")
- Hay una pregunta que no puedes responder con certeza
Al transferir: dile al cliente que un asesor humano lo contactará pronto y despídete amablemente. Si el resultado incluye aviso_horario con texto, inclúyelo literalmente en tu respuesta.
El campo 'razon' de transferir_asesor debe ser un resumen claro en 1-2 líneas para el vendedor. Incluye siempre:
• Qué quiere el cliente: comprar en tienda / que lo fabriquen / personalizar / consultar envío / otro
• Nombre exacto del producto de interés (si lo mencionó)
• Si el cliente quiere confirmar disponibilidad o visitar tienda: inclúyelo en el motivo
Ejemplos correctos:
- "Quiere confirmar disponibilidad y visitar tienda para Sofá Medellín 3P."
- "Quiere que le fabriquen Cama Lisboa 2P."
- "Quiere personalizar Sofá Roma con tela verde y patas negras."
- "Pregunta por costo de envío para Silla Cali a Manizales."

TÉRMINOS AMBIGUOS — pregunta ANTES de buscar:
- "sillas" → "¿Buscas sillas de comedor, sillas auxiliares (sala/decoración) o sillas de barra?"
- "mesas" → "¿Buscas mesa de centro, mesa auxiliar, mesa de noche o mesa para TV?"
- "sofá/sofas" sin más contexto → "¿Buscas sofá tradicional, sofá modular o sofá cama?"
- "comedor" / "juego de comedor" / "conjunto comedor" → "¡Ojo importante! 😊 En DeCasa la base (mesa) y las sillas se venden por separado. ¿Buscas la base, las sillas, o te muestro ambas para que armes tu juego completo?"
No hagas esta pregunta si el cliente YA especificó el tipo (ej: "sillas de comedor", "base de comedor").

REGLAS DE VENTA:
- Sillas se venden por UNIDAD, separadas de las bases de comedor
- FORMAS DE PAGO: efectivo, transferencia bancaria y ADDI (crédito). NO se acepta tarjeta de crédito directamente
- DESCUENTOS: aplican SOLO con pago en efectivo o transferencia bancaria. NO aplican con tarjeta de crédito ni con ADDI. Si el cliente pregunta cuánto es el descuento → dile que aplica con efectivo o transferencia y que el valor varía, luego pregunta: "¿Quieres que te comunique con un asesor para que te indique el descuento exacto?" → solo transfiere si el cliente dice que sí
- ADDI: es el único sistema de crédito que manejamos. Si el cliente pregunta por ADDI, Sistecredito, crédito, cuotas, financiación o cualquier otra forma de crédito → dile que el crédito disponible es ADDI y pregunta: "¿Quieres que te comunique con un asesor para darte todos los detalles?" → solo transfiere si el cliente dice que sí
- Siempre ofrece 2-3 opciones cuando el cliente pregunta por una categoría
- Si el precio le parece alto, llama buscar_por_presupuesto con su presupuesto y la misma categoría
- Destaca: "Madera Flor Morado, resistencia y elegancia garantizada"
- Cierra siempre con una pregunta que lleve al siguiente paso: "¿Para qué espacio la tienes pensada?", "¿Quieres verla en foto?", "¿Te agendo una visita para verla en persona?"
- Cuando muestres productos incluye precio, material y medidas
- Ofrece complemento natural: sofá → mesa de centro; cama → colchón o mesa de noche; base de comedor → sillas (aclarando que se venden por separado); sillas → base de comedor
- Si el cliente ya vio un producto, ofrece el complemento antes de cerrar la conversación
- Crea urgencia suave: "es de los más pedidos", "la tienes disponible en exhibición en Armenia"
- Máximo 150 palabras por respuesta. Emojis moderados (1-2 por respuesta)

FLUJO DE AGENDAMIENTO:
Pide en orden: nombre completo → sede → fecha exacta → hora. El motivo es OPCIONAL: solo inclúyelo si el cliente lo menciona, NUNCA lo inventes ni lo inferas del contexto.
Para la fecha pide el DÍA DE LA SEMANA, el NÚMERO DE DÍA, el MES y el AÑO (ej: "martes 3 de junio de 2026", "viernes 20 de julio de 2026"). No aceptes una fecha sin año ni solo el nombre del día. Si el cliente da una fecha ambigua ("el miércoles", "el 1 de noviembre"), usa FECHA ACTUAL para calcular la fecha correcta y CONFIRMA antes de agendar: "¿Confirmamos para el [día de semana] [número] de [mes] de [año]?". NUNCA llames agendar_cita con una fecha que no hayáis confirmado explícitamente.
El motivo es OPCIONAL: pregúntalo una sola vez ("¿Tienes algún producto o motivo de visita? (no es obligatorio)") — si no quiere darlo, llama agendar_cita igual. NUNCA inventes ni inferras el motivo del contexto.
Al pedir la sede, SIEMPRE muestra la lista completa:
  1. Avenida Bolívar # 16 N 26, Armenia
  2. Km 2 vía El Edén, Armenia
  3. Km 1 vía Jardines, Armenia
  4. C.C. Unicentro, Pereira
  5. Cra. 14 #11-93, Pereira
Cuando tengas nombre, sede, fecha y hora llama agendar_cita. Extrae solo el nombre sin frases como "me llamo" o "mi nombre es". Después de confirmar la cita, pregunta si hay algo más en lo que puedas ayudar.

FLUJO DE COMPARACIÓN:
Cuando el cliente quiera comparar dos productos: llama buscar_productos para cada uno, presenta la comparación y luego llama enviar_foto dos veces (una por producto) para enviar ambas imágenes.

TONO Y ESTILO:
Eres una vendedora cálida, entusiasta y persuasiva — como una amiga experta en decoración que quiere ayudarte a tomar la mejor decisión. No eres un catálogo de datos.
- Nunca respondas solo con datos. Siempre añade emoción, beneficio o pregunta de cierre
- Destaca beneficios según el contexto: "perfecta si tienes niños o mascotas", "la madera Flor Morado no se astilla ni decolora"
- Si el precio asusta, llama buscar_por_presupuesto antes de rendirte
- Responde SIEMPRE en español. Máximo 150 palabras.`;

function buildSystemPrompt() {
  const ahora = new Date()
  const diasSemana = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const fechaHoy = `${diasSemana[ahora.getDay()]} ${ahora.getDate()} de ${meses[ahora.getMonth()]} de ${ahora.getFullYear()}`
  return `FECHA ACTUAL: Hoy es ${fechaHoy}. Usa esta fecha para resolver referencias relativas como "el miércoles", "esta semana", "el próximo viernes".\n\n` + _SYSTEM_PROMPT_BASE
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el catálogo por nombre, descripción o categoría. Solo devuelve precio, material y medidas. NO incluye stock ni disponibilidad en tiendas.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Texto de búsqueda: nombre del producto o descripción (ej: "cama doble", "silla comedor", "sofa modular")'
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
      name: 'agendar_cita',
      description: 'Guarda una cita de visita a tienda. Recopila TODA la info primero y luego llama esta función. El nombre debe ser solo el nombre (sin "me llamo" ni "mi nombre es").',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo del cliente (solo el nombre, sin frases introductorias)' },
          ubicacion: { type: 'number', description: 'Número de sede (1-5)' },
          dia: { type: 'string', description: 'Fecha de la visita con día de la semana, número de día, mes y año (ej: "martes 3 de junio de 2026", "viernes 20 de julio de 2026"). SIEMPRE incluye el año. NUNCA inventes ni asumas el año — confírmalo con el cliente si es ambiguo.' },
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
      name: 'transferir_asesor',
      description: 'Transfiere al cliente con un asesor humano cuando lo solicite o cuando no puedas resolver su consulta.',
      parameters: {
        type: 'object',
        properties: {
          razon: { type: 'string', description: 'Motivo de la transferencia' }
        },
        required: ['razon']
      }
    }
  },
];

function avisoHorarioTarde() {
  const h = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false }))
  return (h >= 21 || h < 8)
    ? 'Ya es tarde (después de las 9pm). Avisa al cliente que el asesor puede que le responda mañana, pero que harán su mejor esfuerzo. Agradece su paciencia.'
    : null
}

// ─── EJECUTAR HERRAMIENTAS ────────────────────────────────────────────────────

async function ejecutarHerramienta(nombre, args, from, historial) {
  const telefono = from.replace('whatsapp:', '');

  switch (nombre) {

    case 'buscar_productos': {
      const { consulta, categoria, limite = 5 } = args;
      const resultados = buscarEnInventario(consulta, categoria, Math.min(Number(limite) || 5, 10));
      if (resultados.length === 0) {
        return {
          encontrados: 0,
          mensaje: `No encontré productos para "${consulta}".`,
          sugerencia: 'Prueba con otra categoría o un término diferente.'
        };
      }
      return {
        encontrados: resultados.length,
        productos: resultados.map(p => ({
          nombre: p.nombre, precio: p.precio,
          material: p.material, medidas: p.medidas,
          foto_disponible: p.tieneImagen, categoria: p.categoriaNombre
        }))
      };
    }

    case 'buscar_por_presupuesto': {
      const { presupuesto_max, categoria } = args;
      const presupuesto = Number(presupuesto_max);
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
      return {
        encontrados: resultados.length,
        presupuesto: formatearMoneda(presupuesto),
        productos: resultados.map(p => ({
          nombre: p.nombre, precio: p.precio,
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
        const [citas] = await db.pool.query(
          'SELECT nombre, dia, hora, ubicacion, razon, estado FROM citas_agentes WHERE telefono = ? ORDER BY created_at DESC LIMIT 3',
          [telefono]
        );
        citasRecientes = citas.map(c => ({
          nombre: c.nombre, dia: c.dia, hora: c.hora,
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
      const { producto, precio, cantidad = 1 } = args;
      const items = await db.verCarrito(from);
      if (items.length >= 10) {
        return { exito: false, error: 'El carrito está lleno (máximo 10 productos). Confirma la compra o elimina algo primero.' };
      }
      const existe = items.find(i => i.producto.toLowerCase() === producto.toLowerCase());
      if (existe) {
        const nuevaCantidad = Number(cantidad) || existe.cantidad || 1;
        existe.cantidad = nuevaCantidad;
        await db.updateEstado(from, { carrito: items });
        const total = items.reduce((s, i) => s + parsearPrecio(i.precio) * (i.cantidad || 1), 0);
        return {
          exito: true, mensaje: `Cantidad de "${producto}" actualizada a ${nuevaCantidad} unidad${nuevaCantidad > 1 ? 'es' : ''}.`,
          items_en_carrito: items.length, total_carrito: formatearMoneda(total)
        };
      }
      // Guardar también como último producto visto
      await db.setUltimoProducto(from, { nombre: producto, precio, ts: Date.now() });
      await db.agregarAlCarrito(from, producto, precio, Number(cantidad) || 1);
      const itemsActualizados = await db.verCarrito(from);
      const total = itemsActualizados.reduce((s, i) => s + parsearPrecio(i.precio) * (i.cantidad || 1), 0);
      return {
        exito: true, mensaje: `${producto} agregado al carrito.`,
        items_en_carrito: itemsActualizados.length, total_carrito: formatearMoneda(total)
      };
    }

    case 'quitar_del_carrito': {
      const { producto } = args;
      if (!producto) {
        await db.limpiarCarrito(from);
        return { exito: true, mensaje: 'Carrito vaciado completamente.' };
      }
      const items = await db.verCarrito(from);
      const busqueda = normalizarTexto(producto).substring(0, 12);
      const actualizados = items.filter(i => !normalizarTexto(i.producto).includes(busqueda));
      if (actualizados.length === items.length) {
        return { exito: false, error: `No encontré "${producto}" en el carrito.`, items_actuales: items.map(i => i.producto) };
      }
      await db.updateEstado(from, { carrito: actualizados });
      return { exito: true, mensaje: 'Producto eliminado del carrito.', items_restantes: actualizados.length };
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
      await db.resetearEstadoSinPedido(from);
      enviarNotificacionTelegram(telefono, resumenItems.join('\n'), historial, 'pedido', { carrito: items }).catch(e =>
        console.error('[REDES] Error notificacion pedido:', e.message)
      );
      await db.limpiarConversaciones(from);
      // Mensaje de confirmación con resumen exacto — el campo 'mensaje_enviado' le indica a la IA que no lo repita
      return {
        exito: true,
        resumen: resumenItems.join('\n'),
        total: formatearMoneda(total),
        mensaje_confirmacion: `¡Pedido confirmado! 🎉\n\n${resumenItems.join('\n')}\n\n*Total: ${formatearMoneda(total)}*\n\nUn asesor de DeCasa te contactará pronto para coordinar el pago y la entrega. ¡Gracias por elegir DeCasa! 😊`,
        instruccion_ia: 'Comparte el mensaje_confirmacion tal cual al cliente, sin cambiar nada. Luego solo añade una frase corta de despedida.'
      };
    }

    case 'enviar_foto': {
      const { nombre_producto } = args;
      const resultado = buscarImagenProducto(nombre_producto);
      if (!resultado) {
        return {
          exito: false,
          error: `No encontré imagen para "${nombre_producto}". Ese producto puede no tener foto disponible.`
        };
      }
      // Actualizar último producto visto (imagen incluida para visualización)
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

      if (Number(ubicacion) < 1 || Number(ubicacion) > 5) {
        return { exito: false, error: 'Sede inválida. Debe ser un número del 1 al 5.' };
      }

      const diaLimpio = normalizarTexto(dia);
      const diasValidos = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      if (!diasValidos.some(d => diaLimpio.includes(d))) {
        return { exito: false, error: 'Día inválido. Atendemos de lunes a viernes y sábados.' };
      }

      const horaMatch = String(hora).match(/^(\d{1,2})(?::(\d{2}))?$/);
      if (!horaMatch) {
        return { exito: false, error: 'Formato de hora inválido. Ejemplo válido: "14:00" o "9".' };
      }
      const h = parseInt(horaMatch[1]);
      const esSabado = diaLimpio.includes('sabado');
      const horaMax = esSabado ? 11 : 17;
      if (h < 8 || h > horaMax) {
        return { exito: false, error: `Hora fuera de horario. ${esSabado ? 'Sábado: 8am-12pm.' : 'Lunes-Viernes: 8am-5pm.'}` };
      }

      const horaFormateada = `${String(h).padStart(2, '0')}:${horaMatch[2] || '00'}`;
      const diaCapitalizado = diaLimpio.charAt(0).toUpperCase() + diaLimpio.slice(1);
      // Limpiar el nombre de frases introductorias comunes
      const nombreLimpio = nombre.replace(/^(me llamo|mi nombre es|soy)\s+/i, '').trim();

      await db.guardarCita(from, {
        nombre: nombreLimpio, ubicacion: Number(ubicacion),
        dia: diaCapitalizado, hora: horaFormateada, razon: motivo
      });

      const sedeNombre = SEDE_NOMBRE[Number(ubicacion)] ?? UBICACIONES[Number(ubicacion)]
      const tiendaId   = SEDE_TIENDA_ID[Number(ubicacion)] ?? null
      const motivoFinal = motivo || null
      const datosCita  = { nombre: nombreLimpio, ubicacion: Number(ubicacion), sede_nombre: sedeNombre, dia: diaCapitalizado, hora: horaFormateada, motivo: motivoFinal }

      const resumenCita = `${nombreLimpio} — ${sedeNombre} — ${diaCapitalizado} ${horaFormateada}${motivoFinal ? ` — ${motivoFinal}` : ''}`
      await enviarNotificacionTelegram(
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

    case 'transferir_asesor': {
      const { razon } = args;
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
      await enviarNotificacionTelegram(telefono, razonFinal, historial, 'asesor', { carrito: carritoActual.length ? carritoActual : undefined });
      await db.marcarTransferida(from);
      await db.limpiarConversaciones(from);
      const aviso = avisoHorarioTarde()
      return { exito: true, mensaje: 'Asesor notificado.', aviso_horario: aviso };
    }

    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

// ─── LLAMADA A OPENAI CON TOOL LOOP ──────────────────────────────────────────

async function callOpenAI(from, userMessage, historial) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...historial.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ];

  // Puede haber múltiples imágenes (comparaciones)
  const imagenesParaEnviar = [];

  for (let ronda = 0; ronda < 6; ronda++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 900
    });

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

        console.log(`[TOOL] ${toolCall.function.name}(${JSON.stringify(toolArgs).substring(0, 80)})`);
        const resultado = await ejecutarHerramienta(toolCall.function.name, toolArgs, from, historial);

        // Coleccionar imágenes de productos (permite comparaciones con múltiples fotos)
        // Los catálogos PDF NO se envían como attachment — Google Drive no sirve como CDN
        // directo y WhatsApp falla silenciosamente. La URL va en el texto de la respuesta.
        if (toolCall.function.name === 'enviar_foto' && resultado.exito) {
          if (resultado._imagenUrl) imagenesParaEnviar.push({ url: resultado._imagenUrl, nombre: resultado.nombre });
          if (resultado._imagen2Url) imagenesParaEnviar.push({ url: resultado._imagen2Url, nombre: resultado.nombre });
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(resultado)
        });
      }

    } else {
      const texto = choice.message.content || 'Disculpa, no pude generar una respuesta. Por favor intenta de nuevo. 😊';
      return { texto, imagenesParaEnviar };
    }
  }

  return {
    texto: 'Disculpa, tuve un problema procesando tu solicitud. Por favor intenta de nuevo. 😊',
    imagenesParaEnviar: []
  };
}

// ─── SALUDO INICIAL ───────────────────────────────────────────────────────────

const SALUDO_INICIAL = `¡Hola! 👋 Soy Elena, tu asesora de DeCasa.

🏠 Especialistas en muebles de madera Flor Morado (más de 200 productos)
📍 Tiendas en Armenia y Pereira

📦 Categorías: Sillas, Bases de Comedor, Camas, Mesas, Sofás, Colchones
🕐 Horario: L-V 8am-5pm | Sábado 8am-12pm

💬 ¿Qué mueble estás buscando hoy? 😊`;

// ─── WEBHOOK PRINCIPAL ────────────────────────────────────────────────────────

// Límite de tiempo para la respuesta de OpenAI (Twilio cancela a los 15s)
const OPENAI_TIMEOUT_MS = 13000;

app.post('/webhook', async (req, res) => {
  const incomingMsg = (req.body.Body || '').trim();
  const from = req.body.From || 'unknown';
  const toNumber = req.body.To || '';
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;
  const messageSid = req.body.MessageSid || req.body.SmsSid || '';

  console.log(`[MSG] ${from}: ${incomingMsg || '[media]'}`);

  if (!incomingMsg && !mediaUrl) return res.status(200).send('');

  // Rechazar reintentos de Twilio para el mismo mensaje
  if (yaFueProcesado(messageSid)) {
    console.log(`[DEDUP] ${from} — SID ya procesado: ${messageSid}`);
    return res.status(200).send('');
  }

  if (estaEnCooldown(from)) {
    console.log(`[RATE] ${from} en cooldown — ignorado`);
    return res.status(200).send('');
  }

  try {
    await db.verificarYLimpiarInactividad(from);
    await db.getOrCreateUsuario(from);

    // ── IMAGEN RECIBIDA DEL CLIENTE ─────────────────────────────────
    if (mediaUrl && mediaType?.startsWith('image/')) {
      // Visualización de sala: solo si el cliente lo pide explícitamente
      const esVisualizacion = !!incomingMsg &&
        /\b(sala|cuarto|habitaci[oó]n|ambiente|visualiz|pon\s+(el|la)|c[oó]mo\s+(quedar[íi]a[n]?|se\s+ver[íi]a[n]?|luce[n]?|queda[n]?)|quedar[íi]a[n]?\s+(bien|aqu[íi]|ac[aá]|en)|se\s+ver[íi]a[n]?\s+(bien|aqu[íi]|ac[aá])|queda[n]?\s+(bien|aqu[íi]|ac[aá]|en\s+este|en\s+mi)|ver\s+c[oó]mo\s+queda|quiero\s+ver\s+c[oó]mo)\b/i.test(incomingMsg);

      const twiml = new MessagingResponse();
      twiml.message(esVisualizacion
        ? '⏳ Procesando tu foto para mostrarte cómo quedaría el mueble... 🛋️'
        : '🔍 Recibí tu imagen, analizándola...');
      res.type('text/xml').send(twiml.toString());

      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        if (esVisualizacion) {
          // ── Replicate: superponer mueble en foto de sala ──────────
          const estado = await db.getEstado(from);
          const ultimoProd = estado.ultimo_producto;
          const sofaInfo = ultimoProd ? { nombre: ultimoProd.nombre, imagen: ultimoProd.imagen || null } : null;
          const result = await processRoomImage(mediaUrl, sofaInfo);
          if (result.success) {
            await twilioClient.messages.create({
              from: toNumber, to: from,
              body: `¡Así quedaría${ultimoProd ? ` el ${ultimoProd.nombre}` : ' el mueble'} en tu espacio! 😊\n¿Te gusta? ¿Lo agregamos al carrito?`,
              mediaUrl: [result.imageUrl]
            });
          } else {
            // Error en generación de imagen: caer al flujo Vision
            // para al menos mostrar opciones del catálogo con fotos
            await twilioClient.messages.create({
              from: toNumber, to: from,
              body: 'La visualización en tu espacio no está disponible ahora mismo 🛠️ Pero te muestro las mejores opciones de nuestro catálogo con fotos:'
            });
            // Reutilizar el flujo Vision con la misma imagen
            mediaUrl && (async () => {
              try {
                const { downloadFromTwilio } = require('./image-processor');
                const imageBuffer = await downloadFromTwilio(mediaUrl);
                const base64 = imageBuffer.toString('base64');
                const mime = (mediaType || 'image/jpeg').split(';')[0];
                const historial = await db.getHistorial(from, 6);
                const msgs = [
                  { role: 'system', content: buildSystemPrompt() },
                  ...historial.map(m => ({ role: m.role, content: m.content })),
                  { role: 'user', content: [
                    { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'low' } },
                    { type: 'text', text: (incomingMsg || 'El cliente quiere ver opciones de muebles similares.') + '\n\nIdentifica el tipo de mueble y muestra opciones del catálogo con fotos.' }
                  ]}
                ];
                for (let r = 0; r < 5; r++) {
                  const rv = await openai.chat.completions.create({ model: MODEL, messages: msgs, tools: TOOLS, tool_choice: 'auto', temperature: 0.7, max_tokens: 800 });
                  const cv = rv.choices[0];
                  if (cv.finish_reason === 'tool_calls' && cv.message.tool_calls) {
                    msgs.push({ role: 'assistant', content: cv.message.content || null, tool_calls: cv.message.tool_calls });
                    for (const tc of cv.message.tool_calls) {
                      let args = {}; try { args = JSON.parse(tc.function.arguments); } catch {}
                      const toolRes = await ejecutarHerramienta(tc.function.name, args, from, historial);
                      if (tc.function.name === 'enviar_foto' && toolRes.exito) {
                        if (toolRes._imagenUrl) await twilioClient.messages.create({ from: toNumber, to: from, body: `📸 ${toolRes.nombre}`, mediaUrl: [toolRes._imagenUrl] });
                        if (toolRes._imagen2Url) await twilioClient.messages.create({ from: toNumber, to: from, body: `📸 ${toolRes.nombre}`, mediaUrl: [toolRes._imagen2Url] });
                      }
                      msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolRes) });
                    }
                  } else {
                    const texto = cv.message.content || '¿Alguna te llama la atención?';
                    await twilioClient.messages.create({ from: toNumber, to: from, body: texto });
                    break;
                  }
                }
              } catch (visionErr) { console.error('[VISION-FALLBACK]', visionErr.message); }
            })();
          }

        } else {
          // ── OpenAI Vision: describir mueble y buscar similares ────
          const { downloadFromTwilio } = require('./image-processor');
          const imageBuffer = await downloadFromTwilio(mediaUrl);
          const base64 = imageBuffer.toString('base64');
          const mime = (mediaType || 'image/jpeg').split(';')[0];
          const contextoUsuario = incomingMsg || 'El cliente envió una foto de un mueble.';

          const historial = await db.getHistorial(from, 6);

          // Instrucción extra para vision: evita el rechazo de "no puedo identificar"
          const systemVision = buildSystemPrompt() + `

INSTRUCCIÓN PARA IMÁGENES: Cuando el cliente envía una foto de un mueble:
1. Identifica el TIPO de mueble (silla de comedor, sofá, cama, mesa, etc.) y la CATEGORÍA del catálogo.
2. Llama buscar_productos DOS VECES:
   a) Primera con la categoría exacta y limite:10 para obtener TODOS los productos de esa línea.
   b) Segunda (opcional) con descripción visual si hay características muy específicas.
3. Presenta los productos encontrados con precio, material y medidas.
4. Para los primeros 2-3 resultados con foto, llama enviar_foto INMEDIATAMENTE sin pedir permiso.
5. Dile al cliente: "Estas son todas nuestras opciones de [tipo]. ¿Alguna te llama la atención?"
NUNCA preguntes "¿quieres ver la foto?" — envíala directamente.
NUNCA digas que no puedes identificar productos. Clasifica el tipo y muestra el catálogo completo de esa categoría.`;

          const msgs = [
            { role: 'system', content: systemVision },
            ...historial.map(m => ({ role: m.role, content: m.content })),
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'low' } },
                { type: 'text', text: contextoUsuario + '\n\nDescribe las características visuales del mueble en la foto y busca opciones similares en nuestro catálogo con sus precios.' }
              ]
            }
          ];

          let respuesta = '';
          const imgs = [];

          // Loop de herramientas (hasta 5 rondas): permite buscar Y enviar fotos en el mismo turno
          for (let ronda = 0; ronda < 5; ronda++) {
            const rv = await openai.chat.completions.create({
              model: MODEL, messages: msgs, tools: TOOLS, tool_choice: 'auto',
              temperature: 0.7, max_tokens: 800
            });
            const cv = rv.choices[0];

            if (cv.finish_reason === 'tool_calls' && cv.message.tool_calls) {
              msgs.push({ role: 'assistant', content: cv.message.content || null, tool_calls: cv.message.tool_calls });
              for (const tc of cv.message.tool_calls) {
                let args = {};
                try { args = JSON.parse(tc.function.arguments); } catch {}
                console.log(`[VISION-TOOL] ${tc.function.name}(${JSON.stringify(args).substring(0, 80)})`);
                const toolRes = await ejecutarHerramienta(tc.function.name, args, from, historial);
                if (tc.function.name === 'enviar_foto' && toolRes.exito) {
                  if (toolRes._imagenUrl) imgs.push({ url: toolRes._imagenUrl, nombre: toolRes.nombre });
                  if (toolRes._imagen2Url) imgs.push({ url: toolRes._imagen2Url, nombre: toolRes.nombre });
                }
                msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolRes) });
              }
            } else {
              respuesta = cv.message.content || '¿Puedo ayudarte con algo más? 😊';
              break;
            }
          }
          if (!respuesta) respuesta = '¿Puedo ayudarte con algo más? 😊';

          await db.addMensaje(from, 'user', contextoUsuario);
          await db.addMensaje(from, 'assistant', respuesta);
          await db.actualizarLastInteraction(from);

          // Texto primero, luego imágenes por separado (más confiable en WhatsApp)
          await twilioClient.messages.create({ from: toNumber, to: from, body: respuesta });
          for (const img of imgs) {
            await twilioClient.messages.create({ from: toNumber, to: from, body: `📸 ${img.nombre}`, mediaUrl: [img.url] });
          }
        }

      } catch (err) {
        console.error('[IMG] Error:', err.message);
        try {
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await twilioClient.messages.create({
            from: toNumber, to: from,
            body: '¡Recibí tu imagen! No pude procesarla en este momento. ¿Me describes el mueble que buscas? 😊'
          });
        } catch {}
      }
      return;
    }

    // ── AUDIO RECIBIDO DEL CLIENTE ──────────────────────────────
    if (mediaUrl && mediaType?.startsWith('audio/')) {
      const twiml = new MessagingResponse();
      twiml.message('🎧 Escuché tu audio, un momento...');
      res.type('text/xml').send(twiml.toString());

      try {
        const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
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
          await twilioClient.messages.create({ from: toNumber, to: from, body: 'No pude entender el audio. ¿Podrías escribir tu consulta? 😊' });
          return;
        }

        console.log(`[AUDIO→TEXTO] ${from}: ${textoTranscrito}`);

        const historialAudio = await db.getHistorial(from, 12);
        const resultadoAudio = await callOpenAI(from, textoTranscrito, historialAudio);

        await db.addMensaje(from, 'user', `🎤 ${textoTranscrito}`);
        await db.addMensaje(from, 'assistant', resultadoAudio.texto);
        await db.actualizarLastInteraction(from);

        await twilioClient.messages.create({ from: toNumber, to: from, body: resultadoAudio.texto });
        for (const img of resultadoAudio.imagenesParaEnviar) {
          const caption = img.esCatalogo ? '' : `📸 ${img.nombre}`;
          await enviarMensajeAdicional(from, toNumber, caption, img.url);
        }
      } catch (err) {
        console.error('[AUDIO] Error:', err.message);
        try {
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          await twilioClient.messages.create({ from: toNumber, to: from, body: 'No pude procesar tu audio. ¿Puedes escribir tu consulta? 😊' });
        } catch {}
      }
      return;
    }

    // ── SALUDO PURO ────────────────────────────────────────────────
    const msgLow = incomingMsg.toLowerCase().replace(/^[¡!¿?\s]+/, '');
    const esSoloSaludo = /^(hola|holis|holi|holaa|holaaa|buenas?|buenos\s*(dias?|tardes?|noches?)|que\s*tal|hi\b|hello\b|hey\b|saludos|como\s*est[aá]s?)[\s!.¡?]*$/.test(msgLow);

    if (esSoloSaludo) {
      // Responder de inmediato para que Twilio no reintente el webhook
      const twiml = new MessagingResponse();
      twiml.message(SALUDO_INICIAL);
      res.type('text/xml').send(twiml.toString());
      // BD en background (no bloquea la respuesta)
      db.updateEstado(from, { transferido: false }).catch(() => {});
      db.addMensaje(from, 'user', incomingMsg).catch(() => {});
      db.addMensaje(from, 'assistant', SALUDO_INICIAL).catch(() => {});
      return;
    }

    // ── USUARIO TRANSFERIDO A ASESOR ───────────────────────────────
    if (await db.estaTransferida(from)) {
      // Si el mensaje es claramente para el bot (citas, productos, bot) → resetear y dejar pasar al AI
      const esParaBot = /\b(agendar|cita|visita|producto|mueble|precio|cat[aá]logo|ver|mostrar|buscar|quiero|necesito|tengo|tendr[íi]a|carrito|comprar|sofá|sofa|silla|mesa|cama|colch[oó]n|armario|agente|bot|elena)\b/i.test(msgLow);
      if (esParaBot) {
        await db.updateEstado(from, { transferido: false });
      } else {
        const twiml = new MessagingResponse();
        twiml.message('✅ Tu mensaje fue recibido. El asesor te responderá pronto. 😊');
        res.type('text/xml').send(twiml.toString());
        const historialTelegram = await db.getHistorial(from, 6);
        enviarNotificacionTelegram(from.replace('whatsapp:', ''), incomingMsg, historialTelegram).catch(() => {});
        return;
      }
    }

    // ── LLAMADA A OPENAI CON TIMEOUT ───────────────────────────────
    const historial = await db.getHistorial(from, 12);

    let resultado;
    try {
      resultado = await Promise.race([
        callOpenAI(from, incomingMsg, historial),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI timeout')), OPENAI_TIMEOUT_MS)
        )
      ]);
    } catch (timeoutErr) {
      console.warn('[TIMEOUT] OpenAI tardó más de', OPENAI_TIMEOUT_MS, 'ms');
      const twiml = new MessagingResponse();
      twiml.message('Estoy procesando tu consulta, dame un momento... Por favor envía el mensaje nuevamente. 😊');
      return res.type('text/xml').send(twiml.toString());
    }

    const { texto, imagenesParaEnviar } = resultado;

    // Guardar en historial
    await db.addMensaje(from, 'user', incomingMsg);
    await db.addMensaje(from, 'assistant', texto);
    await db.actualizarLastInteraction(from);

    console.log(`[RESP] ${from}: ${texto.substring(0, 100)}...`);

    // Texto siempre vía TwiML (sin mediaUrl — imágenes por REST API son más confiables)
    const twiml = new MessagingResponse();
    twiml.message(texto);
    res.type('text/xml').send(twiml.toString());

    // Todas las imágenes vía Twilio REST API directa (más confiable que TwiML mediaUrl)
    if (imagenesParaEnviar.length > 0 && toNumber) {
      for (const img of imagenesParaEnviar) {
        const caption = img.esCatalogo ? '' : `📸 ${img.nombre}`;
        await enviarMensajeAdicional(from, toNumber, caption, img.url);
      }
    }

  } catch (error) {
    console.error('[ERROR] Webhook:', error.message, error.stack?.split('\n')[1]);
    const twiml = new MessagingResponse();
    twiml.message('Disculpa, estoy teniendo problemas técnicos. Por favor intenta más tarde. 😊');
    return res.type('text/xml').send(twiml.toString());
  }
});

// ─── RUTAS DE UTILIDAD ────────────────────────────────────────────────────────

app.get('/webhook', (req, res) => {
  res.json({ status: 'ok', agente: 'Elena - DeCasa', modelo: MODEL });
});

app.post('/refresh-inventario', async (req, res) => {
  await cargarInventario();
  await cargarCatalogos();
  res.json({ status: 'ok', categorias: Object.keys(inventario).length, catalogos: Object.keys(catalogosDB).length });
});

app.get('/health', async (req, res) => {
  let usuarios = 0, pedidos = 0, citas = 0;
  try {
    const [[u], [p], [c]] = await Promise.all([
      db.pool.query('SELECT COUNT(*) as c FROM clientes_wa'),
      db.pool.query('SELECT COUNT(*) as c FROM pedidos'),
      db.pool.query('SELECT COUNT(*) as c FROM citas')
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
app.post('/citas/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body; // 'confirmada' | 'cancelada'
  if (!['confirmada', 'cancelada', 'pendiente'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido. Usa: confirmada, cancelada, pendiente' });
  }
  try {
    await db.pool.query('UPDATE citas SET estado = ? WHERE id = ?', [estado, id]);
    res.json({ status: 'ok', id, estado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint para ver pedidos y citas (útil para el asesor)
app.get('/admin/resumen', async (req, res) => {
  try {
    const [[pedidos], [citas], [usuarios]] = await Promise.all([
      db.pool.query('SELECT p.id, u.telefono, p.producto, p.precio, p.cantidad, p.estado, p.created_at FROM pedidos p JOIN clientes_wa u ON p.usuario_id = u.id ORDER BY p.created_at DESC LIMIT 20'),
      db.pool.query('SELECT id, telefono, nombre, dia, hora, ubicacion, razon, estado, created_at FROM citas ORDER BY created_at DESC LIMIT 20'),
      db.pool.query('SELECT COUNT(*) as total FROM clientes_wa')
    ]);
    res.json({ usuarios: usuarios[0].total, pedidos, citas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── INICIO DEL SERVIDOR ──────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function startServer() {
  console.log('[SERVER] 🔵 Iniciando Elena - DeCasa...');
  try {
    await initDB();
    console.log('[SERVER] ✅ Base de datos conectada');
  } catch (err) {
    console.error('[SERVER] ❌ Error BD:', err.message);
  }

  await cargarInventario();
  await cargarCatalogos();
  setInterval(cargarInventario, 30 * 60 * 1000);
  setInterval(cargarCatalogos, 60 * 60 * 1000); // Catálogos cada hora

  const server = app.listen(PORT, () => {
    console.log(`[SERVER] ✅ Puerto ${PORT} | Modelo: ${MODEL}`);
  });

  setInterval(async () => {
    try { await db.limpiarConversacionesInactivas(45); } catch {}
  }, 30 * 60 * 1000);

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

module.exports = { app, startServer };
