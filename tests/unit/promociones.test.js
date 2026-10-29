// Promociones por tienda del sistema de ventas (core/promociones.js): la misma cuenta y la
// misma prioridad que Promocion::precioCon y utils/promociones.js de la app, más las
// decisiones del dueño del 2026-10-20 (solo en existencia, se dicen las tiendas).

const promociones = require('../../promociones');

const promo = (extra = {}) => ({
  id: 1, nombre: null, config_id: null, variante_id: null, tipo: 'porcentaje', valor: 15,
  fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31', tiendas: ['Unicentro', 'Vía El Edén'], ...extra,
});

const BALI = (promos, existencias = 2) => ({
  nombre: 'CAMA BALI', precio: '$1.500.000', existencias,
  variantes: [
    { etiqueta: '1.40', precio: 1500000, tipo: 'Medidas', precioPropio: true, configId: 10, varianteId: null },
    { etiqueta: '1.60', precio: 1800000, tipo: 'Medidas', precioPropio: true, configId: 11, varianteId: null },
  ],
  promociones: promos,
});
const HOY = { hoy: '2026-10-15' };

describe('precioCon: los tres tipos, como Promocion::precioCon', () => {
  test('porcentaje, monto y precio final', () => {
    expect(promociones.precioCon({ tipo: 'porcentaje', valor: 15 }, 1500000)).toBe(1275000);
    expect(promociones.precioCon({ tipo: 'monto', valor: 200000 }, 1500000)).toBe(1300000);
    expect(promociones.precioCon({ tipo: 'precio', valor: 1290000 }, 1500000)).toBe(1290000);
  });
  test('nunca sube el precio ni baja de 0', () => {
    expect(promociones.precioCon({ tipo: 'precio', valor: 2000000 }, 1500000)).toBe(1500000);
    expect(promociones.precioCon({ tipo: 'monto', valor: 9000000 }, 1500000)).toBe(0);
  });
});

describe('promoPara: cuál le toca a cada versión', () => {
  test('la de la medida 1.40 solo rebaja la 1.40', () => {
    const p = BALI([promo({ config_id: 10 })]);
    const r = promociones.promoPara(p, p.variantes[0], HOY);
    expect(r).toMatchObject({ precioLista: 1500000, precioPromo: 1275000, aplica: true });
    expect(promociones.promoPara(p, p.variantes[1], HOY)).toBeNull();
  });

  test('la de la medida gana sobre la del producto entero aunque rebaje menos', () => {
    const p = BALI([promo({ id: 1, valor: 30 }), promo({ id: 2, config_id: 10, valor: 10 })]);
    expect(promociones.promoPara(p, p.variantes[0], HOY).promo.id).toBe(2);
    // La 1.60 no tiene una propia: le toca la del producto.
    expect(promociones.promoPara(p, p.variantes[1], HOY).precioPromo).toBe(1260000);
  });

  test('entre dos del mismo nivel, la que más rebaja', () => {
    const p = BALI([promo({ id: 1, valor: 10 }), promo({ id: 2, tipo: 'monto', valor: 400000 })]);
    expect(promociones.promoPara(p, null, HOY).promo.id).toBe(2);
  });

  test('fuera de fechas no corre', () => {
    const p = BALI([promo()]);
    expect(promociones.promoPara(p, null, { hoy: '2026-09-30' })).toBeNull();
    expect(promociones.promoPara(p, null, { hoy: '2026-10-31' })).not.toBeNull();
    expect(promociones.promoPara(p, null, { hoy: '2026-11-01' })).toBeNull();
  });

  test('sin existencia la promoción no aplica (dueño, 2026-10-20)', () => {
    const p = BALI([promo()], 0);
    expect(promociones.promoPara(p, null, HOY).aplica).toBe(false);
  });
});

describe('resumenPromociones: lo que ve Elena', () => {
  test('dice la versión, la rebaja, las tiendas y hasta cuándo', () => {
    const [r] = promociones.resumenPromociones(BALI([promo({ config_id: 10, nombre: 'Feria de octubre' })]), HOY);
    expect(r).toMatchObject({
      nombre: 'Feria de octubre', version: '1.40', rebaja: '−15 %',
      precio_lista: 1500000, precio_promocion: 1275000,
      tiendas: 'Unicentro y Vía El Edén', hasta: '31 de oct', aplica: true,
    });
    expect(promociones.lineaPromocion(r)).toMatch(/queda en \$1\.275\.000 .* en Unicentro y Vía El Edén, hasta el 31 de oct/);
  });

  test('si se fabrica, lo marca para que no la ofrezca', () => {
    const [r] = promociones.resumenPromociones(BALI([promo()], 0), HOY);
    expect(r.aplica).toBe(false);
    expect(r.nota).toMatch(/NO aplica/);
  });

  test('sin promociones, lista vacía', () => {
    expect(promociones.resumenPromociones(BALI([]), HOY)).toEqual([]);
    expect(promociones.resumenPromociones({ nombre: 'X' }, HOY)).toEqual([]);
  });
});
