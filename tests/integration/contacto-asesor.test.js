// Nombre y celular antes de pasar al cliente con una persona (dueño, 2026-10-08): sin
// ellos el asesor no sabe a quién llamar y el cliente de redes queda vacío en el sistema.
// También: el descuento del 5 % por efectivo/transferencia lo calcula el código, y solo
// para lo que está en existencia: lo que se fabrica no lleva descuento (dueño, 2026-10-20).

const mockFetch = jest.fn(async () => ({ ok: true }));
// El perfil simulado recuerda lo que se guarda, como el de verdad.
let perfilActual = null;
const mockPerfil = jest.fn(async () => perfilActual);
const mockSetPerfil = jest.fn(async (_de, p) => { perfilActual = p; });
const mockGuardarPedido = jest.fn(async () => true);
const mockMarcarTransferida = jest.fn(async () => {});
// CAMA MIAMI hay en existencia; SOFA NUBE se fabrica sobre pedido.
const mockInventario = {
  camas: { nombre: 'Camas', productos: [{ nombre: 'CAMA MIAMI', precio: '$2.980.000', variantes: [], existencias: 2 }] },
  salas: { nombre: 'Salas', productos: [{ nombre: 'SOFA NUBE', precio: '$3.580.000', variantes: [], existencias: 0 }] },
  // Promoción de Inventario → Promociones: 15 % en la 1.40, en dos tiendas.
  comedores: { nombre: 'Comedores', productos: [{
    nombre: 'CAMA BALI', precio: '$1.500.000', existencias: 3,
    variantes: [
      { etiqueta: '1.40', precio: 1500000, tipo: 'Medidas', precioPropio: true, afectaPrecio: true, configId: 10, varianteId: null },
      { etiqueta: '1.60', precio: 1800000, tipo: 'Medidas', precioPropio: true, afectaPrecio: true, configId: 11, varianteId: null },
    ],
    promociones: [{ id: 7, nombre: 'Feria de octubre', config_id: 10, variante_id: null, tipo: 'porcentaje', valor: 15,
      fecha_inicio: '2026-01-01', fecha_fin: '2099-12-31', tiendas: ['Unicentro', 'Vía El Edén'] }],
  }] },
};
const mockAgregarAlCarrito = jest.fn(async () => true);
const CARRITO_MIAMI = [{ producto: 'CAMA MIAMI (1.60)', precio: '$2.980.000', cantidad: 1 }];
const mockVerCarrito = jest.fn(async () => CARRITO_MIAMI);

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
  verCarrito: (...a) => mockVerCarrito(...a),
  getInventarioFromDB: jest.fn(async () => mockInventario),
  agregarAlCarrito: (...a) => mockAgregarAlCarrito(...a),
  setUltimoProducto: jest.fn(async () => {}),
  updateEstado: jest.fn(async () => {}),
  getUltimosMostrados: jest.fn(async () => []),
  setUltimosMostrados: jest.fn(async () => {}),
  guardarPedido: (...a) => mockGuardarPedido(...a),
  marcarPedidoConfirmado: jest.fn(async () => {}),
  limpiarCarrito: jest.fn(async () => {}),
  limpiarFlujosEnCurso: jest.fn(async () => {}),
  contarPedidosRecientes: jest.fn(async () => 0),
  registrarEvento: jest.fn(async () => {}),
  cancelarSeguimientos: jest.fn(async () => {}),
  getNombreCliente: jest.fn(async () => '💕Caro💕'),
  encolarNotificacion: jest.fn(async () => {}),
  getEstado: jest.fn(async () => ({ carrito: [], ultimo_producto: null })),
  solicitudAsesorPendiente: jest.fn(async () => false),
  marcarTransferida: (...a) => mockMarcarTransferida(...a),
  getPerfil: (...a) => mockPerfil(...a),
  setPerfil: (...a) => mockSetPerfil(...a),
}));

process.env.DECASA_API_URL = 'https://api.prueba';
const { ejecutarHerramienta, cargarInventario } = require('../../index');
beforeAll(() => cargarInventario());
const esperar = () => new Promise(r => setTimeout(r, 20));
const DE = 'whatsapp:+573001112233';
const avisos = () => mockFetch.mock.calls
  .filter(c => String(c[0]).includes('/api/redes/webhook'))
  .map(c => JSON.parse(c[1].body));

beforeEach(() => {
  mockFetch.mockClear();
  mockGuardarPedido.mockClear();
  mockMarcarTransferida.mockClear();
  mockSetPerfil.mockClear();
  perfilActual = null;
  mockVerCarrito.mockImplementation(async () => CARRITO_MIAMI);
  mockPerfil.mockImplementation(async () => perfilActual);
});

describe('transferir_asesor', () => {
  test('sin nombre ni celular NO transfiere: le pide a Elena que los pregunte en un mensaje', async () => {
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'Quiere un asesor' }, DE, []);
    await esperar();
    expect(r.exito).toBe(false);
    expect(r.faltan_datos).toEqual(['nombre', 'telefono']);
    expect(r.instruccion).toMatch(/UN solo mensaje/);
    expect(r.instruccion).toMatch(/este_mismo/);
    expect(avisos()).toHaveLength(0);
    expect(mockMarcarTransferida).not.toHaveBeenCalled();
  });

  test('con nombre y "este mismo número" transfiere y el contacto viaja al sistema', async () => {
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'Quiere un asesor', nombre: 'me llamo laura gómez', telefono_contacto: 'este_mismo' }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    const [aviso] = avisos();
    expect(aviso.nombre_cliente).toBe('Laura Gómez');
    expect(aviso.contacto).toMatchObject({ nombre: 'Laura Gómez', telefono: '+573001112233' });
    expect(aviso.resumen).toMatch(/Contacto: Laura Gómez · \+573001112233/);
    // Queda en el perfil para no volver a preguntarlo.
    expect(mockSetPerfil).toHaveBeenCalledWith(DE, expect.objectContaining({ nombre: 'Laura Gómez', telefono_contacto: '+573001112233' }));
  });

  test('un celular escrito a mano se normaliza', async () => {
    await ejecutarHerramienta('transferir_asesor', { razon: 'x', nombre: 'Pedro', telefono_contacto: '310 555-1234' }, DE, []);
    await esperar();
    expect(avisos()[0].contacto.telefono).toBe('+573105551234');
  });

  test('un "celular" que no es un número se vuelve a pedir', async () => {
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'x', nombre: 'Pedro', telefono_contacto: 'no sé' }, DE, []);
    expect(r.faltan_datos).toEqual(['telefono']);
  });

  test('si ya los dio en otra conversación, no se le vuelven a pedir', async () => {
    mockPerfil.mockResolvedValue({ nombre: 'Laura Gómez', telefono_contacto: '+573209998877', presupuesto: 3000000, espacio: 'sala' });
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'x' }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    expect(avisos()[0].contacto).toMatchObject({ nombre: 'Laura Gómez', telefono: '+573209998877', presupuesto: 3000000, espacio: 'sala' });
  });

  test('si el cliente no quiere darlos, se transfiere igual (nunca se pierde por un formulario)', async () => {
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'x', cliente_no_quiso_dar_datos: true }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0].resumen).toMatch(/prefirió no dejar/);
  });
});

describe('confirmar_pedido', () => {
  test('sin nombre ni celular no se crea el pedido', async () => {
    const r = await ejecutarHerramienta('confirmar_pedido', { ciudad: 'Armenia' }, DE, []);
    await esperar();
    expect(r.exito).toBe(false);
    expect(r.faltan_datos).toContain('nombre');
    expect(mockGuardarPedido).not.toHaveBeenCalled();
    expect(avisos()).toHaveLength(0);
  });

  test('pagando en efectivo, el total con el 5 % lo calcula el código y va en el mensaje y la tarjeta', async () => {
    const r = await ejecutarHerramienta('confirmar_pedido', { nombre: 'Laura', telefono_contacto: 'este_mismo', ciudad: 'Armenia', forma_pago: 'efectivo' }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    expect(r.total_con_descuento_efectivo).toBe('$2.831.000');
    expect(r.mensaje_confirmacion).toMatch(/5% de descuento\): \$2\.831\.000/);
    const [aviso] = avisos();
    expect(aviso.resumen).toMatch(/\$2\.831\.000/);
    expect(aviso.contacto).toMatchObject({ nombre: 'Laura', telefono: '+573001112233', ciudad: 'Armenia', forma_pago: 'efectivo' });
  });

  test('pagando con tarjeta no se ofrece el total con descuento', async () => {
    const r = await ejecutarHerramienta('confirmar_pedido', { nombre: 'Laura', telefono_contacto: 'este_mismo', forma_pago: 'tarjeta' }, DE, []);
    expect(r.exito).toBe(true);
    expect(r.total_con_descuento_efectivo).toBeUndefined();
    expect(r.mensaje_confirmacion).not.toMatch(/descuento/);
  });

  test('lo que se fabrica no lleva descuento: solo se rebaja lo que está en existencia', async () => {
    mockVerCarrito.mockImplementation(async () => [...CARRITO_MIAMI, { producto: 'SOFA NUBE', precio: '$3.580.000', cantidad: 1 }]);
    const r = await ejecutarHerramienta('confirmar_pedido', { nombre: 'Laura', telefono_contacto: 'este_mismo', forma_pago: 'transferencia' }, DE, []);
    await esperar();
    // 2.980.000 × 95 % + 3.580.000 = 6.411.000
    expect(r.total_con_descuento_efectivo).toBe('$6.411.000');
    expect(r.mensaje_confirmacion).toMatch(/Sin descuento \(se fabrica sobre pedido\): SOFA NUBE/);
    expect(avisos()[0].resumen).toMatch(/sin descuento por ser para fabricar: SOFA NUBE/);
  });

  test('si todo se fabrica, no hay total con descuento', async () => {
    mockVerCarrito.mockImplementation(async () => [{ producto: 'SOFA NUBE', precio: '$3.580.000', cantidad: 1 }]);
    const r = await ejecutarHerramienta('confirmar_pedido', { nombre: 'Laura', telefono_contacto: 'este_mismo', forma_pago: 'efectivo' }, DE, []);
    expect(r.total_con_descuento_efectivo).toBeUndefined();
    expect(r.mensaje_confirmacion).not.toMatch(/descuento/);
  });
});

test('ver_carrito trae el total pagando en efectivo o transferencia', async () => {
  const r = await ejecutarHerramienta('ver_carrito', {}, DE, []);
  expect(r.total).toBe('$2.980.000');
  expect(r.total_con_descuento_efectivo).toBe('$2.831.000');
  expect(r.porcentaje_descuento_efectivo).toBe(5);
});

test('ver_carrito dice qué quedó sin descuento por fabricarse', async () => {
  mockVerCarrito.mockImplementation(async () => [...CARRITO_MIAMI, { producto: 'SOFA NUBE', precio: '$3.580.000', cantidad: 1 }]);
  const r = await ejecutarHerramienta('ver_carrito', {}, DE, []);
  expect(r.total_con_descuento_efectivo).toBe('$6.411.000');
  expect(r.sin_descuento_por_fabricacion).toEqual(['SOFA NUBE']);
});

describe('guardar_contacto: el cliente queda en Clientes → Redes apenas da sus datos', () => {
  const sincronizaciones = () => mockFetch.mock.calls
    .filter(c => String(c[0]).includes('/api/agentes/clientes-redes'))
    .map(c => JSON.parse(c[1].body));

  test('con nombre y "este mismo número" se guarda en el sistema SIN crear tarjeta', async () => {
    const r = await ejecutarHerramienta('guardar_contacto', { nombre: 'carolina ruiz', telefono_contacto: 'este_mismo' }, DE, []);
    await esperar();
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/Carolina Ruiz/);
    expect(avisos()).toHaveLength(0);
    const [s] = sincronizaciones();
    expect(s).toMatchObject({ fuente: 'whatsapp', telefono: '+573001112233', contacto: { nombre: 'Carolina Ruiz', telefono: '+573001112233' } });
  });

  test('lo que busca viaja a la ficha cuando ya dejó sus datos', async () => {
    await ejecutarHerramienta('guardar_contacto', { nombre: 'Carolina' }, DE, []);
    await ejecutarHerramienta('recordar_preferencia', { espacio: 'habitación principal', interes: 'Cama queen en madera clara, máximo $3.000.000' }, DE, []);
    await esperar();
    const ultima = sincronizaciones().pop();
    expect(ultima.contacto).toMatchObject({ nombre: 'Carolina', espacio: 'habitación principal', interes: 'Cama queen en madera clara, máximo $3.000.000' });
  });

  test('sin nombre ni celular, lo que busca no crea ficha (no se manda nada)', async () => {
    await ejecutarHerramienta('recordar_preferencia', { interes: 'Mira sofás' }, DE, []);
    await esperar();
    expect(sincronizaciones()).toHaveLength(0);
  });

  test('un número que no es celular no se guarda y se le pide a Elena confirmarlo', async () => {
    const r = await ejecutarHerramienta('guardar_contacto', { telefono_contacto: '12345' }, DE, []);
    await esperar();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/10 dígitos/);
    expect(sincronizaciones()).toHaveLength(0);
  });

  test('si no quiso darlos, al transferir no se le vuelven a pedir', async () => {
    await ejecutarHerramienta('guardar_contacto', { cliente_no_quiso_dar_datos: true }, DE, []);
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'Quiere un asesor' }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    expect(avisos()).toHaveLength(1);
  });

  test('si ya los dejó antes, la transferencia los usa sin preguntar', async () => {
    await ejecutarHerramienta('guardar_contacto', { nombre: 'Carolina', telefono_contacto: '3104445566' }, DE, []);
    const r = await ejecutarHerramienta('transferir_asesor', { razon: 'Quiere un asesor' }, DE, []);
    await esperar();
    expect(r.exito).toBe(true);
    expect(avisos()[0].contacto).toMatchObject({ nombre: 'Carolina', telefono: '+573104445566' });
  });
});

describe('promociones del sistema de ventas', () => {
  test('al agregar la 1.40 queda con el precio de promoción y dice de cuál salió', async () => {
    mockAgregarAlCarrito.mockClear();
    const r = await ejecutarHerramienta('agregar_al_carrito', { producto: 'CAMA BALI', variante: '1.40' }, DE, []);
    expect(r.exito).toBe(true);
    expect(mockAgregarAlCarrito).toHaveBeenCalledWith(DE, 'CAMA BALI (1.40)', '$1.275.000', 1, { promocion: 'Feria de octubre −15 % (lista $1.500.000)' });
    expect(r.mensaje).toMatch(/en promoción: Feria de octubre/);
  });

  test('la 1.60 no está en promoción: va a precio de lista', async () => {
    mockAgregarAlCarrito.mockClear();
    await ejecutarHerramienta('agregar_al_carrito', { producto: 'CAMA BALI', variante: '1.60' }, DE, []);
    expect(mockAgregarAlCarrito).toHaveBeenCalledWith(DE, 'CAMA BALI (1.60)', '$1.800.000', 1);
  });

  test('la búsqueda trae la promoción y el 5 % sobre el precio de promoción', async () => {
    const r = await ejecutarHerramienta('buscar_productos', { consulta: 'cama bali' }, DE, []);
    const bali = r.productos.find(p => p.nombre === 'CAMA BALI');
    const v140 = bali.variantes.find(v => v.opcion === '1.40');
    expect(v140).toMatchObject({ precio: 1500000, precio_promocion: 1275000, precio_pagando_efectivo: 1211250 });
    expect(bali.variantes.find(v => v.opcion === '1.60').precio_promocion).toBeUndefined();
    expect(bali.promociones[0]).toMatchObject({ version: '1.40', tiendas: 'Unicentro y Vía El Edén', aplica: true });
  });

  test('el pedido le dice al asesor con qué promoción entró cada línea', async () => {
    mockVerCarrito.mockImplementation(async () => [{ producto: 'CAMA BALI (1.40)', precio: '$1.275.000', cantidad: 1, promocion: 'Feria de octubre −15 % (lista $1.500.000)' }]);
    const r = await ejecutarHerramienta('confirmar_pedido', { nombre: 'Laura', telefono_contacto: 'este_mismo', forma_pago: 'efectivo' }, DE, []);
    await esperar();
    expect(r.total_con_descuento_efectivo).toBe('$1.211.250');
    expect(avisos()[0].resumen).toMatch(/CAMA BALI \(1\.40\) - \$1\.275\.000 \[Feria de octubre −15 %/);
  });
});
