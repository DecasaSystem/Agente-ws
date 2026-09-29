// El prompt grande (~4.400 tokens) viaja en cada llamada y en cada ronda de herramientas.
// OpenAI cobra menos por el prefijo que ya tiene cacheado, pero solo si es IDÉNTICO entre
// llamadas. Antes el bloque de fecha iba dentro del prompt: cambiaba cada día y el caché
// no se usaba nunca. Estas pruebas fijan esa propiedad para que no se rompa sin querer:
// basta con que alguien vuelva a concatenar algo variable al primer mensaje.

const { construirSystemPrompt } = require('../../prompt');
const fechas = require('../../fechas');

describe('El prompt es cacheable', () => {
  test('no lleva la fecha dentro (viaja como mensaje aparte)', () => {
    const p = construirSystemPrompt('whatsapp');
    // El bloque real de fecha empieza así; el prompt sí puede NOMBRAR "FECHA ACTUAL" para
    // remitir al mensaje que llega detrás, y eso es correcto porque no cambia cada día.
    expect(p).not.toContain('FECHA ACTUAL: Hoy es');
    expect(p).not.toContain('Próximos días:');
  });

  test('dos llamadas seguidas producen exactamente el mismo texto', () => {
    expect(construirSystemPrompt('whatsapp')).toBe(construirSystemPrompt('whatsapp'));
    expect(construirSystemPrompt('instagram')).toBe(construirSystemPrompt('instagram'));
  });

  test('no cambia aunque cambie el día', () => {
    const real = Date.now;
    try {
      Date.now = () => new Date('2026-03-10T14:00:00Z').getTime();
      const enMarzo = construirSystemPrompt('whatsapp');
      Date.now = () => new Date('2026-11-25T14:00:00Z').getTime();
      const enNoviembre = construirSystemPrompt('whatsapp');
      expect(enMarzo).toBe(enNoviembre);
    } finally {
      Date.now = real;
    }
  });

  test('es lo bastante largo para que OpenAI lo cachee (>1024 tokens)', () => {
    // El umbral de OpenAI es 1024 tokens de prefijo; ~4 caracteres por token.
    expect(construirSystemPrompt('whatsapp').length).toBeGreaterThan(1024 * 4);
  });

  test('la fecha sigue disponible aparte, con el día correcto', () => {
    const bloque = fechas.bloqueFechaParaPrompt();
    expect(bloque).toContain('FECHA ACTUAL');
    expect(bloque).toContain('Próximos días');
  });

  test('con incluirFecha se puede imprimir el prompt completo (para revisarlo a mano)', () => {
    expect(construirSystemPrompt('whatsapp', { incluirFecha: true })).toContain('FECHA ACTUAL');
  });
});
