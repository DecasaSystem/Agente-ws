// Un producto puede venderse en varias medidas con precios distintos. Antes el agente
// cotizaba siempre precio_base: para el COLCHON SOPHIA decia $760.000 cuando la medida
// de 1.40 vale $960.000, comprometiendo un precio por debajo del real.

const mockTwilioCreate = jest.fn().mockResolvedValue({ sid: 'SM_test' });
const mockOpenAICreate = jest.fn();
const mockGetInventario = jest.fn();

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
jest.mock('../../httpClient', () => ({ fetchWithRetry: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../db', () => {
  const base = {
    getInventarioFromDB: (...a) => mockGetInventario(...a),
    getHistorial: jest.fn(async () => []),
    estaTransferida: jest.fn(async () => false),
    consumirReactivacionAsesor: jest.fn(async () => false),
    getUltimosMostrados: jest.fn(async () => []),
    getEstado: jest.fn(async () => ({})),
    verCarrito: jest.fn(async () => []),
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
const {
  recibirMensaje, DEBOUNCE_MS, cargarInventario,
  infoPrecioVariantes, precioMinimo, encontrarVariante,
} = require('../../index');

// Réplica de casos reales de la base de datos de DeCasa.
const INVENTARIO = {
  camas: {
    nombre: 'Camas',
    productos: [
      {
        nombre: 'CAMA MIAMI', precio: '$2.880.000', medidas: '1.60 / 1.90', material: 'Flor Morado', imagen: 'x.jpg',
        variantes: [
          { etiqueta: '1.90', precio: 2480000, tipo: 'Cama Miami medidas', afectaPrecio: true },
          { etiqueta: '1.60', precio: 2980000, tipo: 'Cama Miami medidas', afectaPrecio: true },
        ],
      },
      {
        nombre: 'CAMA SENCILLA', precio: '$1.200.000', medidas: '1.00 x 1.90', material: 'Pino', imagen: 'y.jpg',
        variantes: [],
      },
    ],
  },
  sillas_comedor: {
    nombre: 'Sillas de comedor',
    productos: [
      {
        // Variantes que NO cambian el precio (color): sigue habiendo precio único.
        nombre: 'Silla comedor Selene', precio: '$780.000', medidas: '45x50', material: 'Madera', imagen: 'z.jpg',
        variantes: [
          { etiqueta: 'Natural', precio: 780000, tipo: 'Colores selene', afectaPrecio: true },
          { etiqueta: 'cafe', precio: 780000, tipo: 'Colores selene', afectaPrecio: true },
        ],
      },
    ],
  },
};

function respuestaConTool(nombre, args) {
  return {
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: nombre, arguments: JSON.stringify(args) } }] } }],
  };
}
const respuestaFinal = { usage: { prompt_tokens: 5, completion_tokens: 5 }, choices: [{ finish_reason: 'stop', message: { content: 'listo 😊' } }] };

// Devuelve el contenido que la herramienta le entregó al modelo.
function resultadoDeHerramienta() {
  const llamada = mockOpenAICreate.mock.calls.find(c => c[0].messages.some(m => m.role === 'tool'));
  return JSON.parse(llamada[0].messages.find(m => m.role === 'tool').content);
}

beforeAll(async () => {
  mockGetInventario.mockResolvedValue(INVENTARIO);
  await cargarInventario();
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  db.estaTransferida.mockResolvedValue(false);
  db.getHistorial.mockResolvedValue([]);
  db.verCarrito.mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

async function correrTurno() {
  await jest.advanceTimersByTimeAsync(DEBOUNCE_MS + 100);
  await jest.advanceTimersByTimeAsync(0);
}

describe('Lectura de variantes', () => {
  test('precios distintos: no se entrega un precio unico, sino el rango', () => {
    const info = infoPrecioVariantes(INVENTARIO.camas.productos[0]);
    expect(info.precio).toBeNull();
    expect(info.precio_desde).toBe(2480000);
    expect(info.precio_hasta).toBe(2980000);
    expect(info.variantes).toEqual([
      { opcion: '1.90', precio: 2480000 },
      { opcion: '1.60', precio: 2980000 },
    ]);
    expect(info.nota_variantes).toContain('PRECIOS DISTINTOS');
  });

  test('sin variantes: el precio se entrega tal cual', () => {
    expect(infoPrecioVariantes(INVENTARIO.camas.productos[1])).toEqual({ precio: '$1.200.000' });
  });

  test('variantes del mismo precio (colores): precio unico y opciones como extra', () => {
    const info = infoPrecioVariantes(INVENTARIO.sillas_comedor.productos[0]);
    expect(info.precio).toBe('$780.000');
    expect(info.precio_desde).toBeUndefined();
    expect(info.opciones).toEqual(['Natural', 'cafe']);
  });

  test('precioMinimo usa el precio de entrada para comparar con el presupuesto', () => {
    expect(precioMinimo(INVENTARIO.camas.productos[0])).toBe(2480000);
    expect(precioMinimo(INVENTARIO.camas.productos[1])).toBe(1200000);
  });

  test('encontrarVariante tolera como escriba el cliente la medida', () => {
    const cama = INVENTARIO.camas.productos[0];
    expect(encontrarVariante(cama, '1.60').precio).toBe(2980000);
    expect(encontrarVariante(cama, '1,60').precio).toBe(2980000);
    expect(encontrarVariante(cama, '160').precio).toBe(2980000);
    expect(encontrarVariante(cama, '2.00')).toBeNull();
  });
});

describe('buscar_productos con variantes', () => {
  test('el modelo recibe el rango y la instruccion de no dar precio unico', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('buscar_productos', { consulta: 'cama miami' }))
      .mockResolvedValue(respuestaFinal);

    recibirMensaje({ from: 'whatsapp:+573001', toNumber: 'whatsapp:+15550001', texto: 'cuanto vale la cama miami' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    const cama = res.productos.find(p => p.nombre === 'CAMA MIAMI');
    expect(cama.precio).toBeNull();
    expect(cama.precio_desde).toBe(2480000);
    expect(cama.precio_hasta).toBe(2980000);
    expect(cama.nota_variantes).toBeDefined();
  });
});

describe('agregar_al_carrito con variantes', () => {
  test('sin variante, la herramienta rechaza y pide preguntar al cliente', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('agregar_al_carrito', { producto: 'CAMA MIAMI', precio: '$2.480.000' }))
      .mockResolvedValue(respuestaFinal);

    recibirMensaje({ from: 'whatsapp:+573002', toNumber: 'whatsapp:+15550001', texto: 'la quiero' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(false);
    expect(res.requiere_variante).toBe(true);
    expect(res.opciones).toEqual([
      { opcion: '1.90', precio: '$2.480.000' },
      { opcion: '1.60', precio: '$2.980.000' },
    ]);
    expect(db.agregarAlCarrito).not.toHaveBeenCalled();
  });

  test('con variante, manda el precio de la BD aunque el modelo pase otro', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('agregar_al_carrito', {
        producto: 'CAMA MIAMI',
        precio: '$2.480.000',   // el modelo insiste en el precio de entrada...
        variante: '1.60',       // ...pero el cliente eligio la de 1.60
      }))
      .mockResolvedValue(respuestaFinal);

    recibirMensaje({ from: 'whatsapp:+573003', toNumber: 'whatsapp:+15550001', texto: 'la de 1.60' });
    await correrTurno();

    const res = resultadoDeHerramienta();
    expect(res.exito).toBe(true);
    expect(res.variante).toBe('1.60');
    // El carrito se guarda con el precio real de esa medida, no con el que dijo el modelo
    expect(db.agregarAlCarrito).toHaveBeenCalledWith('whatsapp:+573003', 'CAMA MIAMI (1.60)', '$2.980.000', 1);
  });

  test('un producto sin variantes entra al carrito como siempre', async () => {
    mockOpenAICreate
      .mockResolvedValueOnce(respuestaConTool('agregar_al_carrito', { producto: 'CAMA SENCILLA', precio: '$1.200.000' }))
      .mockResolvedValue(respuestaFinal);

    recibirMensaje({ from: 'whatsapp:+573004', toNumber: 'whatsapp:+15550001', texto: 'quiero la sencilla' });
    await correrTurno();

    expect(resultadoDeHerramienta().exito).toBe(true);
    expect(db.agregarAlCarrito).toHaveBeenCalledWith('whatsapp:+573004', 'CAMA SENCILLA', '$1.200.000', 1);
  });
});

describe('Validacion de precios', () => {
  test('los precios de variantes cuentan como validos', () => {
    const { validarPrecios } = require('../../index');
    // 2.980.000 solo existe como precio de una variante: no debe tratarse como inventado
    const alertas = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a) => alertas.push(a.join(' ')));
    validarPrecios('whatsapp:+573005', 'La CAMA MIAMI en 1.60 cuesta $2.980.000', new Set());
    spy.mockRestore();
    expect(alertas.join(' ')).not.toContain('inventado');
  });
});
