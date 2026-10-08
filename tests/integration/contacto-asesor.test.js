// Nombre y celular antes de pasar al cliente con una persona (dueño, 2026-10-08): sin
// ellos el asesor no sabe a quién llamar y el cliente de redes queda vacío en el sistema.
// También: el descuento del 5 % por efectivo/transferencia lo calcula el código.

const mockFetch = jest.fn(async () => ({ ok: true }));
const mockPerfil = jest.fn(async () => null);
const mockSetPerfil = jest.fn(async () => {});
const mockGuardarPedido = jest.fn(async () => true);
const mockMarcarTransferida = jest.fn(async () => {});

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
  verCarrito: jest.fn(async () => [{ producto: 'CAMA MIAMI (1.60)', precio: '$2.980.000', cantidad: 1 }]),
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
const { ejecutarHerramienta } = require('../../index');
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
  mockPerfil.mockResolvedValue(null);
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
});

test('ver_carrito trae el total pagando en efectivo o transferencia', async () => {
  const r = await ejecutarHerramienta('ver_carrito', {}, DE, []);
  expect(r.total).toBe('$2.980.000');
  expect(r.total_con_descuento_efectivo).toBe('$2.831.000');
  expect(r.porcentaje_descuento_efectivo).toBe(5);
});
