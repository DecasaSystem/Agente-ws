// Pruebas del buffer de ráfagas, la cola por cliente y el troceo de mensajes largos
// (la entrega pasó de TwiML síncrono a envío por API REST).

const mockTwilioCreate = jest.fn().mockResolvedValue({ sid: 'SM_test' });
const mockOpenAICreate = jest.fn();

jest.mock('twilio', () => {
  const fn = jest.fn(() => ({ messages: { create: mockTwilioCreate } }));
  fn.validateRequest = jest.fn(() => true);
  fn.twiml = { MessagingResponse: jest.fn() };
  return fn;
});

jest.mock('openai', () => {
  const OpenAIMock = jest.fn(() => ({
    chat: { completions: { create: mockOpenAICreate } },
    audio: { transcriptions: { create: jest.fn() } },
  }));
  OpenAIMock.toFile = jest.fn();
  return OpenAIMock;
});

jest.mock('../../init-db', () => ({ initDB: jest.fn() }));
jest.mock('../../image-processor', () => ({ processRoomImage: jest.fn(), downloadFromTwilio: jest.fn() }));
jest.mock('../../image-hash', () => ({ hashDesdeBuffer: jest.fn(), buscarSimilar: jest.fn() }));
jest.mock('../../httpClient', () => ({ fetchWithRetry: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Cualquier método de db no listado devuelve una promesa vacía: al agente le basta.
jest.mock('../../db', () => {
  const base = {
    getHistorial: jest.fn(async () => []),
    estaTransferida: jest.fn(async () => false),
    consumirReactivacionAsesor: jest.fn(async () => false),
    getUltimosMostrados: jest.fn(async () => []),
    getEstado: jest.fn(async () => ({})),
    pool: { query: jest.fn(async () => [[]]) },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (!(prop in target)) target[prop] = jest.fn(async () => undefined);
      return target[prop];
    },
  });
});

const { recibirMensaje, trocearTexto, encolar, DEBOUNCE_MS } = require('../../index');

// Respuesta del modelo sin tool calls: termina el loop en la primera ronda.
function respuestaSimple(texto) {
  return {
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{ finish_reason: 'stop', message: { content: texto } }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenAICreate.mockResolvedValue(respuestaSimple('Claro que sí 😊'));
});

describe('Buffer de ráfagas', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('agrupa varias burbujas seguidas en un solo turno', async () => {
    const from = 'whatsapp:+573001112233';
    recibirMensaje({ from, toNumber: 'whatsapp:+15550001', texto: 'hola' });
    recibirMensaje({ from, toNumber: 'whatsapp:+15550001', texto: 'quiero una cama' });
    recibirMensaje({ from, toNumber: 'whatsapp:+15550001', texto: 'de 2 metros' });

    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);

    // Un solo turno al modelo, no tres
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);

    const mensajes = mockOpenAICreate.mock.calls[0][0].messages;
    const ultimoUsuario = mensajes[mensajes.length - 1];
    expect(ultimoUsuario.role).toBe('user');
    expect(ultimoUsuario.content).toBe('hola\nquiero una cama\nde 2 metros');

    // Y una sola respuesta al cliente
    const textos = mockTwilioCreate.mock.calls.filter(c => c[0].body === 'Claro que sí 😊');
    expect(textos).toHaveLength(1);
  });

  test('no descarta el segundo mensaje cuando llega inmediatamente después', async () => {
    const from = 'whatsapp:+573004445566';
    recibirMensaje({ from, toNumber: 'whatsapp:+15550001', texto: 'mesas' });
    recibirMensaje({ from, toNumber: 'whatsapp:+15550001', texto: 'de centro' });

    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);

    const mensajes = mockOpenAICreate.mock.calls[0][0].messages;
    expect(mensajes[mensajes.length - 1].content).toContain('de centro');
  });

  test('clientes distintos no se mezclan entre sí', async () => {
    recibirMensaje({ from: 'whatsapp:+573001', toNumber: 'whatsapp:+15550001', texto: 'quiero un sofá' });
    recibirMensaje({ from: 'whatsapp:+573002', toNumber: 'whatsapp:+15550001', texto: 'quiero una silla' });

    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);

    expect(mockOpenAICreate).toHaveBeenCalledTimes(2);
    const contenidos = mockOpenAICreate.mock.calls
      .map(c => c[0].messages[c[0].messages.length - 1].content);
    expect(contenidos).toContain('quiero un sofá');
    expect(contenidos).toContain('quiero una silla');
  });
});

describe('Cola serializada por cliente', () => {
  test('las tareas del mismo cliente no se solapan', async () => {
    const orden = [];
    const tarea = (id, ms) => () => new Promise(resolve => {
      orden.push(`inicio-${id}`);
      setTimeout(() => { orden.push(`fin-${id}`); resolve(); }, ms);
    });

    const p1 = encolar('cliente-A', tarea(1, 30));
    const p2 = encolar('cliente-A', tarea(2, 1));
    await Promise.all([p1, p2]);

    expect(orden).toEqual(['inicio-1', 'fin-1', 'inicio-2', 'fin-2']);
  });

  test('una tarea que falla no bloquea la siguiente ni tumba el proceso', async () => {
    const ejecutadas = [];
    // encolar absorbe el fallo: la promesa devuelta nunca rechaza, así que un error en
    // un cliente no puede provocar un unhandledRejection que mate el servidor.
    const p1 = encolar('cliente-B', async () => { ejecutadas.push(1); throw new Error('boom'); });
    const p2 = encolar('cliente-B', async () => { ejecutadas.push(2); });
    await expect(p1).resolves.toBeUndefined();
    await p2;

    expect(ejecutadas).toEqual([1, 2]);
  });
});

describe('Troceo de mensajes largos', () => {
  test('un mensaje corto va entero', () => {
    expect(trocearTexto('Hola, ¿en qué te ayudo?')).toEqual(['Hola, ¿en qué te ayudo?']);
  });

  test('parte por párrafos y respeta el límite de WhatsApp', () => {
    const parrafo = 'A'.repeat(700);
    const partes = trocearTexto([parrafo, parrafo, parrafo].join('\n\n'));
    expect(partes.length).toBeGreaterThan(1);
    for (const parte of partes) expect(parte.length).toBeLessThanOrEqual(1500);
  });

  test('parte un párrafo único gigante sin perder contenido', () => {
    const largo = 'palabra '.repeat(600).trim(); // ~4800 caracteres
    const partes = trocearTexto(largo);
    for (const parte of partes) expect(parte.length).toBeLessThanOrEqual(1500);
    expect(partes.join(' ').replace(/\s+/g, ' ')).toBe(largo.replace(/\s+/g, ' '));
  });
});
