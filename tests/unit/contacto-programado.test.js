// "Que me contacten mañana a las 11" (caso real del 2026-11-03): la hora tiene que ser de
// atención y la tarjeta llega 10 minutos antes.

const negocio = require('../../negocio');
const { programarContacto, parsearHora } = require('../../contacto-programado');

// Martes 3 de noviembre de 2026, 2:01 pm en Bogotá.
const ahora = new Date('2026-11-03T14:01:00-05:00');
const prog = (dia, hora) => programarContacto(negocio, dia, hora, { ahora });

describe('programarContacto', () => {
  test('mañana a las 11: la tarjeta sale a las 10:50 am', () => {
    const r = prog('miércoles 4 de noviembre de 2026', '11:00');
    expect(r.ok).toBe(true);
    expect(r.texto).toBe('miércoles 4 de noviembre de 2026 a las 11:00 am');
    expect(r.cuando.toISOString()).toBe('2026-11-04T16:00:00.000Z');
    expect(new Date(ahora.getTime() + r.retrasoSegundos * 1000).toISOString()).toBe('2026-11-04T15:50:00.000Z');
    expect(r.lineaResumen).toMatch(/^⏰ CONTACTAR EL MIÉRCOLES 4 DE NOVIEMBRE/);
  });

  test('entre semana, hasta 20 min antes del cierre de las 4:35 pm', () => {
    expect(prog('miércoles 4 de noviembre', '16:15').ok).toBe(true);
    const tarde = prog('miércoles 4 de noviembre', '16:30');
    expect(tarde.ok).toBe(false);
    expect(tarde.error).toMatch(/entre las 8:00 am y las 4:15 pm/);
    expect(prog('miércoles 4 de noviembre', '7:30 am').ok).toBe(false);
  });

  test('sábado hasta las 11:40 am; domingo y festivo no', () => {
    expect(prog('sábado 7 de noviembre', '11:30').ok).toBe(true);
    expect(prog('sábado 7 de noviembre', '12:00').error).toMatch(/11:40 am/);
    expect(prog('domingo 8 de noviembre', '10:00').error).toMatch(/domingo/);
    // 16 de noviembre de 2026: Independencia de Cartagena (lunes festivo).
    expect(prog('lunes 16 de noviembre', '10:00').error).toMatch(/festivo/);
  });

  test('una hora de hoy que ya pasó, un día que no cuadra o una fecha muy lejana no se programan', () => {
    expect(prog('martes 3 de noviembre de 2026', '9:00').error).toMatch(/ya pasaron/);
    expect(prog('jueves 4 de noviembre', '10:00').error).toMatch(/NO es jueves/);
    expect(prog('martes 26 de enero de 2027', '10:00').error).toMatch(/más de 30 días/);
  });

  test('dentro de menos de 10 minutos sale ya (retraso 0)', () => {
    expect(prog('martes 3 de noviembre de 2026', '14:05').retrasoSegundos).toBe(0);
  });
});

test('parsearHora entiende 24 h, am/pm y "3" de la tarde', () => {
  expect(parsearHora('11:00')).toBe(660);
  expect(parsearHora('3:30 pm')).toBe(930);
  expect(parsearHora('3')).toBe(900);
  expect(parsearHora('12 m')).toBeNull();
  expect(parsearHora('mañana')).toBeNull();
});
