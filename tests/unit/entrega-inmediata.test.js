// Dueño, 2026-11-03: a lo que está en existencia se le puede decir al cliente que es para
// entrega inmediata, además del 5 % pagando en efectivo o transferencia.

const negocio = require('../../negocio');

describe('notaEnExistencia', () => {
  test('con unidades: entrega inmediata y el 5 %', () => {
    const nota = negocio.notaEnExistencia({ nombre: 'SOFA CONFORT', existencias: 2 });
    expect(nota).toMatch(/entrega inmediata/);
    expect(nota).toMatch(/5% de descuento/);
    expect(nota).toMatch(/No digas en qué tienda/);
  });

  test('sin unidades o sin saberlo: no hay nota', () => {
    expect(negocio.notaEnExistencia({ existencias: 0 })).toBeNull();
    expect(negocio.notaEnExistencia({ existencias: null })).toBeNull();
    expect(negocio.notaEnExistencia(undefined)).toBeNull();
  });
});
