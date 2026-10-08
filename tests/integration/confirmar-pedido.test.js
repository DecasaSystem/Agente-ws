// confirmar_pedido: el aviso al asesor lleva ciudad y forma de pago (si el cliente las
// dio), y el tope de pedidos diarios corta sin crear tarjeta (revisión del 2026-10-08).

const mockFetch = jest.fn(async () => ({ ok: true }));
const mockPedidosRecientes = jest.fn(async () => 0);

jest.mock('twilio', () => {
  const fn = jest.fn(() => ({ messages: { create: jest.fn() } }));
  fn.validateRequest = jest.fn(() => true);
  fn.twiml = { MessagingResponse: jest.fn() };
  return fn;
});
jest.mock('openai', () => {
  const OpenAIMock = jest.fn(() => ({ chat: { completions: { create: jest.fn() } }, audio: { transcriptions: { create: jest.fn() } } }));
  OpenAIMock.toFile = jest.fn();
  return OpenAIMock;
});
jest.mock('../../init-db', () => ({ initDB: jest.fn() }));
jest.mock('../../image-processor', () => ({ processRoomImage: jest.fn(), downloadFromTwilio: jest.fn() }));
jest.mock('../../image-hash', () => ({ hashesCandidatos: jest.fn(), mejorCoincidencia: jest.fn() }));
jest.mock('../../httpClient', () => ({ fetchWithRetry: (...a) => mockFetch(...a) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../db', () => ({
  pool: { query: jest.fn(async () => [[]]) },
  verCarrito: jest.fn(async () => [{ producto: 'CAMA MIAMI (1.60)', precio: '$2.980.000', cantidad: 1 }]),
  guardarPedido: jest.fn(async () => true),
  marcarPedidoConfirmado: jest.fn(async () => {}),
  limpiarCarrito: jest.fn(async () => {}),
  limpiarFlujosEnCurso: jest.fn(async () => {}),
  contarPedidosRecientes: (...a) => mockPedidosRecientes(...a),
  registrarEvento: jest.fn(async () => {}),
  cancelarSeguimientos: jest.fn(async () => {}),
  getNombreCliente: jest.fn(async () => 'Ana'),
  encolarNotificacion: jest.fn(async () => {}),
}));

process.env.DECASA_API_URL = 'https://api.prueba';
const { ejecutarHerramienta } = require('../../index');
const esperar = () => new Promise(r => setTimeout(r, 20));

beforeEach(() => { mockFetch.mockClear(); mockPedidosRecientes.mockResolvedValue(0); });

test('el aviso al asesor lleva la ciudad y la forma de pago', async () => {
  const r = await ejecutarHerramienta('confirmar_pedido', { ciudad: 'Pereira', forma_pago: 'transferencia' }, 'whatsapp:+573001112233', []);
  await esperar();
  expect(r.exito).toBe(true);
  const aviso = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(aviso.tipo).toBe('pedido');
  expect(aviso.resumen).toMatch(/CAMA MIAMI/);
  expect(aviso.resumen).toMatch(/Entrega en: Pereira · Pago: transferencia/);
});

test('sin esos datos el pedido se confirma igual', async () => {
  const r = await ejecutarHerramienta('confirmar_pedido', {}, 'whatsapp:+573001112233', []);
  await esperar();
  expect(r.exito).toBe(true);
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).resumen).not.toMatch(/Entrega en/);
});

test('pasado el tope de pedidos del día no se crea otra tarjeta', async () => {
  mockPedidosRecientes.mockResolvedValue(3);
  const r = await ejecutarHerramienta('confirmar_pedido', {}, 'whatsapp:+573001112233', []);
  await esperar();
  expect(r.exito).toBe(false);
  expect(r.error).toMatch(/asesor/);
  // Ninguna llamada al sistema de ventas (la alerta va por Telegram, no por esta vía).
  expect(mockFetch.mock.calls.filter(c => String(c[0]).includes('/api/redes/webhook'))).toHaveLength(0);
});
