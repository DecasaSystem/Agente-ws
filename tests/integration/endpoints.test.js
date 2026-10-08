// Endpoints HTTP del agente: métricas y administración.
//
// Los endpoints de administración exponen teléfonos, pedidos y citas de clientes reales, y
// permiten modificar citas. Hasta la auditoría estaban abiertos a cualquiera que conociera
// la URL. Estas pruebas fijan que sigan cerrados: es el tipo de cosa que se rompe sin que
// nadie lo note hasta que es un problema.

const request = require('supertest');

const mockGetMetricas = jest.fn();

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
jest.mock('../../httpClient', () => ({ fetchWithRetry: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../db', () => ({
  getMetricas: (...a) => mockGetMetricas(...a),
  pool: { query: jest.fn(async () => [[{ c: 0, total: 0 }]]) },
}));

const { app } = require('../../index');

const TOKEN = 'token-de-prueba-largo-y-aleatorio';

const METRICAS = {
  canal: 'whatsapp',
  dias: 30,
  clientes_unicos: 42,
  totales: { conversacion: 100, pedido: 7, transferencia: 12, cita: 5 },
  tasa_conversion: 7,
  tasa_transferencia: 12,
  top_productos: [{ nombre: 'CAMA BALI', veces: 18 }],
  top_busquedas: [{ termino: 'cama doble', veces: 25 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DECASA_AGENT_TOKEN = TOKEN;
  mockGetMetricas.mockResolvedValue(METRICAS);
});

describe('GET /stats', () => {
  test('sin token responde 401 y no consulta nada', async () => {
    await request(app).get('/stats').expect(401);
    expect(mockGetMetricas).not.toHaveBeenCalled();
  });

  test('con token equivocado responde 401', async () => {
    await request(app).get('/stats').set('X-Agent-Token', 'otro').expect(401);
    expect(mockGetMetricas).not.toHaveBeenCalled();
  });

  test('con el token correcto devuelve el embudo', async () => {
    const res = await request(app).get('/stats').set('X-Agent-Token', TOKEN).expect(200);
    expect(res.body.canal).toBe('whatsapp');
    expect(res.body.totales.pedido).toBe(7);
    expect(res.body.tasa_conversion).toBe(7);
    expect(res.body.top_productos[0].nombre).toBe('CAMA BALI');
  });

  test('acepta el token por query, como el agente de Instagram', async () => {
    await request(app).get(`/stats?token=${TOKEN}`).expect(200);
  });

  test('el rango de días se limita a algo razonable', async () => {
    await request(app).get('/stats?dias=9999').set('X-Agent-Token', TOKEN).expect(200);
    expect(mockGetMetricas).toHaveBeenCalledWith(365);

    await request(app).get('/stats?dias=-5').set('X-Agent-Token', TOKEN).expect(200);
    expect(mockGetMetricas).toHaveBeenLastCalledWith(1);

    await request(app).get('/stats?dias=abc').set('X-Agent-Token', TOKEN).expect(200);
    expect(mockGetMetricas).toHaveBeenLastCalledWith(30);
  });

  test('sin token configurado en el servidor, se rechaza igual', async () => {
    delete process.env.DECASA_AGENT_TOKEN;
    await request(app).get('/stats').expect(401);
    await request(app).get('/stats').set('X-Agent-Token', 'lo-que-sea').expect(401);
  });
});

describe('Endpoints de administración', () => {
  test('/admin/resumen exige token: expone datos de clientes reales', async () => {
    await request(app).get('/admin/resumen').expect(401);
    await request(app).get('/admin/resumen').set('X-Agent-Token', TOKEN).expect(200);
  });

  test('/refresh-inventario exige token', async () => {
    await request(app).post('/refresh-inventario').expect(401);
  });

  test('/citas/:id/estado exige token: permite modificar citas', async () => {
    await request(app).post('/citas/7/estado').send({ estado: 'cancelada' }).expect(401);
  });

  test('/health sigue siendo público (lo consulta el hosting)', async () => {
    // Público = no pide token. El código puede ser 200 o 503 según el estado real.
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.comprobaciones).toBeDefined();
  });

  test('/health responde 503 si una dependencia falla, para que el hosting reinicie', async () => {
    // Aquí el inventario está vacío y el modelo no responde: antes esto devolvía 200 y
    // "status: ok", así que el servicio se quedaba roto sin que nadie lo reiniciara.
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degradado');
    expect(res.body.comprobaciones.inventario.ok).toBe(false);
  });
});
