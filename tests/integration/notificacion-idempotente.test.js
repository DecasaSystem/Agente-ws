// La notificación al sistema de ventas lleva una clave de idempotencia que sobrevive a la
// cola de reintentos.
//
// Antes el sistema de ventas solo frenaba el repetido del mismo minuto: si la API tardaba
// en contestar y el agente encolaba el aviso, el reintento de horas después creaba una
// segunda tarjeta (y un segundo aviso al celular de cada vendedor). Ahora el primer envío
// y todos sus reintentos mandan la MISMA clave, y dos avisos distintos, claves distintas.

const mockFetch = jest.fn();
const mockEncolar = jest.fn();
const mockPendientes = jest.fn();

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
  getNombreCliente: jest.fn(async () => 'Ana'),
  encolarNotificacion: (...a) => mockEncolar(...a),
  getNotificacionesPendientes: (...a) => mockPendientes(...a),
  eliminarNotificacion: jest.fn(async () => {}),
  reprogramarNotificacion: jest.fn(async () => {}),
}));

process.env.DECASA_API_URL = 'https://api.prueba';
const { notificarRedes, procesarColaNotificaciones } = require('../../index');

const claveDe = (llamada) => JSON.parse(llamada[1].body).idempotencia;
const esperar = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  mockFetch.mockReset();
  mockEncolar.mockReset();
  mockPendientes.mockReset();
});

test('el reintento desde la cola manda la misma clave que el primer envío', async () => {
  mockFetch.mockRejectedValueOnce(new Error('timeout'));
  notificarRedes('whatsapp:+573001112233', 'Quiere un asesor', [], 'asesor', {});
  await esperar(); await esperar();

  expect(mockEncolar).toHaveBeenCalledTimes(1);
  const [telefono, tipo, payload] = mockEncolar.mock.calls[0];
  const claveOriginal = claveDe(mockFetch.mock.calls[0]);
  expect(claveOriginal).toMatch(/^[0-9a-f-]{36}$/);
  expect(payload.extra.idempotencia).toBe(claveOriginal);

  // El worker la saca de la cola (horas después) y la vuelve a enviar.
  mockFetch.mockResolvedValueOnce({ ok: true });
  mockPendientes.mockResolvedValueOnce([{ id: 1, telefono, tipo, intentos: 1, payload }]);
  await procesarColaNotificaciones();

  expect(claveDe(mockFetch.mock.calls[1])).toBe(claveOriginal);
});

test('dos avisos distintos llevan claves distintas', async () => {
  mockFetch.mockResolvedValue({ ok: true });
  notificarRedes('whatsapp:+573001112233', 'Quiere un asesor', [], 'asesor', {});
  notificarRedes('whatsapp:+573001112233', 'Quiere un asesor', [], 'asesor', {});
  await esperar(); await esperar();

  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(claveDe(mockFetch.mock.calls[0])).not.toBe(claveDe(mockFetch.mock.calls[1]));
});
