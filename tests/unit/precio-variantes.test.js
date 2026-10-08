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

  test('"Solo diferencia" sin precio cargado no decide el precio', () => {
    const a = analizarVariantes({ variantes: [v('Rojo', 900000, 'Mantel', { afectaPrecio: false, precioPropio: false })] });
    expect(a.dePrecio).toEqual([]);
    expect(a.cosmeticas).toHaveLength(1);
  });

  test('lo que cobra el sistema manda: con precio cargado cuenta aunque el tipo diga "Solo diferencia"', () => {
    // Nueva orden suma el precio_adicional sin mirar afecta_precio.
    const a = analizarVariantes({ variantes: [v('Eléctrica', 2980000, 'Mecanismo', { afectaPrecio: false, precioPropio: true })] });
    expect(a.dePrecio).toHaveLength(1);
  });

  test('silla reclinable: Manual (palanca, precio base) y Eléctrica (botón, su precio)', () => {
    const silla = { precio: 2580000, variantes: [
      v('Manual', 2580000, 'Mecanismo', { precioPropio: false }), // precio_adicional 0 → base
      v('Eléctrica', 2980000, 'Mecanismo'),
      v('Gris', 2580000, 'Color', { afectaPrecio: false, precioPropio: false }),
    ] };
    const a = analizarVariantes(silla);
    expect(a.tiposDePrecio).toEqual(['Mecanismo']);
    expect(a.dePrecio.map(x => [x.etiqueta, x.precio])).toEqual([['Manual', 2580000], ['Eléctrica', 2980000]]);
    expect(a.cosmeticas.map(x => x.etiqueta)).toEqual(['Gris']);
    expect(a.combinaTipos).toBe(false);
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

describe('infoVentaPorJuego: productos que se venden de a N', () => {
  const { infoVentaPorJuego } = require('../../precio-variantes');

  test('por unidad: nada que aclarar', () => {
    expect(infoVentaPorJuego({ piezasPorJuego: null }, 500000)).toBeNull();
    expect(infoVentaPorJuego({ piezasPorJuego: 1 }, 500000)).toBeNull();
  });

  test('en juego: el precio es del juego y la pieza suelta tiene el suyo', () => {
    const r = infoVentaPorJuego({ piezasPorJuego: 2, precioPieza: 450000 }, 800000);
    expect(r.piezas_por_juego).toBe(2);
    expect(r.precio_pieza_suelta).toBe(450000);
    expect(r.nota_juego).toMatch(/juego de 2/);
  });

  test('sin precio de pieza: el juego entre N, como en el sistema de ventas', () => {
    expect(infoVentaPorJuego({ piezasPorJuego: 2, precioPieza: null }, 800000).precio_pieza_suelta).toBe(400000);
  });

  test('con variantes de precio la pieza suelta la confirma un asesor', () => {
    const p = { piezasPorJuego: 2, variantes: [
      { etiqueta: 'Natural', precio: 800000, tipo: 'Acabado', afectaPrecio: true, precioPropio: true },
      { etiqueta: 'Wengué', precio: 900000, tipo: 'Acabado', afectaPrecio: true, precioPropio: true },
    ] };
    const r = infoVentaPorJuego(p, 800000);
    expect(r.precio_pieza_suelta).toBeUndefined();
    expect(r.nota_juego).toMatch(/asesor/);
  });
});

test('infoVentaPorJuego: una opción con su propio número de piezas se avisa', () => {
  const { infoVentaPorJuego } = require('../../precio-variantes');
  const p = { piezasPorJuego: 4, variantes: [
    { etiqueta: '4 pts', precio: 1200000, tipo: 'Puestos', afectaPrecio: true, precioPropio: true },
    { etiqueta: '6 pts', precio: 1700000, tipo: 'Puestos', afectaPrecio: true, precioPropio: true, piezasPorJuego: 6 },
  ] };
  const r = infoVentaPorJuego(p, 1200000);
  expect(r.piezas_por_opcion).toEqual(['6 pts: juego de 6']);
  expect(r.nota_juego).toMatch(/otro número/);
});
