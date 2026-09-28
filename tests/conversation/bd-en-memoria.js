// Base de datos en memoria para las pruebas conversacionales.
//
// Los demás tests mockean `db` con jest.fn() que devuelven undefined: sirve para
// comprobar que se llamó a algo, pero no para conversar. Una conversación de verdad
// necesita que el estado sobreviva entre turnos — que el carrito siga ahí en el mensaje
// siguiente, que el historial crezca, que la cita quede agendada y se pueda cancelar.
// Esto implementa ese comportamiento, con la misma superficie que db.js.

function crear() {
  const estado = {
    historial: new Map(),   // telefono -> [{ role, content }]
    carritos: new Map(),    // telefono -> [{ producto, precio, cantidad }]
    ultimoProducto: new Map(),
    ultimosMostrados: new Map(),
    transferidos: new Set(),
    tomadas: new Set(),     // el asesor pulsó "Tomar" en el panel
    citas: [],
    pedidos: [],
    eventos: [],
    notificaciones: [],
    sids: new Set(),
    reactivacion: new Map(),  // telefono -> { atendido }
    minutosAusente: new Map(),
    inventario: null,
    siguienteIdCita: 1,
  };

  const tel = t => String(t).replace('whatsapp:', '');
  const hist = t => {
    const k = tel(t);
    if (!estado.historial.has(k)) estado.historial.set(k, []);
    return estado.historial.get(k);
  };
  const carrito = t => {
    const k = tel(t);
    if (!estado.carritos.has(k)) estado.carritos.set(k, []);
    return estado.carritos.get(k);
  };

  const db = {
    _estado: estado,

    // Constantes que index.js lee de db
    VENTANA_CONVERSACION_MINUTOS: 45,
    TIMEOUT_CARRITO_HORAS: 72,

    pool: { query: async () => [[]] },

    // ── Usuario / historial ──────────────────────────────────────────────────
    getOrCreateUsuario: async () => ({ id: 1 }),
    actualizarLastInteraction: async t => { estado.minutosAusente.set(tel(t), 0); },
    minutosDesdeUltimaInteraccion: async t => estado.minutosAusente.get(tel(t)) ?? 0,
    verificarYLimpiarInactividad: async () => {},
    getNombreCliente: async () => 'Cliente de prueba',

    getHistorial: async (t, limite = 12) => hist(t).slice(-limite),
    addMensaje: async (t, role, content) => { hist(t).push({ role, content }); },
    limpiarConversaciones: async t => { estado.historial.set(tel(t), []); },
    limpiarHistorialAntiguo: async () => {},

    // ── Estado / carrito ─────────────────────────────────────────────────────
    getEstado: async t => ({
      carrito: carrito(t),
      ultimo_producto: estado.ultimoProducto.get(tel(t)) ?? null,
      transferido: estado.transferidos.has(tel(t)),
      tiene_pedido: estado.pedidos.some(p => p.telefono === tel(t)),
    }),
    updateEstado: async (t, datos) => {
      if (Array.isArray(datos.carrito)) estado.carritos.set(tel(t), datos.carrito);
      if (datos.transferido === false) estado.transferidos.delete(tel(t));
      if (datos.transferido === true) estado.transferidos.add(tel(t));
    },
    verCarrito: async t => carrito(t),
    agregarAlCarrito: async (t, producto, precio, cantidad = 1) => {
      carrito(t).push({ producto, precio, cantidad });
    },
    limpiarCarrito: async t => { estado.carritos.set(tel(t), []); },
    limpiarFlujosEnCurso: async () => {},
    resetearEstadoSinPedido: async t => { estado.carritos.set(tel(t), []); },

    getUltimoProducto: async t => estado.ultimoProducto.get(tel(t)) ?? null,
    setUltimoProducto: async (t, p) => { estado.ultimoProducto.set(tel(t), p); },
    setUltimosMostrados: async (t, productos) => { estado.ultimosMostrados.set(tel(t), productos); },
    getUltimosMostrados: async t => estado.ultimosMostrados.get(tel(t)) ?? null,

    // ── Transferencia ────────────────────────────────────────────────────────
    estaTransferida: async t => estado.transferidos.has(tel(t)),
    marcarTransferida: async t => { estado.transferidos.add(tel(t)); },
    tomadaPorAsesor: async t => estado.tomadas.has(tel(t)),
    asesorAtendiendo: async t => estado.transferidos.has(tel(t)) && estado.tomadas.has(tel(t)),
    solicitudAsesorPendiente: async () => false,
    consumirReactivacionAsesor: async t => {
      const r = estado.reactivacion.get(tel(t)) ?? null;
      estado.reactivacion.delete(tel(t));
      return r;
    },

    // ── Pedidos y citas ──────────────────────────────────────────────────────
    guardarPedido: async (t, producto, precio, cantidad) => {
      estado.pedidos.push({ telefono: tel(t), producto, precio, cantidad });
      return true;
    },
    marcarPedidoConfirmado: async () => {},
    tienePedido: async t => estado.pedidos.some(p => p.telefono === tel(t)),

    guardarCita: async (t, datos) => {
      estado.citas.push({ id: estado.siguienteIdCita++, telefono: tel(t), estado: 'pendiente', ...datos });
      return true;
    },
    existeCitaPendiente: async (t, fechaIso) =>
      estado.citas.some(c => c.telefono === tel(t) && c.fecha === fechaIso && c.estado !== 'cancelada'),
    getCitasVigentes: async t =>
      estado.citas.filter(c => c.telefono === tel(t) && c.estado !== 'cancelada'),
    cancelarCita: async (t, id) => {
      const cita = estado.citas.find(c => c.id === Number(id) && c.telefono === tel(t) && c.estado !== 'cancelada');
      if (!cita) return false;
      cita.estado = 'cancelada';
      return true;
    },

    // ── Métricas / infraestructura ───────────────────────────────────────────
    registrarEvento: async (t, tipo, detalle) => { estado.eventos.push({ telefono: tel(t), tipo, detalle }); },
    encolarNotificacion: async (t, tipo, payload) => { estado.notificaciones.push({ telefono: tel(t), tipo, payload }); },
    getNotificacionesPendientes: async () => [],
    eliminarNotificacion: async () => {},
    reprogramarNotificacion: async () => {},
    registrarSid: async sid => {
      if (!sid) return true;
      if (estado.sids.has(sid)) return false;
      estado.sids.add(sid);
      return true;
    },
    limpiarSidsAntiguos: async () => {},

    getInventarioFromDB: async () => estado.inventario,
    getHashesProductos: async () => [],
    upsertHashProducto: async () => {},
    consultarStock: async () => [],
  };

  // Cualquier función de db.js que un flujo use y no esté aquí devuelve undefined en vez
  // de romper el test con "no es una función": así este archivo no hay que mantenerlo al
  // día con cada helper nuevo de db.js.
  return new Proxy(db, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (!(prop in target)) target[prop] = async () => undefined;
      return target[prop];
    },
  });
}

module.exports = { crear };
