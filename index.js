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

function estaEnCooldown(telefono) {
  const ultima = _rateLimitMap.get(telefono) || 0;
  const ahora = Date.now();
  if (ahora - ultima < 1500) return true;
  _rateLimitMap.set(telefono, ahora);
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UBICACIONES = {
  1: 'Av. Bolívar # 16 N 26, Armenia, Quindío',
  2: 'Km 2 vía El Edén, Armenia, Quindío',
  3: 'Km 1 vía Jardines, Armenia, Quindío',
  4: 'CC Unicentro Pereira, Risaralda',
  5: 'Cra. 14 #11 - 93, Pereira, Risaralda'
};

// ─── TELEGRAM NOTIFICACIONES ─────────────────────────────────────────────────

async function enviarNotificacionTelegram(telefono, mensaje, historial, tipo = 'asesor', extra = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const historialTexto = (historial || []).slice(-6).map(m =>
    `${m.role === 'user' ? '👤' : '🤖'} ${String(m.content).substring(0, 100)}`
  ).join('\n');

  const titulos = {
    asesor: '🆘 SOLICITUD DE ASESOR',
    pedido: '📦 NUEVO PEDIDO',
    cita: '📅 NUEVA CITA',
    personalizacion: '🎨 PERSONALIZACIÓN'
  };

  const titulo = titulos[tipo] || titulos.asesor;
  const productoLine = extra.producto ? `📌 <b>Producto:</b> ${extra.producto}\n` : '';
  const texto = `<b>${titulo} - DeCasa</b>
━━━━━━━━━━━━━━━━━━━━━
📱 <b>Cliente:</b> ${telefono}
${productoLine}💬 <b>Mensaje:</b> ${String(mensaje).substring(0, 200)}
🕐 <b>Hora:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
━━━━━━━━━━━━━━━━━━━━━
📋 <b>Historial:</b>
${historialTexto || '(sin historial)'}
━━━━━━━━━━━━━━━━━━━━━
💡 <a href="wa.me/${telefono.replace(/\D/g, '')}">Responder por WhatsApp</a>`;

  try {
    await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId, text: texto,
        parse_mode: 'HTML', disable_web_page_preview: true
      })
    }, 2, 10000);
    console.log(`[TELEGRAM] Notificación ${tipo} enviada`);
  } catch (e) {
    console.error('[TELEGRAM] Error:', e.message);
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
    console.error('[TWILIO] Error enviando mensaje adicional:', e.message);
  }
}

// ─── BÚSQUEDA EN INVENTARIO ───────────────────────────────────────────────────

function buscarEnInventario(consulta, categoria, limite = 6) {
  const q = normalizarTexto(consulta);
  const palabras = q.split(/\s+/).filter(p => p.length > 2);

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
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null,
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
      tieneImagen: !!p.imagen, imagen: p.imagen || null,
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
          tieneImagen: !!prod.imagen, imagen: prod.imagen || null,
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
  const palabras = q.split(/\s+/).filter(p => p.length > 2);

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
  return mejorScore > 0 ? { nombre: mejor.nombre, imagen: mejor.imagen } : null;
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres Elena, asesora de ventas experta y amable de DeCasa, tienda especializada en muebles de madera Flor Morado de alta calidad.

IDENTIDAD:
- Nombre: Elena | Empresa: DeCasa
- Especialidad: Muebles de madera Flor Morado
- Horario: Lunes-Viernes 8am-5pm | Sábado 8am-12pm
- Instagram: @muebles_decasa

SEDES (usa el número en agendar_cita):
1. Av. Bolívar # 16 N 26, Armenia, Quindío
2. Km 2 vía El Edén, Armenia, Quindío
3. Km 1 vía Jardines, Armenia, Quindío
4. CC Unicentro Pereira, Risaralda
5. Cra. 14 #11 - 93, Pereira, Risaralda

CATEGORÍAS DE PRODUCTOS:
camas | bases_comedores | sillas_comedor | sillas_auxiliares | sillas_barra
mesas_centro | mesas_auxiliares | mesas_noche | mesas_tv
sofas | sofas_modulares | sofas_camas | cajoneros_bifes | escritorios | colchones

INSTRUCCIONES OBLIGATORIAS:
1. SIEMPRE usa buscar_productos antes de mencionar cualquier producto o precio
2. NUNCA inventes precios, nombres o disponibilidad — solo lo que veas en el inventario
3. Cuando el cliente mencione un presupuesto o diga "barato/económico" → usa buscar_por_presupuesto
4. Cuando el cliente quiera ver su carrito o citas → usa consultar_estado
5. Para fotos de productos → usa enviar_foto. En tu texto escribe algo como "Te envío la foto a continuación 👇" para que el cliente sepa que la imagen llega justo después (se envía como mensaje separado)
6. Para catálogos PDF → usa enviar_catalogo y muestra la URL tal cual (sin markdown), para que WhatsApp la haga tappable
7. Para agendar visita → recopila nombre, sede (1-5), día, hora, motivo; luego llama agendar_cita
8. SOLO llama agregar_al_carrito cuando el cliente CONFIRME explícitamente que quiere comprar

CUÁNDO TRANSFERIR AL ASESOR (llama transferir_asesor INMEDIATAMENTE):
- El cliente lo pide explícitamente ("quiero hablar con alguien", "necesito un asesor", "me comunicas")
- El cliente pregunta por financiación, crédito, cuotas o formas de pago
- El cliente pide un producto a medida, color especial o personalización
- El cliente pregunta por domicilio, entrega, instalación o garantía
- buscar_productos devuelve 0 resultados y el cliente insiste en ese producto
- El cliente lleva 2+ mensajes con la misma duda sin resolución
- El cliente expresa frustración ("no me ayudas", "no entiendes", "esto no sirve")
- Hay una pregunta que no puedes responder con certeza
Al transferir: dile al cliente que un asesor humano lo contactará pronto y despídete amablemente.

REGLAS DE VENTA:
- Sillas se venden por UNIDAD, separadas de las bases de comedor
- Siempre ofrece 2-3 opciones cuando el cliente pregunta por una categoría
- Si el precio le parece alto, llama buscar_por_presupuesto con su presupuesto y la misma categoría
- Destaca: "Madera Flor Morado, resistencia y elegancia garantizada"
- Cierra siempre con una pregunta
- Cuando muestres productos incluye precio, material y medidas

FLUJO DE AGENDAMIENTO:
Pide en orden: nombre completo → sede (muestra las 5 opciones) → día → hora → motivo. Cuando tengas todo, llama agendar_cita. Extrae solo el nombre sin frases como "me llamo" o "mi nombre es".

FLUJO DE COMPARACIÓN:
Cuando el cliente quiera comparar dos productos: llama buscar_productos para cada uno, presenta la comparación y luego llama enviar_foto dos veces (una por producto) para enviar ambas imágenes.

TONO: Amable, profesional, persuasiva pero honesta. Emojis moderados.`;

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_productos',
      description: 'Busca productos en el inventario por nombre, descripción o categoría. Úsalo para cualquier pregunta sobre productos, precios, materiales o disponibilidad.',
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
          dia: { type: 'string', description: 'Día de la semana (Lunes, Martes, Miercoles, Jueves, Viernes, Sabado)' },
          hora: { type: 'string', description: 'Hora en formato HH:MM (ej: "14:00", "09:30")' },
          motivo: { type: 'string', description: 'Motivo de la visita' }
        },
        required: ['nombre', 'ubicacion', 'dia', 'hora', 'motivo']
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
  }
];

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
          'SELECT nombre, dia, hora, ubicacion, razon, estado FROM citas WHERE telefono = ? ORDER BY created_at DESC LIMIT 3',
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
        return { exito: false, error: `"${producto}" ya está en el carrito.` };
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
      await enviarNotificacionTelegram(telefono, 'Pedido confirmado via bot', historial, 'pedido');
      await db.limpiarConversaciones(from);
      return {
        exito: true, resumen: resumenItems.join('\n'),
        total: formatearMoneda(total),
        mensaje: 'Pedido registrado. Un asesor te contactará para confirmar entrega y pago.'
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
      // Actualizar último producto visto
      await db.setUltimoProducto(from, { nombre: resultado.nombre, ts: Date.now() });
      // No devolver el URL al modelo: evita que lo escriba en el texto como markdown
      return { exito: true, nombre: resultado.nombre, _imagenUrl: resultado.imagen, mensaje: `Foto de ${resultado.nombre} enviada al cliente.` };
    }

    case 'enviar_catalogo': {
      const { categoria } = args;
      const url = catalogosDB[categoria];
      if (!url) {
        const entrada = Object.entries(catalogosDB).find(([k]) =>
          k.includes(categoria) || categoria.includes(k)
        );
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
      const horaMax = esSabado ? 11 : 16;
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

      const msgTelegram = `📅 NUEVA CITA\n👤 ${nombreLimpio} (${telefono})\n📅 ${diaCapitalizado} ${horaFormateada}\n📍 ${UBICACIONES[Number(ubicacion)]}\n📝 ${motivo}`;
      await enviarNotificacionTelegram(telefono, msgTelegram, historial, 'cita');

      return {
        exito: true,
        cita: {
          nombre: nombreLimpio, sede: `${ubicacion}. ${UBICACIONES[Number(ubicacion)]}`,
          dia: diaCapitalizado, hora: horaFormateada, motivo
        }
      };
    }

    case 'transferir_asesor': {
      const { razon } = args;
      await enviarNotificacionTelegram(telefono, razon || 'Solicitud de asesor', historial, 'asesor');
      await db.marcarTransferida(from);
      await db.limpiarConversaciones(from);
      return { exito: true, mensaje: 'Asesor notificado vía Telegram.' };
    }

    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

// ─── LLAMADA A OPENAI CON TOOL LOOP ──────────────────────────────────────────

async function callOpenAI(from, userMessage, historial) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
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
        if (toolCall.function.name === 'enviar_foto' && resultado.exito && resultado._imagenUrl) {
          imagenesParaEnviar.push({ url: resultado._imagenUrl, nombre: resultado.nombre });
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

  console.log(`[MSG] ${from}: ${incomingMsg || '[media]'}`);

  if (!incomingMsg && !mediaUrl) return res.status(200).send('');

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
        /\b(sala|cuarto|habitaci[oó]n|ambiente|como\s+quedar[íi]a|visualiz|pon\s+(el|la)|quiero\s+ver\s+como)/i.test(incomingMsg);

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
          const sofaInfo = ultimoProd ? { nombre: ultimoProd.nombre } : null;
          const result = await processRoomImage(mediaUrl, sofaInfo);
          if (result.success) {
            await twilioClient.messages.create({
              from: toNumber, to: from,
              body: `¡Así quedaría${ultimoProd ? ` el ${ultimoProd.nombre}` : ' el mueble'} en tu espacio! 😊\n¿Te gusta? ¿Lo agregamos al carrito?`,
              mediaUrl: [result.imageUrl]
            });
          } else {
            await twilioClient.messages.create({
              from: toNumber, to: from,
              body: result.message || '¡Recibí tu foto! Por ahora no pude procesarla. ¿Qué tipo de mueble buscas? 😊'
            });
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
          const systemVision = SYSTEM_PROMPT + `

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
                if (tc.function.name === 'enviar_foto' && toolRes.exito && toolRes._imagenUrl) {
                  imgs.push({ url: toolRes._imagenUrl, nombre: toolRes.nombre });
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

    // ── SALUDO PURO ────────────────────────────────────────────────
    const msgLow = incomingMsg.toLowerCase();
    const esSoloSaludo = /^(hola|holis|holi|holaa|holaaa|buenas?|buenos\s*(dias?|tardes?|noches?)|que\s*tal|hi\b|hello\b|hey\b|saludos|como\s*est[aá]s?)[\s!.]*$/.test(msgLow);

    if (esSoloSaludo) {
      const twiml = new MessagingResponse();
      twiml.message(SALUDO_INICIAL);
      await db.addMensaje(from, 'user', incomingMsg);
      await db.addMensaje(from, 'assistant', SALUDO_INICIAL);
      return res.type('text/xml').send(twiml.toString());
    }

    // ── USUARIO TRANSFERIDO A ASESOR ───────────────────────────────
    if (await db.estaTransferida(from)) {
      const twiml = new MessagingResponse();
      twiml.message('✅ Tu mensaje fue recibido. El asesor te responderá pronto. 😊');
      res.type('text/xml').send(twiml.toString());
      const historialTelegram = await db.getHistorial(from, 6);
      enviarNotificacionTelegram(from.replace('whatsapp:', ''), incomingMsg, historialTelegram).catch(() => {});
      return;
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
      db.pool.query('SELECT COUNT(*) as c FROM usuarios'),
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
      db.pool.query('SELECT p.id, u.telefono, p.producto, p.precio, p.cantidad, p.estado, p.created_at FROM pedidos p JOIN usuarios u ON p.usuario_id = u.id ORDER BY p.created_at DESC LIMIT 20'),
      db.pool.query('SELECT id, telefono, nombre, dia, hora, ubicacion, razon, estado, created_at FROM citas ORDER BY created_at DESC LIMIT 20'),
      db.pool.query('SELECT COUNT(*) as total FROM usuarios')
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
