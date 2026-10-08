// Festivos de Colombia (fechas.js) y su efecto en citas y en el horario de atención
// (horario.js). Las tiendas no abren en festivo (decisión del dueño, 2026-10-08).

const fechas = require('../../fechas');
const { estadoHorario } = require('../../horario');

describe('festivosColombia', () => {
  test('2026 coincide con el calendario oficial', () => {
    expect([...fechas.festivosColombia(2026).keys()].sort()).toEqual([
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
      '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
      '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
    ]);
  });

  test('los trasladables se corren al lunes y la Semana Santa sale de la Pascua', () => {
    expect(fechas.festivo(fechas.fechaCivil(2027, 3, 25))).toBe('Jueves Santo');   // Pascua 2027: 28 de marzo
    expect(fechas.festivo(fechas.fechaCivil(2027, 10, 18))).toBe('Día de la Raza'); // 12 oct 2027 es martes
    expect(fechas.festivo(fechas.fechaCivil(2026, 10, 13))).toBeNull();
  });
});

describe('agendar en festivo', () => {
  const referencia = fechas.fechaCivil(2026, 10, 8);

  test('no se agenda y se propone el siguiente día hábil', () => {
    const r = fechas.validarFechaHoraCita('lunes 12 de octubre de 2026', '10:00', { referencia });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/festivo \(Día de la Raza\)/);
    expect(r.error).toMatch(/martes 13 de octubre de 2026/);
  });

  test('un día normal sigue funcionando', () => {
    expect(fechas.validarFechaHoraCita('martes 13 de octubre de 2026', '10:00', { referencia }).ok).toBe(true);
  });

  test('si un negocio abre en festivos, se puede apagar', () => {
    expect(fechas.validarFechaHoraCita('lunes 12 de octubre de 2026', '10:00', { referencia, cerradoEnFestivos: false }).ok).toBe(true);
  });

  test('la lista de próximos días marca el festivo', () => {
    const bloque = fechas.bloqueFechaParaPrompt(new Date('2026-10-09T15:00:00Z'));
    expect(bloque).toMatch(/lunes 12 de octubre de 2026 \(FESTIVO: Día de la Raza, cerrado\)/);
  });
});

describe('horario de atención con festivos', () => {
  const negocio = {
    zonaHoraria: 'America/Bogota', cerradoEnFestivos: true,
    horario: { semana: { abre: 8, cierra: 17 }, sabado: { abre: 8, cierra: 12 }, domingoCerrado: true },
  };
  // Las horas en UTC: Bogotá es UTC-5.
  const bogota = (fecha, h) => new Date(`${fecha}T${String(h + 5).padStart(2, '0')}:00:00Z`);

  test('un festivo a media mañana está cerrado y responden al día siguiente', () => {
    expect(estadoHorario(negocio, 0, bogota('2026-10-12', 10))).toEqual({ abierto: false, proximaApertura: 'mañana a partir de las 8am' });
  });

  test('el domingo antes de un lunes festivo: responden el martes', () => {
    expect(estadoHorario(negocio, 0, bogota('2026-10-11', 10)).proximaApertura).toBe('el martes a partir de las 8am');
  });

  test('un día hábil normal no cambia', () => {
    expect(estadoHorario(negocio, 0, bogota('2026-10-13', 10)).abierto).toBe(true);
    expect(estadoHorario(negocio, 0, bogota('2026-10-18', 10)).proximaApertura).toBe('mañana lunes a partir de las 8am');
  });
});
