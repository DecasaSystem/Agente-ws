// Continuidad de la conversación: el carrito y el historial ya no se borran a los 45
// minutos ni al confirmar un pedido, el saludo de bienvenida solo sale la primera vez,
// los adjuntos que no podemos leer reciben una respuesta útil, y una caída de OpenAI no
// inunda el panel de ventas con tarjetas falsas.

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

async function correrTurno() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(0);
}

// Deja además correr los backoffs de los reintentos de OpenAI.
async function correrTurnoConReintentos() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(10000);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(0);
}

function mensajesSistema() {
  return mockOpenAICreate.mock.calls[0][0].messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
}

function resultadoDeHerramienta() {
  const llamada = mockOpenAICreate.mock.calls.find(c => c[0].messages.some(m => m.role === 'tool'));
  return JSON.parse(llamada[0].messages.find(m => m.role === 'tool').content);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  // Martes 10:00 am Bogotá: dentro del horario, para que las transferencias no dependan
  // de la hora a la que corra la suite.
  jest.setSystemTime(new Date('2026-09-15T15:00:00Z'));
  process.env.DECASA_API_URL = 'https://api.decasa.test';
  mockOpenAICreate.mockResolvedValue(respuestaSimple('Claro que sí 😊'));
  mockFetchWithRetry.mockResolvedValue({ ok: true });
  db.estaTransferida.mockResolvedValue(false);
  db.asesorAtendiendo.mockResolvedValue(false);
  db.tomadaPorAsesor.mockResolvedValue(false);
  db.getHistorial.mockResolvedValue([]);
  db.verCarrito.mockResolvedValue([]);
  db.consumirReactivacionAsesor.mockResolvedValue(null);
  db.minutosDesdeUltimaInteraccion.mockResolvedValue(0);
});

afterEach(() => jest.useRealTimers());

describe('Retención de contexto', () => {
  test('el carrito se vacía al confirmar el pedido, pero el historial se conserva', async () => {
    db.verCarrito.mockResolvedValue([{ producto: 'CAMA BALI', precio: '$2.880.000', cantidad: 1 }]);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('confirmar_pedido'))
      .mockResolvedValue(respuestaSimple('¡Gracias! 😊'));

    const from = 'whatsapp:+573007770001';
    recibirMensaje({ from, toNumber: TO, texto: 'confirmo la compra' });
    await correrTurno();

    expect(db.guardarPedido).toHaveBeenCalled();
    expect(db.marcarPedidoConfirmado).toHaveBeenCalledWith(from);
    expect(db.limpiarCarrito).toHaveBeenCalledWith(from);
    // Lo que antes rompía la continuidad: borrar el hilo y resetear tiene_pedido
    expect(db.limpiarConversaciones).not.toHaveBeenCalled();
    expect(db.resetearEstadoSinPedido).not.toHaveBeenCalled();
  });

  test('al transferir al asesor tampoco se borra el historial', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Quiere cotizar a medida' }))
      .mockResolvedValue(respuestaSimple('Te conecto 😊'));

    recibirMensaje({ from: 'whatsapp:+573007770002', toNumber: TO, texto: 'quiero un asesor' });
    await correrTurno();

    expect(db.marcarTransferida).toHaveBeenCalled();
    expect(db.limpiarConversaciones).not.toHaveBeenCalled();
  });

  test('si ningún asesor lo atendió, no le pregunta cómo le fue', async () => {
    db.consumirReactivacionAsesor.mockResolvedValue({ atendido: false });

    recibirMensaje({ from: 'whatsapp:+573007770003', toNumber: TO, texto: 'sigo buscando la cama' });
    await correrTurno();

    expect(mensajesSistema()).toContain('NINGÚN asesor llegó a atenderlo');
    expect(mensajesSistema()).not.toContain('cómo quedó con el asesor');
  });

  test('si un asesor sí lo atendió, retoma reconociéndolo', async () => {
    db.consumirReactivacionAsesor.mockResolvedValue({ atendido: true });

    recibirMensaje({ from: 'whatsapp:+573007770005', toNumber: TO, texto: 'sigo buscando la cama' });
    await correrTurno();

    expect(mensajesSistema()).toContain('venía siendo atendido por un asesor humano');
  });

  test('si vuelve tras horas, se le avisa al modelo para que retome', async () => {
    db.minutosDesdeUltimaInteraccion.mockResolvedValue(300);

    recibirMensaje({ from: 'whatsapp:+573007770004', toNumber: TO, texto: 'sigo interesada' });
    await correrTurno();

    expect(mensajesSistema()).toContain('vuelve tras 5 horas');
    expect(mensajesSistema()).toContain('carrito');
  });

  test('dentro de la misma conversación no se le avisa de nada', async () => {
    db.minutosDesdeUltimaInteraccion.mockResolvedValue(3);

    recibirMensaje({ from: 'whatsapp:+573007770006', toNumber: TO, texto: 'y de qué material es?' });
    await correrTurno();

    expect(mensajesSistema()).not.toContain('vuelve tras');
  });
});

describe('Saludo y adjuntos', () => {
  test('"buenas" en mitad de la conversación no repite el saludo de bienvenida', async () => {
    db.getHistorial.mockResolvedValue([
      { role: 'user', content: 'quiero una cama' },
      { role: 'assistant', content: 'Te muestro estas 😊' },
    ]);

    recibirMensaje({ from: 'whatsapp:+573008880001', toNumber: TO, texto: 'buenas' });
    await correrTurno();

    expect(mockOpenAICreate).toHaveBeenCalled();
    const enviados = mockTwilioCreate.mock.calls.map(c => c[0].body).join(' ');
    expect(enviados).not.toContain('Soy Elena, tu asesora de DeCasa');
  });

  test('el primer "hola" sí recibe el saludo de bienvenida', async () => {
    db.getHistorial.mockResolvedValue([]);

    recibirMensaje({ from: 'whatsapp:+573008880002', toNumber: TO, texto: 'hola' });
    await correrTurno();

    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(mockTwilioCreate.mock.calls[0][0].body).toContain('Soy Elena, tu asesora de DeCasa');
  });

  test('un video recibe una respuesta útil en vez de un turno vacío', async () => {
    recibirMensaje({ from: 'whatsapp:+573008880003', toNumber: TO, texto: '', mediaUrl: 'https://x/v.mp4', mediaType: 'video/mp4' });
    await correrTurno();

    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(mockTwilioCreate.mock.calls[0][0].body).toContain('solo alcanzo a ver fotos');
  });

  test('un video CON texto sí se atiende con el modelo', async () => {
    recibirMensaje({ from: 'whatsapp:+573008880004', toNumber: TO, texto: 'cuánto vale la cama bali', mediaUrl: 'https://x/v.mp4', mediaType: 'video/mp4' });
    await correrTurno();

    expect(mockOpenAICreate).toHaveBeenCalled();
  });
});

describe('Caída de OpenAI', () => {
  test('reintenta y, si sigue cayendo, pide paciencia sin crear tarjeta', async () => {
    mockOpenAICreate.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));

    recibirMensaje({ from: 'whatsapp:+573009990010', toNumber: TO, texto: 'hola necesito una cama' });
    await correrTurnoConReintentos();

    expect(mockOpenAICreate.mock.calls.length).toBeGreaterThan(1); // hubo reintentos
    const enviados = mockTwilioCreate.mock.calls.map(c => c[0].body).join(' ');
    expect(enviados).toContain('Se me complicó la conexión');
    expect(mockFetchWithRetry).not.toHaveBeenCalled(); // ninguna tarjeta al panel
  });

  test('a la segunda vez seguida sí escala a un asesor', async () => {
    mockOpenAICreate.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }));
    const from = 'whatsapp:+573009990011';

    for (let i = 0; i < 2; i++) {
      recibirMensaje({ from, toNumber: TO, texto: 'sigo esperando' });
      await correrTurnoConReintentos();
    }

    expect(mockFetchWithRetry).toHaveBeenCalled();
    expect(JSON.parse(mockFetchWithRetry.mock.calls[0][1].body).tipo).toBe('asesor');
  });

  test('un error nuestro (no del proveedor) escala de inmediato', async () => {
    mockOpenAICreate.mockRejectedValue(new TypeError('x is not a function'));

    recibirMensaje({ from: 'whatsapp:+573009990012', toNumber: TO, texto: 'necesito una cama' });
    await correrTurnoConReintentos();

    expect(mockFetchWithRetry).toHaveBeenCalled();
    const enviados = mockTwilioCreate.mock.calls.map(c => c[0].body).join(' ');
    expect(enviados).toContain('Un asesor te contactará pronto');
  });
});

describe('Quitar del carrito', () => {
  const CARRITO = [
    { producto: 'SOFA ROMA', precio: '$3.000.000', cantidad: 1 },
    { producto: 'SOFA CAMA TORELLO', precio: '$2.500.000', cantidad: 1 },
  ];

  test('con dos productos parecidos pide aclarar en vez de borrar los dos', async () => {
    db.verCarrito.mockResolvedValue(CARRITO);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('quitar_del_carrito', { producto: 'sofa' }))
      .mockResolvedValue(respuestaSimple('¿Cuál de los dos? 😊'));

    recibirMensaje({ from: 'whatsapp:+573009990020', toNumber: TO, texto: 'quita el sofá' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(false);
    expect(res.ambiguo).toBe(true);
    expect(res.coincidencias).toHaveLength(2);
    expect(db.updateEstado).not.toHaveBeenCalled();
  });

  test('con el nombre completo quita solo ese', async () => {
    db.verCarrito.mockResolvedValue(CARRITO);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('quitar_del_carrito', { producto: 'SOFA CAMA TORELLO' }))
      .mockResolvedValue(respuestaSimple('Listo 😊'));

    const from = 'whatsapp:+573009990021';
    recibirMensaje({ from, toNumber: TO, texto: 'quita el sofá cama torello' });
    await correrTurno();

    expect(db.updateEstado).toHaveBeenCalledWith(from, { carrito: [CARRITO[0]] });
  });
});
