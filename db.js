require('dotenv').config();
const mysql = require('mysql2/promise');

// ─────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────

const TIMEOUT_INACTIVIDAD_MINUTOS = 45; // Aumentado de 10 a 45 min

function parseJSONField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'decasa_bot',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ─────────────────────────────────────────────
// USUARIO
// ─────────────────────────────────────────────

async function getOrCreateUsuario(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT * FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  let usuario;
  if (usuarios.length > 0) {
    await pool.query(
      'UPDATE usuarios SET last_interaction = NOW() WHERE id = ?',
      [usuarios[0].id]
    );
    usuario = usuarios[0];
  } else {
    const [result] = await pool.query(
      'INSERT INTO usuarios (telefono, created_at, last_interaction) VALUES (?, NOW(), NOW())',
      [telefonoLimpio]
    );
    const [nuevoUsuario] = await pool.query(
      'SELECT * FROM usuarios WHERE id = ?',
      [result.insertId]
    );
    usuario = nuevoUsuario[0];
  }

  const [estados] = await pool.query(
    'SELECT 1 FROM estado_usuario WHERE usuario_id = ?',
    [usuario.id]
  );
  if (estados.length === 0) {
    await pool.query(
      'INSERT INTO estado_usuario (usuario_id) VALUES (?)',
      [usuario.id]
    );
  }

  return usuario;
}

// ─────────────────────────────────────────────
// CONVERSACIONES
// ─────────────────────────────────────────────

async function getHistorial(telefono, limite = 12) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return [];

  const usuarioId = usuarios[0].id;

  const [mensajes] = await pool.query(
    `SELECT role, contenido FROM conversaciones 
     WHERE usuario_id = ? 
     ORDER BY created_at DESC LIMIT ?`,
    [usuarioId, limite]
  );

  return mensajes.reverse().map(m => ({
    role: m.role,
    content: m.contenido
  }));
}

async function addMensaje(telefono, role, contenido) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    const usuario = await getOrCreateUsuario(telefono);
    await pool.query(
      'INSERT INTO conversaciones (usuario_id, role, contenido, created_at) VALUES (?, ?, ?, NOW())',
      [usuario.id, role, contenido]
    );
  } else {
    await pool.query(
      'INSERT INTO conversaciones (usuario_id, role, contenido, created_at) VALUES (?, ?, ?, NOW())',
      [usuarios[0].id, role, contenido]
    );
  }
}

// ─────────────────────────────────────────────
// ESTADO DE USUARIO
// ─────────────────────────────────────────────

async function getEstado(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    return _estadoVacio();
  }

  const [estados] = await pool.query(
    'SELECT * FROM estado_usuario WHERE usuario_id = ?',
    [usuarios[0].id]
  );

  if (estados.length === 0) {
    return _estadoVacio();
  }

  const estado = estados[0];
  return {
    categoria_actual: estado.categoria_actual,
    producto_pendiente: parseJSONField(estado.producto_pendiente),
    ultimo_producto: parseJSONField(estado.ultimo_producto),
    carrito: parseJSONField(estado.carrito),
    transferido: !!estado.transferido,
    greeting_sent: !!estado.greeting_sent,
    tiene_pedido: !!estado.tiene_pedido,
    agendando_cita: !!estado.agendando_cita,
    paso_agenda: estado.paso_agenda || 0,
    datos_agenda: parseJSONField(estado.datos_agenda),
    candidatos_pendientes: parseJSONField(estado.candidatos_pendientes),
    subtipo_pendiente: parseJSONField(estado.subtipo_pendiente),
    comparacion_pendiente: parseJSONField(estado.comparacion_pendiente),
    comparacion_productos: parseJSONField(estado.comparacion_productos),
    transferencia_medida_pendiente: parseJSONField(estado.transferencia_medida_pendiente),
    presupuesto: estado.presupuesto || null
  };
}

function _estadoVacio() {
  return {
    categoria_actual: null,
    producto_pendiente: null,
    ultimo_producto: null,
    carrito: [],
    transferido: false,
    greeting_sent: false,
    tiene_pedido: false,
    agendando_cita: false,
    paso_agenda: 0,
    datos_agenda: null,
    candidatos_pendientes: null,
    subtipo_pendiente: null,
    comparacion_pendiente: null,
    comparacion_productos: null,
    transferencia_medida_pendiente: null,
    presupuesto: null
  };
}

async function updateEstado(telefono, datos) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) {
    await getOrCreateUsuario(telefono);
    return updateEstado(telefono, datos);
  }

  const usuarioId = usuarios[0].id;
  const campos = [];
  const valores = [];

  const camposJSON = ['producto_pendiente', 'carrito', 'datos_agenda', 'candidatos_pendientes',
    'subtipo_pendiente', 'comparacion_pendiente', 'comparacion_productos',
    'ultimo_producto', 'transferencia_medida_pendiente'];

  const camposBool = ['transferido', 'greeting_sent', 'tiene_pedido', 'agendando_cita'];

  const camposDirectos = ['categoria_actual', 'paso_agenda', 'presupuesto'];

  for (const [key, val] of Object.entries(datos)) {
    if (camposJSON.includes(key)) {
      campos.push(`${key} = ?`);
      valores.push(val !== null && val !== undefined ? JSON.stringify(val) : null);
    } else if (camposBool.includes(key)) {
      campos.push(`${key} = ?`);
      valores.push(val ? 1 : 0);
    } else if (camposDirectos.includes(key)) {
      campos.push(`${key} = ?`);
      valores.push(val !== undefined ? val : null);
    }
  }

  if (campos.length === 0) return;

  valores.push(usuarioId);

  await pool.query(
    `UPDATE estado_usuario SET ${campos.join(', ')} WHERE usuario_id = ?`,
    valores
  );
}

// ─────────────────────────────────────────────
// CARRITO
// ─────────────────────────────────────────────

async function agregarAlCarrito(telefono, producto, precio, cantidad = 1) {
  const estado = await getEstado(telefono);
  const carrito = estado.carrito || [];

  const itemExistente = carrito.find(item => item.producto === producto);
  if (itemExistente) {
    itemExistente.cantidad = (itemExistente.cantidad || 1) + cantidad;
  } else {
    carrito.push({ producto, precio, cantidad });
  }

  await updateEstado(telefono, { carrito });
  return true;
}

async function verCarrito(telefono) {
  const estado = await getEstado(telefono);
  return estado.carrito || [];
}

async function limpiarCarrito(telefono) {
  await updateEstado(telefono, { carrito: [] });
}

// ─────────────────────────────────────────────
// PRODUCTO PENDIENTE
// ─────────────────────────────────────────────

async function guardarProductoPendiente(telefono, producto, precio, cantidad = null) {
  await updateEstado(telefono, { producto_pendiente: { producto, precio, cantidad } });
}

async function getProductoPendiente(telefono) {
  const estado = await getEstado(telefono);
  return estado.producto_pendiente;
}

async function clearProductoPendiente(telefono) {
  await updateEstado(telefono, { producto_pendiente: null });
}

// ─────────────────────────────────────────────
// TRANSFERENCIA Y ESTADO
// ─────────────────────────────────────────────

async function setTransferenciaMedidaPendiente(telefono, producto) {
  await updateEstado(telefono, { transferencia_medida_pendiente: producto });
}

async function getTransferenciaMedidaPendiente(telefono) {
  const estado = await getEstado(telefono);
  return estado.transferencia_medida_pendiente;
}

async function clearTransferenciaMedidaPendiente(telefono) {
  await updateEstado(telefono, { transferencia_medida_pendiente: null });
}

async function estaTransferida(telefono) {
  const estado = await getEstado(telefono);
  return estado.transferido;
}

async function marcarTransferida(telefono) {
  await updateEstado(telefono, { transferido: true });
}

async function haEnviadoSaludo(telefono) {
  const estado = await getEstado(telefono);
  return estado.greeting_sent;
}

async function marcarSaludoEnviado(telefono) {
  await updateEstado(telefono, { greeting_sent: true });
}

// ─────────────────────────────────────────────
// CATEGORÍA Y PRODUCTO ACTIVO
// ─────────────────────────────────────────────

async function getCategoriaActual(telefono) {
  const estado = await getEstado(telefono);
  return estado.categoria_actual;
}

async function setCategoriaActual(telefono, categoria) {
  const catString = typeof categoria === 'string'
    ? categoria
    : (categoria?.nombre || categoria?.categoria || String(categoria) || null);
  await updateEstado(telefono, { categoria_actual: catString });
}

async function getUltimoProducto(telefono) {
  const estado = await getEstado(telefono);
  return estado.ultimo_producto;
}

async function setUltimoProducto(telefono, producto) {
  await updateEstado(telefono, { ultimo_producto: producto });
}

// ─────────────────────────────────────────────
// CANDIDATOS Y SUBTIPO
// ─────────────────────────────────────────────

async function guardarCandidatosPendientes(telefono, candidatos, mensajeOriginal) {
  await updateEstado(telefono, {
    candidatos_pendientes: { candidatos, mensajeOriginal, timestamp: Date.now() }
  });
}

async function getCandidatosPendientes(telefono) {
  const estado = await getEstado(telefono);
  return estado.candidatos_pendientes;
}

async function clearCandidatosPendientes(telefono) {
  await updateEstado(telefono, { candidatos_pendientes: null });
}

async function setSubtipoPendiente(telefono, categoriaPadre) {
  await updateEstado(telefono, {
    subtipo_pendiente: { categoriaPadre, timestamp: Date.now() }
  });
}

async function getSubtipoPendiente(telefono) {
  const estado = await getEstado(telefono);
  if (!estado.subtipo_pendiente) return null;
  const MAX_AGE_MS = 15 * 60 * 1000; // 15 min (era 10)
  if (Date.now() - estado.subtipo_pendiente.timestamp > MAX_AGE_MS) {
    await clearSubtipoPendiente(telefono);
    return null;
  }
  return estado.subtipo_pendiente;
}

async function clearSubtipoPendiente(telefono) {
  await updateEstado(telefono, { subtipo_pendiente: null });
}

// ─────────────────────────────────────────────
// COMPARACIÓN
// ─────────────────────────────────────────────

async function setComparacionPendiente(telefono, datos) {
  await updateEstado(telefono, {
    comparacion_pendiente: { ...datos, timestamp: Date.now() }
  });
}

async function getComparacionPendiente(telefono) {
  const estado = await getEstado(telefono);
  if (!estado.comparacion_pendiente) return null;
  const MAX_AGE_MS = 15 * 60 * 1000;
  if (Date.now() - estado.comparacion_pendiente.timestamp > MAX_AGE_MS) {
    await clearComparacionPendiente(telefono);
    return null;
  }
  return estado.comparacion_pendiente;
}

async function clearComparacionPendiente(telefono) {
  await updateEstado(telefono, { comparacion_pendiente: null });
}

async function setComparacionProductos(telefono, productos) {
  await updateEstado(telefono, {
    comparacion_productos: { items: productos, timestamp: Date.now() }
  });
}

async function getComparacionProductos(telefono) {
  const estado = await getEstado(telefono);
  const comp = estado.comparacion_productos;
  if (!comp) return null;
  // Compatible con formato anterior (array directo) y nuevo (objeto con timestamp)
  if (Array.isArray(comp)) return comp;
  const MAX_AGE_MS = 15 * 60 * 1000;
  if (Date.now() - (comp.timestamp || 0) > MAX_AGE_MS) {
    await clearComparacionProductos(telefono);
    return null;
  }
  return comp.items || null;
}

async function clearComparacionProductos(telefono) {
  await updateEstado(telefono, { comparacion_productos: null });
}

// ─────────────────────────────────────────────
// PEDIDOS
// ─────────────────────────────────────────────

async function guardarPedido(telefono, producto, precio, cantidad = 1) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;

  await pool.query(
    'INSERT INTO pedidos (usuario_id, producto, precio, cantidad) VALUES (?, ?, ?, ?)',
    [usuarios[0].id, producto, precio, cantidad]
  );

  return true;
}

async function getPedidos(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return [];

  const [pedidos] = await pool.query(
    'SELECT producto, precio, cantidad, estado, created_at FROM pedidos WHERE usuario_id = ? ORDER BY created_at DESC',
    [usuarios[0].id]
  );

  return pedidos;
}

async function tienePedido(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;

  const [estados] = await pool.query(
    'SELECT tiene_pedido FROM estado_usuario WHERE usuario_id = ?',
    [usuarios[0].id]
  );

  if (estados.length === 0) return false;
  return !!estados[0].tiene_pedido;
}

async function marcarPedidoConfirmado(telefono) {
  await updateEstado(telefono, { tiene_pedido: true });
}

// ─────────────────────────────────────────────
// AGENDACIÓN
// ─────────────────────────────────────────────

async function iniciarAgendacion(telefono) {
  await updateEstado(telefono, {
    agendando_cita: true,
    paso_agenda: 1,
    datos_agenda: { nombre: '', ubicacion: null, dia: '', hora: '', razon: '', esSabado: false }
  });
}

async function cancelarAgendacion(telefono) {
  await updateEstado(telefono, {
    agendando_cita: false,
    paso_agenda: 0,
    datos_agenda: null
  });
}

async function getEstaAgendando(telefono) {
  const estado = await getEstado(telefono);
  return !!estado.agendando_cita;
}

async function getPasoAgendacion(telefono) {
  const estado = await getEstado(telefono);
  return estado.paso_agenda || 0;
}

async function setPasoAgendacion(telefono, paso) {
  await updateEstado(telefono, { paso_agenda: paso });
}

async function getDatosAgendacion(telefono) {
  const estado = await getEstado(telefono);
  return estado.datos_agenda || { nombre: '', ubicacion: null, dia: '', hora: '', razon: '', esSabado: false };
}

async function guardarDatosAgendacion(telefono, datos) {
  await updateEstado(telefono, { datos_agenda: datos });
}

async function guardarCita(telefono, datos) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;

  await pool.query(
    `INSERT INTO citas (usuario_id, telefono, nombre, dia, hora, razon, ubicacion) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [usuarios[0].id, telefonoLimpio, datos.nombre, datos.dia, datos.hora, datos.razon, datos.ubicacion]
  );

  await cancelarAgendacion(telefono);
  return true;
}

// ─────────────────────────────────────────────
// INACTIVIDAD Y LIMPIEZA
// ─────────────────────────────────────────────

async function limpiarConversaciones(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return false;

  await pool.query(
    'DELETE FROM conversaciones WHERE usuario_id = ?',
    [usuarios[0].id]
  );

  return true;
}

async function resetearEstadoSinPedido(telefono) {
  await updateEstado(telefono, {
    categoria_actual: null,
    producto_pendiente: null,
    carrito: [],
    greeting_sent: false,
    tiene_pedido: false,
    agendando_cita: false,
    paso_agenda: 0,
    datos_agenda: null,
    candidatos_pendientes: null,
    subtipo_pendiente: null,
    comparacion_pendiente: null,
    comparacion_productos: null,
    transferencia_medida_pendiente: null
  });
}

async function verificarYLimpiarInactividad(telefono, timeoutMinutos = TIMEOUT_INACTIVIDAD_MINUTOS) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id, last_interaction FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return;

  const usuario = usuarios[0];
  const ultimaInteraccion = new Date(usuario.last_interaction);
  const ahora = new Date();
  const diffMinutos = (ahora - ultimaInteraccion) / (1000 * 60);

  if (diffMinutos >= timeoutMinutos) {
    const tienePedidoConfirmado = await tienePedido(telefono);

    if (!tienePedidoConfirmado) {
      await limpiarConversaciones(telefono);
      await resetearEstadoSinPedido(telefono);
      console.log(`[DB] 🧹 Inactividad ${diffMinutos.toFixed(0)} min → limpiando ${telefonoLimpio}`);
    } else {
      console.log(`[DB] ⏭️ ${telefonoLimpio} inactivo ${diffMinutos.toFixed(0)} min pero tiene pedido confirmado`);
    }
  }
}

async function actualizarLastInteraction(telefono) {
  const telefonoLimpio = telefono.replace('whatsapp:', '');

  const [usuarios] = await pool.query(
    'SELECT id FROM usuarios WHERE telefono = ?',
    [telefonoLimpio]
  );

  if (usuarios.length === 0) return;

  await pool.query(
    'UPDATE usuarios SET last_interaction = NOW() WHERE id = ?',
    [usuarios[0].id]
  );
}

async function limpiarConversacionesInactivas(timeoutMinutos = TIMEOUT_INACTIVIDAD_MINUTOS) {
  try {
    const [usuarios] = await pool.query(
      `SELECT telefono FROM usuarios 
       WHERE last_interaction < NOW() - INTERVAL ? MINUTE`,
      [timeoutMinutos]
    );

    for (const usuario of usuarios) {
      await verificarYLimpiarInactividad(usuario.telefono, timeoutMinutos);
    }

    if (usuarios.length > 0) {
      console.log(`[DB] 🧹 Limpieza programada: ${usuarios.length} usuarios inactivos`);
    }
  } catch (error) {
    console.error('[DB] Error en limpieza programada:', error.message);
  }
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  pool,
  getOrCreateUsuario,
  getHistorial,
  addMensaje,
  getEstado,
  updateEstado,
  agregarAlCarrito,
  verCarrito,
  limpiarCarrito,
  guardarProductoPendiente,
  getProductoPendiente,
  clearProductoPendiente,
  estaTransferida,
  marcarTransferida,
  haEnviadoSaludo,
  marcarSaludoEnviado,
  getCategoriaActual,
  setCategoriaActual,
  getUltimoProducto,
  setUltimoProducto,
  guardarPedido,
  getPedidos,
  limpiarConversaciones,
  tienePedido,
  marcarPedidoConfirmado,
  resetearEstadoSinPedido,
  verificarYLimpiarInactividad,
  actualizarLastInteraction,
  iniciarAgendacion,
  cancelarAgendacion,
  getEstaAgendando,
  getPasoAgendacion,
  setPasoAgendacion,
  getDatosAgendacion,
  guardarDatosAgendacion,
  guardarCita,
  limpiarConversacionesInactivas,
  setTransferenciaMedidaPendiente,
  getTransferenciaMedidaPendiente,
  clearTransferenciaMedidaPendiente,
  guardarCandidatosPendientes,
  getCandidatosPendientes,
  clearCandidatosPendientes,
  setSubtipoPendiente,
  getSubtipoPendiente,
  clearSubtipoPendiente,
  setComparacionPendiente,
  getComparacionPendiente,
  clearComparacionPendiente,
  setComparacionProductos,
  getComparacionProductos,
  clearComparacionProductos,
  getInventarioFromDB
};

// ─────────────────────────────────────────────
// INVENTARIO DESDE BD
// ─────────────────────────────────────────────

const SUBCATEGORIA_KEY_MAP = {
  comedores:    'bases_comedores',
  mesas_aux:    'mesas_auxiliares',
  sillas_aux:   'sillas_auxiliares',
  cajoneros:    'cajoneros_bifes',
  sofa_camas:   'sofas_camas'
};

const NOMBRES_CATEGORIA = {
  camas:            'Camas',
  bases_comedores:  'Comedores',
  sillas_comedor:   'Sillas de Comedor',
  mesas_centro:     'Mesas de Centro',
  mesas_noche:      'Mesas de Noche',
  mesas_auxiliares: 'Mesas Auxiliares',
  mesas_tv:         'Mesas de TV',
  sillas_auxiliares:'Sillas Auxiliares',
  sillas_barra:     'Sillas de Barra',
  sofas:            'Sofás',
  sofas_modulares:  'Sofás Modulares',
  sofas_camas:      'Sofás Cama',
  cajoneros_bifes:  'Cajoneros',
  escritorios:      'Escritorios',
  colchones:        'Colchones'
};

function formatearPrecioFromDB(n) {
  return '$' + parseInt(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

async function getInventarioFromDB() {
  // Compatible con la tabla del sistema de ventas (Laravel):
  //   categoria → subcategoria, precio_base → precio, foto_url → imagen
  // Si la tabla usa el esquema anterior del agente (precio, imagen, subcategoria)
  // también funciona gracias a los alias y el fallback de columnas.
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT nombre,
              COALESCE(precio_base, precio)   AS precio,
              COALESCE(foto_url, imagen)       AS imagen,
              medidas, material,
              COALESCE(categoria, subcategoria) AS subcategoria
       FROM productos
       WHERE activo IS NULL OR activo = 1
       ORDER BY subcategoria, nombre`
    );
  } catch {
    // Fallback al esquema anterior (columnas del agente)
    [rows] = await pool.query(
      'SELECT nombre, precio, imagen, medidas, material, subcategoria FROM productos ORDER BY subcategoria, nombre'
    );
  }

  const inventario = {};
  for (const row of rows) {
    const key = SUBCATEGORIA_KEY_MAP[row.subcategoria] || row.subcategoria;
    if (!inventario[key]) {
      inventario[key] = { nombre: NOMBRES_CATEGORIA[key] || key, productos: [] };
    }
    inventario[key].productos.push({
      nombre:   row.nombre,
      medidas:  row.medidas || '',
      material: row.material || '',
      precio:   formatearPrecioFromDB(row.precio),
      imagen:   row.imagen || ''
    });
  }
  return inventario;
}
