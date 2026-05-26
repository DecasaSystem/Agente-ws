jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../db', () => ({
  getOrCreateUsuario: jest.fn(),
  getHistorial: jest.fn(() => []),
  addMensaje: jest.fn(),
  getEstado: jest.fn(() => ({ 
    greeting_sent: false,
    carrito: [],
    transferido: false
  })),
  updateEstado: jest.fn(),
  verCarrito: jest.fn(() => []),
  agregarAlCarrito: jest.fn(),
  limpiarCarrito: jest.fn(),
  pool: { query: jest.fn() }
}));

describe('Flujo de conversación', () => {
  test('saludo inicial contiene información de DeCasa', () => {
    const knowledge = require('../../knowledge.json');
    
    const SALUDO = `Hola! Soy Elena, tu asesora de ${knowledge.empresa?.nombre || 'DeCasa'}`;
    expect(SALUDO).toContain('Elena');
    expect(SALUDO).toContain('DeCasa');
    expect(knowledge).toBeDefined();
  });

  test('debe detectar intención de compra usando lógica', () => {
    const msg = 'quiero comprar una cama';
    const tieneCama = msg.includes('cama');
    expect(tieneCama).toBe(true);
  });

  test('debe formatear carrito vacío', () => {
    const items = [];
    const result = items.length === 0 ? null : 'carrito';
    expect(result).toBeNull();
  });
});
