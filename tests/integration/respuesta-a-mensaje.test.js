// Respuesta a una foto de Elena (caso real del 2026-10-29): Twilio solo trae
// OriginalRepliedMessageSid; lo que era se anota al enviar (wa_mensajes_enviados).

const mockTwilioCreate = jest.fn().mockResolvedValue({ sid: 'SM_foto_sodege' });
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

const db = require('../../db');
const { recibirMensaje, enviarMensajeAdicional, DEBOUNCE_MS } = require('../../index');

const FROM = 'whatsapp:+573001112233';
const TO = 'whatsapp:+15550001';

function respuestaSimple(texto) {
  return {
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{ finish_reason: 'stop', message: { content: texto } }],
  };
}

function ultimoMensajeAlModelo() {
  const mensajes = mockOpenAICreate.mock.calls[0][0].messages;
  return mensajes[mensajes.length - 1].content;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenAICreate.mockResolvedValue(respuestaSimple('¡Qué buena elección! 😊'));
});

test('al mandar la foto de un producto, se anota su SID con el producto', async () => {
  await enviarMensajeAdicional(FROM, TO, '📸 BASE SODEGE 6 PUESTOS', 'https://cdn/sodege.jpg', 'BASE SODEGE 6 PUESTOS');
  await new Promise(r => setImmediate(r));
  expect(db.registrarMensajeEnviado).toHaveBeenCalledWith(expect.objectContaining({
    sid: 'SM_foto_sodege', telefono: FROM, producto: 'BASE SODEGE 6 PUESTOS', imagenUrl: 'https://cdn/sodege.jpg',
  }));
});

describe('el cliente responde a un mensaje nuestro', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('a una foto: el modelo sabe de qué producto habla', async () => {
    db.getMensajeEnviado.mockImplementation(async (sid, tel) =>
      sid === 'SM_foto_sodege' && tel === FROM ? { producto: 'BASE SODEGE 6 PUESTOS' } : null);
    recibirMensaje({ from: FROM, toNumber: TO, texto: 'Nos gustó este comedor y..', respondeA: 'SM_foto_sodege' });
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);

    expect(db.getMensajeEnviado).toHaveBeenCalledWith('SM_foto_sodege', FROM);
    expect(ultimoMensajeAlModelo()).toContain('RESPONDIENDO a la foto de BASE SODEGE 6 PUESTOS');
    expect(ultimoMensajeAlModelo()).toContain('Nos gustó este comedor y..');
    expect(db.addMensaje).toHaveBeenCalledWith(FROM, 'user', '[respondiendo a la foto de BASE SODEGE 6 PUESTOS] Nos gustó este comedor y..');
  });

  test('si no se sabe a qué responde, no adivina', async () => {
    db.getMensajeEnviado.mockResolvedValue(null);
    recibirMensaje({ from: FROM, toNumber: TO, texto: 'este me gusta', respondeA: 'SM_viejo' });
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    expect(ultimoMensajeAlModelo()).toContain('NO adivines');
  });

  test('sin respuesta a nada, el mensaje llega igual que siempre', async () => {
    recibirMensaje({ from: FROM, toNumber: TO, texto: 'quiero un comedor' });
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    expect(db.getMensajeEnviado).not.toHaveBeenCalled();
    expect(ultimoMensajeAlModelo()).toBe('quiero un comedor');
  });
});
