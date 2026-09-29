// Pruebas del flujo de imagen tras consolidar los tres loops de agente en uno solo.
// Lo que se comprueba sobre todo es que el camino de respaldo (cuando la visualización
// de sala falla) se comporte igual que el flujo normal: antes era una copia aparte que
// no guardaba nada en el historial.

const mockTwilioCreate       = jest.fn().mockResolvedValue({ sid: 'SM_test' });
const mockOpenAICreate       = jest.fn();
const mockProcessRoomImage   = jest.fn();
const mockDownloadFromTwilio = jest.fn(async () => Buffer.from('imagen-falsa'));

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
jest.mock('../../image-processor', () => ({
  processRoomImage:   (...a) => mockProcessRoomImage(...a),
  downloadFromTwilio: (...a) => mockDownloadFromTwilio(...a),
}));
jest.mock('../../image-hash', () => ({ hashesCandidatos: jest.fn(async () => []), mejorCoincidencia: jest.fn(() => null) }));
jest.mock('../../httpClient', () => ({ fetchWithRetry: jest.fn().mockResolvedValue({ ok: true }) }));
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

const TO   = 'whatsapp:+15550001';
const FOTO = 'https://api.twilio.test/foto.jpg';

function respuestaSimple(texto) {
  return { usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'stop', message: { content: texto } }] };
}

async function correrTurno() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockOpenAICreate.mockResolvedValue(respuestaSimple('Te muestro estas opciones 😊'));
  db.estaTransferida.mockResolvedValue(false);
  db.getHistorial.mockResolvedValue([]);
});

afterEach(() => jest.useRealTimers());

describe('Foto del cliente (flujo normal)', () => {
  test('se manda al modelo con visión y se guarda la conversación', async () => {
    const from = 'whatsapp:+573001112233';
    recibirMensaje({ from, toNumber: TO, texto: '¿tienen algo así?', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    expect(mockOpenAICreate).toHaveBeenCalled();
    const { messages } = mockOpenAICreate.mock.calls[0][0];

    // Las reglas de visión llegan en su propio mensaje system: el primero es el prompt
    // estable que OpenAI cachea, así que nada variable puede concatenarse ahí.
    const sistemas = messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
    expect(sistemas).toContain('INSTRUCCIÓN PARA IMÁGENES');
    expect(messages[0].content).not.toContain('INSTRUCCIÓN PARA IMÁGENES');

    // Y el mensaje del usuario incluye la imagen en alta calidad
    const userMsg = messages[messages.length - 1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    const parteImagen = userMsg.content.find(c => c.type === 'image_url');
    expect(parteImagen.image_url.detail).toBe('high');
    expect(parteImagen.image_url.url).toContain('data:image/jpeg;base64,');

    // La conversación queda registrada
    expect(db.addMensaje).toHaveBeenCalledWith(from, 'assistant', 'Te muestro estas opciones 😊');
  });
});

describe('Respaldo cuando falla la visualización de sala', () => {
  test('analiza la foto igual y guarda la conversación en el historial', async () => {
    mockProcessRoomImage.mockResolvedValue({ success: false, message: 'Replicate caído' });
    const from = 'whatsapp:+573004445566';

    recibirMensaje({ from, toNumber: TO, texto: '¿cómo quedaría en mi sala?', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    // Avisa de que la visualización no está disponible
    const enviados = mockTwilioCreate.mock.calls.map(c => String(c[0].body));
    expect(enviados.some(b => b.includes('no está disponible'))).toBe(true);

    // Y cae al análisis de la foto con el mismo loop
    expect(mockOpenAICreate).toHaveBeenCalled();
    const sistemasRespaldo = mockOpenAICreate.mock.calls[0][0].messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
    expect(sistemasRespaldo).toContain('INSTRUCCIÓN PARA IMÁGENES');

    // Lo que antes NO hacía la copia de respaldo: dejar rastro en el historial
    expect(db.addMensaje).toHaveBeenCalledWith(from, 'assistant', 'Te muestro estas opciones 😊');
    expect(db.actualizarLastInteraction).toHaveBeenCalledWith(from);
  });

  test('si la visualización funciona, no se llama al modelo', async () => {
    mockProcessRoomImage.mockResolvedValue({ success: true, imageUrl: 'https://cdn.test/render.jpg' });

    recibirMensaje({ from: 'whatsapp:+573007778899', toNumber: TO, texto: 'cómo se vería en mi cuarto', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    expect(mockOpenAICreate).not.toHaveBeenCalled();
    const conMedia = mockTwilioCreate.mock.calls.find(c => c[0].mediaUrl);
    expect(conMedia[0].mediaUrl).toEqual(['https://cdn.test/render.jpg']);
  });
});

describe('Contexto compartido por todos los caminos', () => {
  test('el aviso de reactivación tras asesor también llega al flujo de imagen', async () => {
    // Antes solo el flujo de texto consultaba esto; una foto tras hablar con el asesor
    // hacía que Elena arrancara de cero.
    db.consumirReactivacionAsesor.mockResolvedValue({ atendido: true });

    recibirMensaje({ from: 'whatsapp:+573001234567', toNumber: TO, texto: 'y esta?', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    const { messages } = mockOpenAICreate.mock.calls[0][0];
    const sistemas = messages.filter(m => m.role === 'system').map(m => m.content).join(' ');
    expect(sistemas).toContain('venía siendo atendido por un asesor humano');
  });
});

// ── Identificación visual por categoría ───────────────────────────────────────
// Con inventario cargado, la foto pasa primero por vision-catalogo.js (clasificar +
// comparar con las fotos de esa categoría) y el modelo recibe el resultado como
// contexto, en vez de la foto "a secas".
describe('Foto del cliente con identificación visual por categoría', () => {
  const { cargarInventario, setPreciosInventarioParaPruebas } = require('../../index');

  beforeAll(async () => {
    db.getInventarioFromDB.mockResolvedValue({
      bases_comedores: { nombre: 'Comedores', productos: [
        { nombre: 'BASE ABANICA', precio: '$2.180.000', medidas: 'Diametro 120 (4 Puestos)', material: 'Chapilla', imagen: 'https://res.cloudinary.com/x/image/upload/v1/a.png', variantes: [] },
        { nombre: 'BASE 2K',      precio: '$1.480.000', medidas: '1.20 x 0.90 (4 Puestos)', material: 'Madera',   imagen: 'https://res.cloudinary.com/x/image/upload/v1/b.png', variantes: [] },
      ] },
      sofas: { nombre: 'Sofás', productos: [
        { nombre: 'SOFA ROMA', precio: '$3.000.000', medidas: '2.00', material: 'Tela', imagen: 'https://res.cloudinary.com/x/image/upload/v1/c.png', variantes: [] },
      ] },
    });
    await cargarInventario();
    setPreciosInventarioParaPruebas([2180000, 1480000, 3000000]);
  });

  afterAll(async () => {
    db.getInventarioFromDB.mockResolvedValue(null);
    await cargarInventario();
  });

  function json(datos) {
    return { usage: { prompt_tokens: 50, completion_tokens: 10 }, choices: [{ message: { content: JSON.stringify(datos) } }] };
  }

  test('coincidencia alta: el modelo recibe el producto identificado y solo compara con su categoría', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(json({ es_mueble: true, categorias: ['bases_comedores'], es_captura: true, texto_visible: '', descripcion: 'mesa redonda' }))
      .mockResolvedValueOnce(json({ coincidencias: [{ indice: 1, similitud: 93, razon: 'misma base en pedestal' }] }))
      .mockResolvedValue(respuestaSimple('¡Es nuestra BASE ABANICA! 😊'));

    const from = 'whatsapp:+573009990001';
    recibirMensaje({ from, toNumber: TO, texto: 'cuánto vale esta', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    expect(mockOpenAICreate).toHaveBeenCalledTimes(3);
    // La comparación solo lleva las bases de comedor, no el sofá
    const comparacion = mockOpenAICreate.mock.calls[1][0].messages[1].content;
    const textos = comparacion.filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(textos).toContain('BASE ABANICA');
    expect(textos).not.toContain('SOFA ROMA');

    // El turno del agente recibe el bloque de coincidencia con los datos reales
    const turno = mockOpenAICreate.mock.calls[2][0].messages;
    const userMsg = turno[turno.length - 1];
    const texto = userMsg.content.find(c => c.type === 'text').text;
    expect(texto).toContain('COINCIDENCIA VISUAL ALTA');
    expect(texto).toContain('BASE ABANICA — $2.180.000');
    expect(texto).toContain('cuánto vale esta');
    expect(db.registrarEvento).toHaveBeenCalledWith(from, 'vision_catalogo', expect.stringContaining('alta: BASE ABANICA'));
  });

  test('si la clasificación falla, la foto sigue al modelo como antes', async () => {
    mockOpenAICreate
      .mockRejectedValueOnce(new Error('OpenAI caída'))
      .mockResolvedValue(respuestaSimple('Cuéntame qué mueble buscas 😊'));

    const from = 'whatsapp:+573009990002';
    recibirMensaje({ from, toNumber: TO, texto: 'esta', mediaUrl: FOTO, mediaType: 'image/jpeg' });
    await correrTurno();

    const turno = mockOpenAICreate.mock.calls[1][0].messages;
    const texto = turno[turno.length - 1].content.find(c => c.type === 'text').text;
    expect(texto).not.toContain('COINCIDENCIA VISUAL');
    expect(db.addMensaje).toHaveBeenCalledWith(from, 'assistant', 'Cuéntame qué mueble buscas 😊');
  });
});
