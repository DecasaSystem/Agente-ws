// Seguimientos: los mensajes que el agente envía por iniciativa propia.
//
// Aquí lo que importa no es que el mensaje salga, sino CUÁNDO NO debe salir. Un
// seguimiento mal enviado es spam: fuera de la ventana de 24 h la plataforma lo rechaza o
// lo cobra, encima de un asesor humano interrumpe una conversación real, y repetido hace
// que el cliente bloquee el número. Cada test de aquí cubre una de esas formas de molestar.

const seguimientos = require('../../seguimientos');

// Cola en memoria con la misma superficie que db, para probar el worker entero sin BD.
function crearDeps(sobrescribir = {}) {
  const cola = [];
  const enviados = [];
  const historial = [];
  const eventos = [];
  let siguienteId = 1;

  const base = {
    db: {
      programarSeguimiento: async ({ destinatario, tipo, referencia, cuando, datos }) => {
        const yaHay = cola.find(s => s.destinatario === destinatario && s.tipo === tipo &&
          String(s.referencia) === String(referencia) && s.estado === 'pendiente');
        if (yaHay) return false; // la clave única de la tabla hace esto en producción
        cola.push({ id: siguienteId++, destinatario, tipo, referencia, cuando: new Date(cuando), datos, estado: 'pendiente', posposiciones: 0 });
        return true;
      },
      getSeguimientosPendientes: async (limite = 20) =>
        cola.filter(s => s.estado === 'pendiente' && s.cuando <= new Date()).slice(0, limite),
      marcarSeguimiento: async (id, estado, motivo) => {
        const s = cola.find(x => x.id === id);
        if (s) { s.estado = estado; s.motivo = motivo; }
      },
      posponerSeguimiento: async (id, minutos) => {
        const s = cola.find(x => x.id === id);
        if (s) { s.cuando = new Date(Date.now() + minutos * 60000); s.posposiciones++; }
      },
      cancelarSeguimientos: async ({ destinatario, tipo, referencia }) => {
        let n = 0;
        for (const s of cola) {
          if (s.estado !== 'pendiente' || s.destinatario !== destinatario) continue;
          if (tipo && s.tipo !== tipo) continue;
          if (referencia && String(s.referencia) !== String(referencia)) continue;
          s.estado = 'descartado'; s.motivo = 'cancelado'; n++;
        }
        return n;
      },
    },
    enviar: async (destinatario, texto) => { enviados.push({ destinatario, texto }); return true; },
    minutosDesdeUltimoMensaje: async () => 60,          // dentro de la ventana
    hayAsesorAtendiendo: async () => false,
    guardarEnHistorial: async (d, t) => { historial.push({ d, t }); },
    evento: (d, tipo, detalle) => eventos.push({ d, tipo, detalle }),
    // Acceso para los asserts
    _cola: cola, _enviados: enviados, _historial: historial, _eventos: eventos,
  };
  return Object.assign(base, sobrescribir);
}

const CLIENTE = '573001112233';
const ayer = () => new Date(Date.now() - 60 * 60 * 1000); // ya tocaba hace una hora

describe('Construcción del mensaje', () => {
  test('rellena los datos y no deja placeholders sueltos', () => {
    const m = seguimientos.construirMensaje('cita_24h', { nombre: 'Ana', dia: 'jueves 1 de octubre de 2026', hora: '10:00', sede: 'Decasa Bolívar' });
    expect(m).toContain('Ana');
    expect(m).toContain('10:00');
    expect(m).toContain('Decasa Bolívar');
    expect(m).not.toMatch(/\{|\}/);
    expect(m).not.toContain('undefined');
  });

  test('sin nombre no queda un saludo raro', () => {
    const m = seguimientos.construirMensaje('carrito_abandonado', { producto: 'CAMA BALI' });
    expect(m).not.toContain('undefined');
    expect(m).not.toContain('¡Hola !');
    expect(m).toContain('CAMA BALI');
  });

  test('un tipo sin plantilla configurada devuelve null (no se inventa un texto)', () => {
    expect(seguimientos.construirMensaje('tipo_inexistente', {})).toBeNull();
  });
});

describe('Cuándo NO se puede enviar', () => {
  test('fuera de la ventana de 24 h se descarta, no se envía', async () => {
    const deps = crearDeps({ minutosDesdeUltimoMensaje: async () => 25 * 60 });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: { producto: 'CAMA BALI' } });

    const resumen = await seguimientos.procesarPendientes(deps);

    expect(resumen).toMatchObject({ enviados: 0, descartados: 1 });
    expect(deps._enviados).toHaveLength(0);
    expect(deps._cola[0].motivo).toBe('fuera_de_ventana');
  });

  test('justo en el límite de 24 h tampoco se envía', async () => {
    const deps = crearDeps({ minutosDesdeUltimoMensaje: async () => 24 * 60 });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: {} });
    await seguimientos.procesarPendientes(deps);
    expect(deps._enviados).toHaveLength(0);
  });

  test('sin dato de última interacción se prefiere callar', async () => {
    const deps = crearDeps({ minutosDesdeUltimoMensaje: async () => null });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: {} });
    await seguimientos.procesarPendientes(deps);
    expect(deps._enviados).toHaveLength(0);
    expect(deps._cola[0].motivo).toBe('sin_datos');
  });

  test('con un asesor atendiendo se pospone, no se descarta', async () => {
    const deps = crearDeps({ hayAsesorAtendiendo: async () => true });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'cita_24h', referencia: '2026-10-01', cuando: ayer(), datos: {} });

    const resumen = await seguimientos.procesarPendientes(deps);

    expect(resumen).toMatchObject({ enviados: 0, pospuestos: 1 });
    expect(deps._enviados).toHaveLength(0);
    expect(deps._cola[0].estado).toBe('pendiente'); // sigue vivo para más tarde
    expect(deps._cola[0].posposiciones).toBe(1);
  });

  test('si el asesor sigue horas después, se acaba descartando', async () => {
    const deps = crearDeps({ hayAsesorAtendiendo: async () => true });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'cita_24h', referencia: 'x', cuando: ayer(), datos: {} });
    deps._cola[0].posposiciones = seguimientos.MAX_POSPOSICIONES;

    const resumen = await seguimientos.procesarPendientes(deps);

    expect(resumen.descartados).toBe(1);
    expect(deps._cola[0].estado).toBe('descartado');
  });
});

describe('Envío', () => {
  test('dentro de la ventana se envía, se marca y queda en el historial', async () => {
    const deps = crearDeps();
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: { producto: 'SOFA ROMA', nombre: 'Ana' } });

    const resumen = await seguimientos.procesarPendientes(deps);

    expect(resumen.enviados).toBe(1);
    expect(deps._enviados[0].destinatario).toBe(CLIENTE);
    expect(deps._enviados[0].texto).toContain('SOFA ROMA');
    expect(deps._cola[0].estado).toBe('enviado');
    // El modelo tiene que saber qué se le dijo al cliente
    expect(deps._historial[0].t).toContain('SOFA ROMA');
    expect(deps._eventos[0].tipo).toBe('seguimiento_enviado');
  });

  test('no se envía dos veces el mismo seguimiento', async () => {
    const deps = crearDeps();
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: { producto: 'CAMA BALI' } });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: { producto: 'CAMA BALI' } });

    await seguimientos.procesarPendientes(deps);
    await seguimientos.procesarPendientes(deps); // segunda pasada del worker

    expect(deps._enviados).toHaveLength(1);
  });

  test('lo programado para más tarde no se envía todavía', async () => {
    const deps = crearDeps();
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: new Date(Date.now() + 3600e3), datos: {} });
    expect((await seguimientos.procesarPendientes(deps)).enviados).toBe(0);
  });

  test('si el envío falla, no se da por enviado', async () => {
    const deps = crearDeps({ enviar: async () => false });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: {} });
    await seguimientos.procesarPendientes(deps);
    expect(deps._cola[0].estado).toBe('descartado');
    expect(deps._cola[0].motivo).toBe('no se pudo entregar');
  });

  test('si el envío lanza, se reintenta más tarde', async () => {
    const deps = crearDeps({ enviar: async () => { throw new Error('Twilio caído'); } });
    await seguimientos.programar(deps, { destinatario: CLIENTE, tipo: 'carrito_abandonado', cuando: ayer(), datos: {} });
    const resumen = await seguimientos.procesarPendientes(deps);
    expect(resumen.pospuestos).toBe(1);
    expect(deps._cola[0].estado).toBe('pendiente');
  });
});

describe('Recordatorios de cita', () => {
  const dentroDeUnaSemana = () => {
    const d = new Date(Date.now() + 7 * 86400000);
    return d.toISOString().slice(0, 10);
  };

  test('se programan dos: el día antes y dos horas antes', async () => {
    const deps = crearDeps();
    const fecha = dentroDeUnaSemana();

    const tipos = await seguimientos.programarRecordatoriosCita(deps, {
      destinatario: CLIENTE, referencia: fecha, fechaIso: fecha, hora: '10:00', nombre: 'Ana', sede: 'Decasa Bolívar',
    });

    expect(tipos).toEqual(['cita_24h', 'cita_2h']);
    expect(deps._cola).toHaveLength(2);
    expect(deps._cola[0].cuando.getTime()).toBeLessThan(deps._cola[1].cuando.getTime());
  });

  test('para una cita inminente no se programa el de 24 h antes (ya pasó)', async () => {
    const deps = crearDeps();
    const enTresHoras = new Date(Date.now() + 3 * 3600e3);
    const fecha = enTresHoras.toISOString().slice(0, 10);
    const hora = `${String(enTresHoras.getUTCHours()).padStart(2, '0')}:00`;

    const tipos = await seguimientos.programarRecordatoriosCita(deps, {
      destinatario: CLIENTE, referencia: fecha, fechaIso: fecha, hora, nombre: 'Ana', sede: 'Sede',
    });

    expect(tipos).not.toContain('cita_24h');
  });

  test('al cancelar la cita se cancelan sus recordatorios', async () => {
    const deps = crearDeps();
    const fecha = dentroDeUnaSemana();
    await seguimientos.programarRecordatoriosCita(deps, { destinatario: CLIENTE, referencia: fecha, fechaIso: fecha, hora: '10:00', nombre: 'Ana', sede: 'Sede' });

    const cancelados = await seguimientos.cancelar(deps, { destinatario: CLIENTE, referencia: fecha });

    expect(cancelados).toBe(2);
    expect(deps._cola.every(s => s.estado === 'descartado')).toBe(true);
  });

  test('cancelar la cita de un cliente no toca la de otro', async () => {
    const deps = crearDeps();
    const fecha = dentroDeUnaSemana();
    await seguimientos.programarRecordatoriosCita(deps, { destinatario: CLIENTE, referencia: fecha, fechaIso: fecha, hora: '10:00', nombre: 'Ana', sede: 'S' });
    await seguimientos.programarRecordatoriosCita(deps, { destinatario: '573009998877', referencia: fecha, fechaIso: fecha, hora: '11:00', nombre: 'Luis', sede: 'S' });

    await seguimientos.cancelar(deps, { destinatario: CLIENTE, referencia: fecha });

    expect(deps._cola.filter(s => s.destinatario === '573009998877' && s.estado === 'pendiente')).toHaveLength(2);
  });
});
