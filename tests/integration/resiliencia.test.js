// Pruebas de las redes de seguridad: respeto a la transferencia con asesor, guardado
// de contexto durante la espera, escalado cuando el agente falla y cola durable de
// notificaciones al sistema de ventas.

const mockTwilioCreate     = jest.fn().mockResolvedValue({ sid: 'SM_test' });
const mockOpenAICreate     = jest.fn();
const mockFetchWithRetry   = jest.fn().mockResolvedValue({ ok: true });

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
jest.mock('../../httpClient', () => ({ fetchWithRetry: (...a) => mockFetchWithRetry(...a) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

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
      message: {
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: nombre, arguments: JSON.stringify(args) } }],
      },
    }],
  };
}

// Deja correr el debounce y drena las promesas encadenadas (incluido el fire-and-forget
// de notificarRedes, que encola después de que falle el envío directo).
async function correrTurno() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  process.env.DECASA_API_URL = 'https://api.decasa.test';
  mockOpenAICreate.mockResolvedValue(respuestaSimple('Claro que sí 😊'));
  mockFetchWithRetry.mockResolvedValue({ ok: true });
  db.estaTransferida.mockResolvedValue(false);
  db.getHistorial.mockResolvedValue([]);
});

afterEach(() => jest.useRealTimers());

describe('Cliente transferido a un asesor', () => {
  test('la IA no responde y se guarda lo que el cliente escribe', async () => {
    db.estaTransferida.mockResolvedValue(true);
    const from = 'whatsapp:+573001112233';

    recibirMensaje({ from, toNumber: TO, texto: 'necesito que sea en color nogal' });
    await correrTurno();

    // El modelo no se invoca: el asesor humano está a cargo
    expect(mockOpenAICreate).not.toHaveBeenCalled();

    // Pero el mensaje sí queda en el historial, para cuando la IA retome el chat
    expect(db.addMensaje).toHaveBeenCalledWith(from, 'user', 'necesito que sea en color nogal');
  });

  test('una foto durante la transferencia tampoco dispara a la IA', async () => {
    db.estaTransferida.mockResolvedValue(true);
    const from = 'whatsapp:+573004445566';

    recibirMensaje({ from, toNumber: TO, texto: '', mediaUrl: 'https://api.twilio.test/img.jpg', mediaType: 'image/jpeg' });
    await correrTurno();

    expect(mockOpenAICreate).not.toHaveBeenCalled();
    expect(db.addMensaje).toHaveBeenCalledWith(from, 'user', '[el cliente envió una imagen o nota de voz]');

    // El flujo de imagen ni siquiera arranca: antes el chequeo de transferencia iba
    // DESPUÉS de este bloque, así que Elena acusaba recibo y se ponía a analizar la
    // foto en medio de la conversación del asesor.
    const enviados = mockTwilioCreate.mock.calls.map(c => String(c[0].body));
    expect(enviados.some(b => b.includes('analizándola'))).toBe(false);
    expect(require('../../image-processor').downloadFromTwilio).not.toHaveBeenCalled();
  });

  test('el aviso de espera no se repite en cada mensaje', async () => {
    db.estaTransferida.mockResolvedValue(true);
    const from = 'whatsapp:+573007778899';

    recibirMensaje({ from, toNumber: TO, texto: 'hola?' });
    await correrTurno();
    recibirMensaje({ from, toNumber: TO, texto: 'sigue ahí?' });
    await correrTurno();

    const avisos = mockTwilioCreate.mock.calls.filter(c => String(c[0].body).includes('El asesor te responderá pronto'));
    expect(avisos).toHaveLength(1);
  });
});

describe('Cola durable de notificaciones', () => {
  test('si el sistema de ventas falla, la notificación se encola en vez de perderse', async () => {
    mockFetchWithRetry.mockRejectedValue(new Error('ECONNREFUSED'));
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Quiere confirmar disponibilidad de Cama Lisboa' }))
      .mockResolvedValue(respuestaSimple('Un asesor te contacta enseguida 😊'));

    recibirMensaje({ from: 'whatsapp:+573001234567', toNumber: TO, texto: 'quiero hablar con un asesor' });
    await correrTurno();

    expect(db.encolarNotificacion).toHaveBeenCalled();
    const [telefono, tipo, payload] = db.encolarNotificacion.mock.calls[0];
    expect(telefono).toContain('573001234567');
    expect(tipo).toBe('asesor');
    expect(payload.mensaje).toContain('Cama Lisboa');
  });

  test('si el envío funciona, no se encola nada', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Pregunta por garantía' }))
      .mockResolvedValue(respuestaSimple('Ya te contacto un asesor 😊'));

    recibirMensaje({ from: 'whatsapp:+573001234567', toNumber: TO, texto: 'necesito un asesor' });
    await correrTurno();

    expect(mockFetchWithRetry).toHaveBeenCalled();
    expect(db.encolarNotificacion).not.toHaveBeenCalled();
  });
});

describe('Tipo de transferencia', () => {
  test('una personalización llega al panel etiquetada como tal, no como asesor genérico', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', {
        razon: 'Quiere que le fabriquen una cama de 2 metros en color nogal',
        tipo: 'personalizacion',
      }))
      .mockResolvedValue(respuestaSimple('Un asesor te cotiza eso enseguida 😊'));

    recibirMensaje({ from: 'whatsapp:+573001234567', toNumber: TO, texto: 'la quiero a la medida' });
    await correrTurno();

    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.tipo).toBe('personalizacion');
    expect(cuerpo.resumen).toContain('Solicitud de personalización');
  });

  test('sin tipo explícito se trata como solicitud de asesor', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Pregunta por la garantía' }))
      .mockResolvedValue(respuestaSimple('Te contacto un asesor 😊'));

    recibirMensaje({ from: 'whatsapp:+573001234567', toNumber: TO, texto: 'garantía?' });
    await correrTurno();

    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.tipo).toBe('asesor');
  });
});

describe('Secciones del prompt base', () => {
  test('el system prompt lleva las reglas que faltaban frente al agente de Instagram', async () => {
    recibirMensaje({ from: 'whatsapp:+573001112233', toNumber: TO, texto: 'hola, busco un sofá' });
    await correrTurno();

    const system = mockOpenAICreate.mock.calls[0][0].messages[0].content;
    expect(system).toContain('SEGURIDAD');           // anti prompt-injection
    expect(system).toContain('MUEBLE A MEDIDA');      // foto de un modelo → fabricación
    expect(system).toContain('VISIÓN DE IMÁGENES');   // reglas de foto también en turnos de texto
    expect(system).toContain('EJEMPLO de respuesta CORRECTA');
  });

  test('las reglas largas de visión NO se cargan en un turno de solo texto', async () => {
    recibirMensaje({ from: 'whatsapp:+573001112233', toNumber: TO, texto: 'cuánto vale la cama Lisboa' });
    await correrTurno();

    // Van aparte para no pagar esos tokens en cada mensaje escrito
    const system = mockOpenAICreate.mock.calls[0][0].messages[0].content;
    expect(system).not.toContain('INSTRUCCIÓN PARA IMÁGENES');
  });
});

describe('Escalado cuando el agente falla', () => {
  test('agotar las rondas de herramientas avisa a un asesor', async () => {
    // El modelo nunca cierra: siempre pide otra herramienta
    mockOpenAICreate.mockResolvedValue(respuestaConTool('buscar_productos', { consulta: 'mesa' }));

    recibirMensaje({ from: 'whatsapp:+573009998877', toNumber: TO, texto: 'busco una mesa rara' });
    await correrTurno();

    expect(mockFetchWithRetry).toHaveBeenCalled();
    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.tipo).toBe('asesor');
    expect(cuerpo.resumen).toContain('límite de rondas');

    const respuesta = mockTwilioCreate.mock.calls.map(c => String(c[0].body)).join(' ');
    expect(respuesta).toContain('Un asesor te contactará pronto');
  });

  test('un error técnico avisa a un asesor en vez de dejar al cliente colgado', async () => {
    mockOpenAICreate.mockRejectedValue(new Error('OpenAI 500'));

    recibirMensaje({ from: 'whatsapp:+573005554433', toNumber: TO, texto: 'hola quiero un sofá' });
    await correrTurno();

    expect(mockFetchWithRetry).toHaveBeenCalled();
    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.tipo).toBe('asesor');
    expect(cuerpo.resumen).toContain('Error técnico');

    const respuesta = mockTwilioCreate.mock.calls.map(c => String(c[0].body)).join(' ');
    expect(respuesta).toContain('Un asesor te contactará pronto');
  });
});

describe('Nombre del cliente (ProfileName de Twilio)', () => {
  test('se guarda al crear o actualizar el cliente', async () => {
    const from = 'whatsapp:+573009990000';
    recibirMensaje({ from, toNumber: TO, texto: 'hola', profileName: 'Ana María' });
    await correrTurno();

    expect(db.getOrCreateUsuario).toHaveBeenCalledWith(from, 'Ana María');
  });

  test('la notificacion al panel lleva el nombre, no solo el numero', async () => {
    db.getNombreCliente.mockResolvedValue('Ana María');
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Quiere ver la cama Lisboa' }))
      .mockResolvedValue(respuestaSimple('Un asesor te escribe 😊'));

    recibirMensaje({ from: 'whatsapp:+573009990000', toNumber: TO, texto: 'un asesor por favor', profileName: 'Ana María' });
    await correrTurno();

    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.nombre_cliente).toBe('Ana María');
  });

  test('sin ProfileName la notificacion sigue saliendo', async () => {
    db.getNombreCliente.mockResolvedValue(null);
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('transferir_asesor', { razon: 'Pregunta por garantia' }))
      .mockResolvedValue(respuestaSimple('Listo 😊'));

    recibirMensaje({ from: 'whatsapp:+573001112222', toNumber: TO, texto: 'asesor' });
    await correrTurno();

    const cuerpo = JSON.parse(mockFetchWithRetry.mock.calls[0][1].body);
    expect(cuerpo.nombre_cliente).toBeNull();
    expect(cuerpo.tipo).toBe('asesor');
  });
});
