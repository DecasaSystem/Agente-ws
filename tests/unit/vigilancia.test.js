// Vigilancia del negocio: detectar que el agente dejó de vender EN SILENCIO.
//
// Lo que se prueba aquí es lo contrario de lo habitual: no que el sistema funcione, sino
// que AVISE cuando parece funcionar y no está sirviendo para nada. Cada caso corresponde a
// una forma real de fallar en silencio.

const vigilancia = require('../../vigilancia');

// Dependencias sanas por defecto; cada test rompe solo lo que quiere probar.
function deps(sobrescribir = {}) {
  const alertas = [];
  const base = {
    contarConversaciones: async () => 12,
    contarInventario: async () => 318,
    contarNotificacionesAtascadas: async () => 0,
    estadoHorario: () => ({ abierto: true }),
    alertar: (titulo, detalle) => alertas.push({ titulo, detalle }),
    alertas,
  };
  return Object.assign(base, sobrescribir);
}

describe('Vigilancia del negocio', () => {
  test('con todo en orden no alerta de nada', async () => {
    const d = deps();
    const hallazgos = await vigilancia.revisarSaludDelNegocio(d);
    expect(hallazgos).toEqual([]);
    expect(d.alertas).toEqual([]);
  });

  test('inventario vacío: el agente responde "no encontré nada" a todos', async () => {
    const d = deps({ contarInventario: async () => 0 });
    await vigilancia.revisarSaludDelNegocio(d);
    expect(d.alertas[0].titulo).toContain('Inventario vacío');
  });

  test('sin conversaciones en horario laboral: algo dejó de llegar', async () => {
    const d = deps({ contarConversaciones: async () => 0 });
    await vigilancia.revisarSaludDelNegocio(d);
    expect(d.alertas[0].titulo).toContain('Sin conversaciones');
  });

  test('sin conversaciones FUERA de horario no alerta: es lo normal', async () => {
    const d = deps({ contarConversaciones: async () => 0, estadoHorario: () => ({ abierto: false }) });
    const hallazgos = await vigilancia.revisarSaludDelNegocio(d);
    expect(hallazgos).toEqual([]);
  });

  test('notificaciones atascadas: hay pedidos que el equipo no está viendo', async () => {
    const d = deps({ contarNotificacionesAtascadas: async () => 4 });
    await vigilancia.revisarSaludDelNegocio(d);
    expect(d.alertas[0].titulo).toContain('4 notificación');
  });

  test('token por caducar: avisa ANTES de quedarse mudo', async () => {
    const ahora = new Date('2026-09-28T12:00:00Z');
    const enTresDias = ahora.getTime() + 3 * 86400000;
    const d = deps({ expiracionToken: async () => enTresDias, ahora });
    await vigilancia.revisarSaludDelNegocio(d);
    expect(d.alertas[0].titulo).toContain('caduca en 3 día');
  });

  test('token ya caducado: el agente no puede responder', async () => {
    const ahora = new Date('2026-09-28T12:00:00Z');
    const d = deps({ expiracionToken: async () => ahora.getTime() - 86400000, ahora });
    await vigilancia.revisarSaludDelNegocio(d);
    expect(d.alertas[0].titulo).toContain('caducado');
  });

  test('token con margen de sobra: no molesta', async () => {
    const ahora = new Date('2026-09-28T12:00:00Z');
    const d = deps({ expiracionToken: async () => ahora.getTime() + 40 * 86400000, ahora });
    expect(await vigilancia.revisarSaludDelNegocio(d)).toEqual([]);
  });

  test('varios problemas a la vez: se avisa de todos', async () => {
    const d = deps({ contarInventario: async () => 0, contarConversaciones: async () => 0, contarNotificacionesAtascadas: async () => 2 });
    const hallazgos = await vigilancia.revisarSaludDelNegocio(d);
    expect(hallazgos).toHaveLength(3);
    expect(d.alertas).toHaveLength(3);
  });

  test('si una comprobación falla, se avisa y las demás siguen', async () => {
    const d = deps({ contarInventario: async () => { throw new Error('BD caída'); } });
    const hallazgos = await vigilancia.revisarSaludDelNegocio(d);
    expect(hallazgos[0].titulo).toContain('No se pudo comprobar el inventario');
    expect(hallazgos[0].detalle).toContain('BD caída');
  });

  test('iniciarVigilancia no bloquea el cierre del proceso', () => {
    const intervalo = vigilancia.iniciarVigilancia(deps(), 30);
    expect(intervalo).toBeDefined();
    clearInterval(intervalo);
  });
});
