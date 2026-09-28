// Cancelar y mover citas desde la conversación, y la regla de no dar por dicha una
// respuesta que Twilio no entregó.

const mockTwilioCreate   = jest.fn().mockResolvedValue({ sid: 'SM_test' });
const mockOpenAICreate   = jest.fn();
const mockFetchWithRetry = jest.fn().mockResolvedValue({ ok: true });

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
jest.mock('../../image-hash', () => ({ hashesCandidatos: jest.fn(async () => []), mejorCoincidencia: jest.fn(() => null) }));
jest.mock('../../httpClient', () => ({ fetchWithRetry: (...a) => mockFetchWithRetry(...a) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../db', () => {
  const base = {
    getHistorial: jest.fn(async () => []),
    estaTransferida: jest.fn(async () => false),
    consumirReactivacionAsesor: jest.fn(async () => null),
    minutosDesdeUltimaInteraccion: jest.fn(async () => 0),
    getUltimosMostrados: jest.fn(async () => []),
    getEstado: jest.fn(async () => ({})),
    verCarrito: jest.fn(async () => []),
    getCitasVigentes: jest.fn(async () => []),
    cancelarCita: jest.fn(async () => true),
    VENTANA_CONVERSACION_MINUTOS: 45,
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
const { recibirMensaje, DEBOUNCE_MS } = require('../../index');

const TO = 'whatsapp:+15550001';

const CITA = { id: 7, nombre: 'Ana', dia: 'Jueves 1 de octubre de 2026', fecha: '2026-10-01', hora: '10:00', ubicacion: 1, razon: null, estado: 'pendiente' };
const CITA_2 = { id: 9, nombre: 'Ana', dia: 'Sábado 3 de octubre de 2026', fecha: '2026-10-03', hora: '09:00', ubicacion: 4, razon: null, estado: 'pendiente' };

function respuestaSimple(texto) {
  return { usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'stop', message: { content: texto } }] };
}

function respuestaConTool(nombre, args = {}) {
  return {
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: nombre, arguments: JSON.stringify(args) } }] },
    }],
  };
}

function resultadoDeHerramienta() {
  const llamada = mockOpenAICreate.mock.calls.find(c => c[0].messages.some(m => m.role === 'tool'));
  return JSON.parse(llamada[0].messages.find(m => m.role === 'tool').content);
}

async function correrTurno() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-15T15:00:00Z')); // martes 10 am Bogotá
  process.env.DECASA_API_URL = 'https://api.decasa.test';
  mockOpenAICreate.mockResolvedValue(respuestaSimple('Listo 😊'));
  mockTwilioCreate.mockResolvedValue({ sid: 'SM_test' });
  mockFetchWithRetry.mockResolvedValue({ ok: true });
  db.estaTransferida.mockResolvedValue(false);
  db.asesorAtendiendo.mockResolvedValue(false);
  db.getHistorial.mockResolvedValue([]);
  db.verCarrito.mockResolvedValue([]);
  db.consumirReactivacionAsesor.mockResolvedValue(null);
  db.minutosDesdeUltimaInteraccion.mockResolvedValue(0);
  db.getCitasVigentes.mockResolvedValue([]);
  db.cancelarCita.mockResolvedValue(true);
});

afterEach(() => jest.useRealTimers());

describe('cancelar_cita', () => {
  test('con una sola cita, la cancela y avisa al panel de ventas', async () => {
    db.getCitasVigentes.mockResolvedValue([CITA]);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('cancelar_cita', { motivo: 'Me salió un viaje' }))
      .mockResolvedValue(respuestaSimple('Ya la cancelé 😊'));

    const from = 'whatsapp:+573001110001';
    recibirMensaje({ from, toNumber: TO, texto: 'ya no voy a poder ir el jueves' });
    await correrTurno();

    expect(db.cancelarCita).toHaveBeenCalledWith(from, 7);
    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(true);

    // El asesor tiene que enterarse: si no, prepara el producto y espera a nadie
    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.tipo).toBe('cita');
    expect(cuerpo.resumen).toContain('CITA CANCELADA');
    expect(cuerpo.datos_cita.cancelada).toBe(true);
  });

  test('con dos citas y sin id, pregunta cuál en vez de cancelar a ciegas', async () => {
    db.getCitasVigentes.mockResolvedValue([CITA, CITA_2]);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('cancelar_cita', {}))
      .mockResolvedValue(respuestaSimple('¿Cuál de las dos? 😊'));

    recibirMensaje({ from: 'whatsapp:+573001110002', toNumber: TO, texto: 'quiero cancelar mi cita' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(false);
    expect(res.requiere_eleccion).toBe(true);
    expect(res.citas).toHaveLength(2);
    expect(db.cancelarCita).not.toHaveBeenCalled();
  });

  test('con el id indicado cancela esa', async () => {
    db.getCitasVigentes.mockResolvedValue([CITA, CITA_2]);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('cancelar_cita', { cita_id: 9 }))
      .mockResolvedValue(respuestaSimple('Cancelada 😊'));

    const from = 'whatsapp:+573001110003';
    recibirMensaje({ from, toNumber: TO, texto: 'la del sábado' });
    await correrTurno();

    expect(db.cancelarCita).toHaveBeenCalledWith(from, 9);
  });

  test('sin citas vigentes no inventa una cancelación', async () => {
    db.getCitasVigentes.mockResolvedValue([]);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('cancelar_cita', {}))
      .mockResolvedValue(respuestaSimple('No te encuentro una visita 😊'));

    recibirMensaje({ from: 'whatsapp:+573001110004', toNumber: TO, texto: 'cancela mi cita' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(false);
    expect(res.error).toContain('no tiene ninguna cita vigente');
    expect(db.cancelarCita).not.toHaveBeenCalled();
  });

  test('si la BD no cancela, no se le confirma al cliente', async () => {
    db.getCitasVigentes.mockResolvedValue([CITA]);
    db.cancelarCita.mockResolvedValue(false);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('cancelar_cita', {}))
      .mockResolvedValue(respuestaSimple('Un asesor te confirma 😊'));

    recibirMensaje({ from: 'whatsapp:+573001110005', toNumber: TO, texto: 'cancélala' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(false);
    expect(mockFetchWithRetry).not.toHaveBeenCalled(); // no se avisa de una cancelación que no ocurrió
  });
});

describe('Entrega de la respuesta', () => {
  test('si Twilio falla, la respuesta NO queda en el historial como dicha', async () => {
    mockTwilioCreate.mockRejectedValue(Object.assign(new Error('Twilio 500'), { status: 500 }));

    const from = 'whatsapp:+573002220001';
    recibirMensaje({ from, toNumber: TO, texto: 'cuánto vale la cama bali' });
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    await jest.advanceTimersByTimeAsync(10000); // reintentos de envío
    await jest.advanceTimersByTimeAsync(0);

    expect(db.addMensaje).toHaveBeenCalledWith(from, 'user', 'cuánto vale la cama bali');
    expect(db.addMensaje).not.toHaveBeenCalledWith(from, 'assistant', expect.anything());
  });

  test('si Twilio entrega, sí queda en el historial', async () => {
    const from = 'whatsapp:+573002220002';
    recibirMensaje({ from, toNumber: TO, texto: 'cuánto vale la cama bali' });
    await correrTurno();

    expect(db.addMensaje).toHaveBeenCalledWith(from, 'assistant', 'Listo 😊');
  });

  test('un saludo que no se pudo entregar no se marca como enviado', async () => {
    mockTwilioCreate.mockRejectedValue(Object.assign(new Error('Twilio 500'), { status: 500 }));
    db.getHistorial.mockResolvedValue([]);

    const from = 'whatsapp:+573002220003';
    recibirMensaje({ from, toNumber: TO, texto: 'hola' });
    await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
    await jest.advanceTimersByTimeAsync(10000);
    await jest.advanceTimersByTimeAsync(0);

    expect(db.addMensaje).not.toHaveBeenCalledWith(from, 'assistant', expect.stringContaining('Soy Elena'));
  });
});
