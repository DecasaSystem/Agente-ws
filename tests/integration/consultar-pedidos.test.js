// consultar_pedidos: el estado de las compras reales, solo por el número desde el que
// escribe el cliente (AgentePedidosController en decasa-api).

const mockFetch = jest.fn();

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
jest.mock('../../db', () => ({ pool: { query: jest.fn(async () => [[]]) }, registrarEvento: jest.fn(async () => {}) }));

process.env.DECASA_API_URL = 'https://api.prueba';
process.env.DECASA_AGENT_TOKEN = 'token-del-agente';
const { ejecutarHerramienta } = require('../../index');

beforeEach(() => mockFetch.mockReset());

test('consulta con el número desde el que escribe y el token del agente', async () => {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ pedidos: [{ referencia: '#4200', estado: 'En fabricación', entrega_estimada: '2026-10-30' }] }) });
  const r = await ejecutarHerramienta('consultar_pedidos', {}, 'whatsapp:+573001112233', []);

  const [url, opciones] = mockFetch.mock.calls[0];
  expect(url).toBe('https://api.prueba/api/agentes/pedidos?telefono=%2B573001112233');
  expect(opciones.headers['X-Agent-Token']).toBe('token-del-agente');
  expect(r.exito).toBe(true);
  expect(r.pedidos[0].referencia).toBe('#4200');
});

test('aunque el modelo le pase otro número, se usa el del cliente', async () => {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ pedidos: [] }) });
  await ejecutarHerramienta('consultar_pedidos', { telefono: '3109998877' }, 'whatsapp:+573001112233', []);
  expect(mockFetch.mock.calls[0][0]).toContain('telefono=%2B573001112233');
});

test('sin compras: no ofrece buscar con otro número', async () => {
  mockFetch.mockResolvedValueOnce({ json: async () => ({ pedidos: [] }) });
  const r = await ejecutarHerramienta('consultar_pedidos', {}, 'whatsapp:+573001112233', []);
  expect(r.pedidos).toEqual([]);
  expect(r.instruccion).toMatch(/NO busques con otro número/);
});

test('si la API falla, se ofrece un asesor en vez de inventar', async () => {
  mockFetch.mockRejectedValueOnce(new Error('HTTP 503'));
  const r = await ejecutarHerramienta('consultar_pedidos', {}, 'whatsapp:+573001112233', []);
  expect(r.exito).toBe(false);
  expect(r.error).toMatch(/asesor/);
});
