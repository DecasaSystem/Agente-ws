// Qué variantes deciden el precio, con la regla del sistema de ventas (precio-variantes.js).

const { analizarVariantes, precioMinimoCombinado } = require('../../precio-variantes');

const v = (etiqueta, precio, tipo, extra = {}) => ({ etiqueta, precio, tipo, afectaPrecio: true, precioPropio: true, ...extra });

describe('analizarVariantes', () => {
  test('un tipo con precio + un tipo cosmético: el color no entra al rango de precios', () => {
    const cama = { variantes: [
      v('1.40', 2880000, 'Medidas', { precioPropio: false }), // adicional 0 → vale el base
      v('1.60', 2980000, 'Medidas'),
      v('Natural', 2880000, 'Color', { precioPropio: false }),
      v('Wengué', 2880000, 'Color', { precioPropio: false }),
    ] };
    const a = analizarVariantes(cama);
    expect(a.tiposDePrecio).toEqual(['Medidas']);
    expect(a.dePrecio.map(x => x.etiqueta)).toEqual(['1.40', '1.60']);
    expect(a.cosmeticas.map(x => x.etiqueta)).toEqual(['Natural', 'Wengué']);
    expect(a.combinaTipos).toBe(false);
  });

  test('un tipo marcado afecta_precio = 0 nunca decide el precio', () => {
    const a = analizarVariantes({ variantes: [v('Rojo', 900000, 'Mantel', { afectaPrecio: false })] });
    expect(a.dePrecio).toEqual([]);
    expect(a.cosmeticas).toHaveLength(1);
  });

  test('dos tipos con precio propio: combina (lo cotiza un asesor)', () => {
    const base = { variantes: [v('1.60', 2000000, 'Medidas'), v('6 pts', 500000, 'Puestos')] };
    expect(analizarVariantes(base).combinaTipos).toBe(true);
  });

  test('datos viejos sin precioPropio se comportan como antes (todo cuenta)', () => {
    const a = analizarVariantes({ variantes: [{ etiqueta: '1.90', precio: 2480000, tipo: 'Medidas', afectaPrecio: true }] });
    expect(a.dePrecio).toHaveLength(1);
  });
});

describe('precioMinimoCombinado: la combinación más barata, como la suma el sistema', () => {
  test('suma una opción por tipo', () => {
    const p = { variantes: [
      v('1.60', 2000000, 'Medidas'), v('1.80', 2300000, 'Medidas'),
      v('4 pts', 400000, 'Puestos'), v('6 pts', 500000, 'Puestos'),
    ] };
    expect(precioMinimoCombinado(p, 9999999)).toBe(2400000);
  });

  test('una opción sin precio propio suma 0, y si todo da 0 vale el base', () => {
    const p = { variantes: [
      v('1.40', 1500000, 'Medidas', { precioPropio: false }), v('1.60', 2000000, 'Medidas'),
      v('4 pts', 1500000, 'Puestos', { precioPropio: false }), v('6 pts', 500000, 'Puestos'),
    ] };
    // 1.40 + 4 pts = 0 + 0 → base 1.500.000; 1.40 + 6 pts = 500.000 (la más barata)
    expect(precioMinimoCombinado(p, 1500000)).toBe(500000);
  });
});
