// Dueño, 2026-10-31: entre semana se atiende de 8 am a 4:35 pm, el sábado de 8 a 12, y
// desde el sábado a mediodía hasta el lunes no responde nadie. El cierre ya no es una hora
// entera, así que negocio.json acepta "16:35".

const { estadoHorario, aMinutos } = require('../../horario');
const fechas = require('../../fechas');
const negocio = require('../../negocio');

// Hora de Bogotá (UTC-5) → Date.
const bogota = (iso) => new Date(`${iso}-05:00`);

describe('horario de atención con minutos', () => {
  test('aMinutos entiende horas enteras y con minutos', () => {
    expect(aMinutos(17)).toBe(1020);
    expect(aMinutos('16:35')).toBe(995);
    expect(aMinutos('8')).toBe(480);
  });

  test('martes: abierto hasta las 4:34 pm, cerrado desde las 4:35 pm', () => {
    expect(estadoHorario(negocio, 0, bogota('2026-11-03T16:34:00')).abierto).toBe(true);
    const cerrado = estadoHorario(negocio, 0, bogota('2026-11-03T16:35:00'));
    expect(cerrado.abierto).toBe(false);
    expect(cerrado.proximaApertura).toBe('mañana a partir de las 8am');
  });

  test('sábado a las 12:30 pm: le responden el lunes', () => {
    const r = estadoHorario(negocio, 0, bogota('2026-11-07T12:30:00'));
    expect(r.abierto).toBe(false);
    expect(r.proximaApertura).toMatch(/lunes/);
  });

  test('el texto del horario que ve Elena y el cliente dice 4:35pm', () => {
    expect(negocio.horarioTexto).toMatch(/8am-4:35pm/);
    expect(negocio.horarioPublico).toMatch(/4:35pm/);
    expect(negocio.saludo('whatsapp')).toMatch(/4:35pm/);
  });
});

describe('citas con el horario de negocio.json', () => {
  const opciones = { horario: negocio.horarioCitas, referencia: new Date(Date.UTC(2026, 9, 31)) };

  test('una cita a las 5 pm entre semana se rechaza diciendo hasta las 4:35pm', () => {
    const r = fechas.validarFechaHoraCita('martes 3 de noviembre de 2026', '17:00', opciones);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/8am a 4:35pm/);
    expect(r.error).toMatch(/última cita 4:00 pm/);
  });

  test('a las 4 pm todavía se puede', () => {
    expect(fechas.validarFechaHoraCita('martes 3 de noviembre de 2026', '16:00', opciones).ok).toBe(true);
  });

  test('sábado: hasta las 11 am', () => {
    const r = fechas.validarFechaHoraCita('sábado 7 de noviembre de 2026', '11:30', opciones);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/8am a 12pm \(última cita 11:00 am\)/);
  });
});
