// enviar_foto manda una imagen que el cliente VE, así que exige certeza. Con el score
// suelto de antes, pedir "nevera" enviaba la foto de una LAMPARA DE MESA NEGRA.

jest.mock('twilio', () => {
  const fn = jest.fn(() => ({ messages: { create: jest.fn() } }));
  fn.validateRequest = jest.fn(() => true);
  fn.twiml = { MessagingResponse: jest.fn() };
  return fn;
});
jest.mock('openai', () => {
  const M = jest.fn(() => ({ chat: { completions: { create: jest.fn() } }, audio: { transcriptions: { create: jest.fn() } } }));
  M.toFile = jest.fn();
  return M;
});
jest.mock('../../init-db', () => ({ initDB: jest.fn() }));
jest.mock('../../image-processor', () => ({ processRoomImage: jest.fn(), downloadFromTwilio: jest.fn() }));
jest.mock('../../image-hash', () => ({ hashesCandidatos: jest.fn(), mejorCoincidencia: jest.fn() }));
jest.mock('../../httpClient', () => ({ fetchWithRetry: jest.fn() }));
jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockInventario = {
  decoracion: {
    nombre: 'Decoración',
    productos: [
      { nombre: 'LAMPARA DE MESA NEGRA', precio: '$380.000', imagen: 'lampara.jpg', medidas: '40cm', material: 'Metal', variantes: [] },
      { nombre: 'LAMPARA DE PIE',        precio: '$450.000', imagen: 'pie.jpg',     medidas: '1.50',  material: 'Metal', variantes: [] },
    ],
  },
  sofas_camas: {
    nombre: 'Sofá camas',
    productos: [
      { nombre: 'SOFA TORELLO',                  precio: '$2.800.000', imagen: 'a.jpg', medidas: '1.60', material: 'Tela', variantes: [] },
      { nombre: 'SOFA CAMA TORELLO DOS PUESTOS', precio: '$3.200.000', imagen: 'b.jpg', medidas: '1.80', material: 'Tela', variantes: [] },
    ],
  },
};

jest.mock('../../db', () => ({
  getInventarioFromDB: jest.fn(async () => mockInventario),
  pool: { query: jest.fn(async () => [[]]) },
}));

const { cargarInventario, buscarImagenProducto } = require('../../index');

beforeAll(() => cargarInventario());

describe('buscarImagenProducto', () => {
  test('no manda la foto de otro producto cuando lo pedido no existe', () => {
    for (const t of ['nevera', 'televisor', 'tapete persa']) {
      expect(buscarImagenProducto(t)).toBeNull();
    }
  });

  test('encuentra el producto por su nombre real', () => {
    expect(buscarImagenProducto('LAMPARA DE PIE').nombre).toBe('LAMPARA DE PIE');
    expect(buscarImagenProducto('lampara de mesa negra').nombre).toBe('LAMPARA DE MESA NEGRA');
  });

  test('el nombre exacto gana al nombre más largo que lo contiene', () => {
    // Empataban a puntos y ganaba el primero del recorrido: pedir SOFA TORELLO
    // mandaba la foto del SOFA CAMA TORELLO DOS PUESTOS.
    expect(buscarImagenProducto('SOFA TORELLO').nombre).toBe('SOFA TORELLO');
    expect(buscarImagenProducto('SOFA CAMA TORELLO DOS PUESTOS').nombre).toBe('SOFA CAMA TORELLO DOS PUESTOS');
  });
});
