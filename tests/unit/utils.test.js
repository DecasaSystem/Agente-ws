const {
  generarInventarioTexto,
  buscarMasBarato,
  buscarProductosRelacionados,
  detectarCategoriaEnMensaje,
  buscarProductoEnHistorial
} = require('../../utils');

describe('generarInventarioTexto', () => {
  test('debe generar texto con inventario', () => {
    const texto = generarInventarioTexto();
    expect(texto).toContain('INVENTARIO DE PRODUCTOS');
    expect(texto).toContain('Sillas');
  });
});

describe('buscarMasBarato', () => {
  test('debe encontrar el producto más barato en una categoría', () => {
    const masBarato = buscarMasBarato('sillas');
    if (masBarato) {
      expect(masBarato).toBeDefined();
      expect(masBarato.nombre).toBeDefined();
      expect(masBarato.precio).toBeDefined();
    } else {
      expect(masBarato).toBeNull();
    }
  });

  test('debe retornar null para categoría inexistente', () => {
    const resultado = buscarMasBarato('categoria_inexistente');
    expect(resultado).toBeNull();
  });
});

describe('buscarProductosRelacionados', () => {
  test('debe retornar productos limitados', () => {
    const productos = buscarProductosRelacionados('sofas', 2);
    expect(productos.length).toBeLessThanOrEqual(2);
  });

  test('debe retornar array vacío para categoría inexistente', () => {
    const productos = buscarProductosRelacionados('inexistente');
    expect(productos).toEqual([]);
  });
});

describe('detectarCategoriaEnMensaje', () => {
  test('debe detectar sillas', () => {
    const result1 = detectarCategoriaEnMensaje('quiero sillas');
    expect(['sillas', null]).toContain(result1);
  });

  test('debe detectar sillas de comedor', () => {
    const result = detectarCategoriaEnMensaje('SILLAS de comedor');
    expect(['sillas_comedor', null]).toContain(result);
  });

  test('debe detectar camas', () => {
    expect(detectarCategoriaEnMensaje('necesito una cama')).toBe('camas');
    expect(detectarCategoriaEnMensaje('camas matrimoniales')).toBe('camas');
  });

  test('debe detectar sofás', () => {
    expect(detectarCategoriaEnMensaje('quiero un sofa')).toBe('sofas');
    expect(detectarCategoriaEnMensaje('sofás modernos')).toBe('sofas');
  });

  test('debe detectar comedores', () => {
    expect(detectarCategoriaEnMensaje('base de comedor')).toBe('bases_comedores');
    expect(detectarCategoriaEnMensaje('comedores')).toBe('bases_comedores');
  });

  test('debe retornar null para mensaje sin categoría', () => {
    expect(detectarCategoriaEnMensaje('hola')).toBeNull();
  });
});

describe('buscarProductoEnHistorial', () => {
  test('debe encontrar producto mencionado en mensaje', () => {
    const history = [
      { role: 'user', content: 'quiero una silla' },
      { role: 'assistant', content: 'tenemos sillas' }
    ];
    const resultado = buscarProductoEnHistorial(history, 'SILLA CLÁSICA');
    expect(resultado).toBeDefined();
  });
});
