// Los describes de `detectarCategoriaEnMensaje` y `buscarProductoEnHistorial` se
// eliminaron: esas funciones eran del sistema de reglas por regex anterior a la
// migración a OpenAI con function calling y ya no existen en utils.js, así que los
// tests fallaban desde entonces contra código muerto.

const {
  setInventario,
  generarInventarioTexto,
  buscarMasBarato,
  buscarProductosRelacionados,
} = require('../../utils');

// Inventario de prueba con la misma forma que el real (objeto por categoría).
const INVENTARIO = {
  sillas_comedor: {
    nombre: 'Sillas de comedor',
    productos: [
      { nombre: 'SILLA VIENA',  material: 'Flor Morado', precio: '$450.000' },
      { nombre: 'SILLA NÓRDICA', material: 'Roble',      precio: '$320.000' },
      { nombre: 'SILLA BARI',   material: 'Tapizada',    precio: '$680.000' },
    ],
  },
  sofas: {
    nombre: 'Sofás',
    productos: [
      { nombre: 'SOFÁ ROMA', material: 'Tela antifluido', precio: '$3.000.000' },
    ],
  },
};

beforeEach(() => setInventario(INVENTARIO));

describe('generarInventarioTexto', () => {
  test('lista las categorías y sus productos', () => {
    const texto = generarInventarioTexto();
    expect(texto).toContain('INVENTARIO DE PRODUCTOS');
    expect(texto).toContain('Sillas de comedor');
    expect(texto).toContain('SILLA VIENA');
    expect(texto).toContain('Flor Morado');
  });

  test('no revienta con el inventario sin cargar', () => {
    setInventario(null);
    expect(generarInventarioTexto()).toContain('INVENTARIO DE PRODUCTOS');
  });
});

describe('buscarMasBarato', () => {
  test('devuelve el producto de menor precio de la categoría', () => {
    expect(buscarMasBarato('sillas_comedor').nombre).toBe('SILLA NÓRDICA');
  });

  test('devuelve null para una categoría que no existe', () => {
    expect(buscarMasBarato('categoria_inexistente')).toBeNull();
  });

  test('no altera el orden del inventario original', () => {
    buscarMasBarato('sillas_comedor');
    expect(INVENTARIO.sillas_comedor.productos[0].nombre).toBe('SILLA VIENA');
  });
});

describe('buscarProductosRelacionados', () => {
  test('respeta el límite pedido', () => {
    expect(buscarProductosRelacionados('sillas_comedor', 2)).toHaveLength(2);
  });

  test('devuelve como mucho lo que haya en la categoría', () => {
    expect(buscarProductosRelacionados('sofas', 5)).toHaveLength(1);
  });

  test('devuelve array vacío para una categoría que no existe', () => {
    expect(buscarProductosRelacionados('inexistente')).toEqual([]);
  });
});
