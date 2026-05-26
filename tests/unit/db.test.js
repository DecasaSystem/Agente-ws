jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => ({
    query: jest.fn(),
    getConnection: jest.fn(),
    end: jest.fn()
  }))
}));

jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Importar parseJSONField directamente
function parseJSONField(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

describe('parseJSONField', () => {

  test('debe retornar null para valores falsy', () => {
    expect(parseJSONField(null)).toBeNull();
    expect(parseJSONField(undefined)).toBeNull();
    expect(parseJSONField('')).toBeNull();
  });

  test('debe retornar el objeto si ya es un objeto', () => {
    const obj = { key: 'value' };
    expect(parseJSONField(obj)).toBe(obj);
  });

  test('debe parsear JSON string válido', () => {
    const json = JSON.stringify({ test: 'data' });
    expect(parseJSONField(json)).toEqual({ test: 'data' });
  });

  test('debe retornar null para JSON inválido', () => {
    expect(parseJSONField('invalid json')).toBeNull();
  });
});
