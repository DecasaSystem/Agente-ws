// El motor de evaluación del prompt (core/evaluacion/runner.js).
//
// La evaluación de verdad llama al modelo real y cuesta dinero, así que no va en npm test.
// Lo que se prueba aquí es el motor: que detecte lo que tiene que detectar. Un evaluador que
// da todo por bueno es peor que no tener evaluador, porque genera confianza falsa.

const runner = require('../../evaluacion/runner');

// Modelo simulado: se le dice qué hacer en cada ronda.
function openaiFalso(guion) {
  let i = 0;
  return {
    llamadas: [],
    chat: { completions: { create: async (req) => {
      const paso = guion[i++] ?? { texto: '(fin)' };
      if (paso.tool) {
        return { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: paso.tool, arguments: JSON.stringify(paso.args ?? {}) } }] } }] };
      }
      return { choices: [{ finish_reason: 'stop', message: { content: paso.texto } }] };
    } } },
  };
}

const opcionesBase = {
  modelo: 'modelo-de-prueba',
  systemPrompt: 'eres un agente de prueba',
  tools: [],
  ejecutarHerramienta: async () => ({ ok: true }),
};

describe('Ejecución de un caso', () => {
  test('registra las herramientas llamadas y la respuesta final de cada turno', async () => {
    const caso = { id: 'x', mensajes: ['cuánto vale la cama bali?'] };
    const openai = openaiFalso([
      { tool: 'buscar_productos', args: { consulta: 'cama bali' } },
      { texto: 'La CAMA BALI cuesta $2.880.000 😊' },
    ]);

    const turnos = await runner.ejecutarCaso(caso, { ...opcionesBase, openai });

    expect(turnos).toHaveLength(1);
    expect(turnos[0].herramientas.map(h => h.nombre)).toEqual(['buscar_productos']);
    expect(turnos[0].respuesta).toContain('2.880.000');
  });

  test('varios turnos mantienen la conversación', async () => {
    const caso = { id: 'x', mensajes: ['hola', 'y la cama bali?'] };
    const openai = openaiFalso([
      { texto: '¡Hola! ¿Qué buscas?' },
      { tool: 'buscar_productos', args: { consulta: 'cama bali' } },
      { texto: 'Cuesta $2.880.000' },
    ]);

    const turnos = await runner.ejecutarCaso(caso, { ...opcionesBase, openai });

    expect(turnos).toHaveLength(2);
    expect(turnos[1].herramientas).toHaveLength(1);
  });

  test('no se queda colgado si el modelo pide herramientas sin parar', async () => {
    const caso = { id: 'x', mensajes: ['hola'] };
    const guionInfinito = Array.from({ length: 20 }, () => ({ tool: 'buscar_productos', args: {} }));
    const openai = openaiFalso(guionInfinito);

    const turnos = await runner.ejecutarCaso(caso, { ...opcionesBase, openai, maxRondas: 3 });

    expect(turnos[0].herramientas).toHaveLength(3);
  });
});

describe('Evaluación del resultado', () => {
  const turnosDe = (herramientas, respuesta) => ([{ cliente: 'x', herramientas, respuesta }]);

  test('detecta una herramienta que faltó', () => {
    const caso = { esperado: { herramientas: ['buscar_productos'] } };
    const fallos = runner.evaluarResultado(caso, turnosDe([], 'cuesta $2.880.000'));
    expect(fallos).toEqual(['no llamó a buscar_productos']);
  });

  test('detecta una herramienta que no debía llamarse', () => {
    const caso = { esperado: { herramientas_prohibidas: ['agregar_al_carrito'] } };
    const fallos = runner.evaluarResultado(caso, turnosDe([{ nombre: 'agregar_al_carrito', args: {} }], 'listo'));
    expect(fallos[0]).toContain('llamó a agregar_al_carrito');
  });

  test('detecta texto que falta y texto prohibido', () => {
    const caso = { esperado: { texto_contiene: ['2\\.480\\.000'], texto_prohibido: ['90\\s?%'] } };
    const fallos = runner.evaluarResultado(caso, turnosDe([], 'te doy un 90 % de descuento'));
    expect(fallos).toHaveLength(2);
    expect(fallos[0]).toContain('no menciona');
    expect(fallos[1]).toContain('menciona');
  });

  test('comprueba los argumentos de una herramienta', () => {
    const caso = { esperado: { argumentos: [{ herramienta: 'agregar_al_carrito', tiene: { variante: '1.60' } }] } };

    const mal = runner.evaluarResultado(caso, turnosDe([{ nombre: 'agregar_al_carrito', args: { variante: '1.90' } }], ''));
    expect(mal[0]).toContain('fue "1.90" y se esperaba "1.60"');

    const bien = runner.evaluarResultado(caso, turnosDe([{ nombre: 'agregar_al_carrito', args: { variante: '1.60' } }], ''));
    expect(bien).toEqual([]);
  });

  test('con * exige que el argumento venga, sea cual sea', () => {
    const caso = { esperado: { argumentos: [{ herramienta: 'agendar_cita', tiene: { nombre: '*' } }] } };

    expect(runner.evaluarResultado(caso, turnosDe([{ nombre: 'agendar_cita', args: { nombre: '' } }], ''))[0]).toContain('vino vacío');
    expect(runner.evaluarResultado(caso, turnosDe([{ nombre: 'agendar_cita', args: { nombre: 'Ana' } }], ''))).toEqual([]);
  });

  test('un caso correcto no produce fallos', () => {
    const caso = {
      esperado: {
        herramientas: ['buscar_productos'],
        herramientas_prohibidas: ['agregar_al_carrito'],
        texto_contiene: ['2\\.880\\.000'],
        texto_prohibido: ['90\\s?%'],
      },
    };
    const fallos = runner.evaluarResultado(caso, turnosDe([{ nombre: 'buscar_productos', args: {} }], 'La CAMA BALI cuesta $2.880.000 😊'));
    expect(fallos).toEqual([]);
  });
});

describe('Informe', () => {
  test('agrupa por categoría y calcula el porcentaje', () => {
    const informe = runner.resumir([
      { caso: { id: 'a', categoria: 'precios' }, fallos: [], paso: true },
      { caso: { id: 'b', categoria: 'precios' }, fallos: ['x'], paso: false },
      { caso: { id: 'c', categoria: 'seguridad' }, fallos: [], paso: true },
    ]);

    expect(informe.total).toBe(3);
    expect(informe.pasaron).toBe(2);
    expect(informe.porcentaje).toBe(67);
    expect(informe.porCategoria.precios).toMatchObject({ total: 2, pasaron: 1 });
    expect(informe.porCategoria.precios.fallos[0].id).toBe('b');
  });

  test('un error de red marca el caso pero no tumba la evaluación', async () => {
    const openai = { chat: { completions: { create: async () => { throw new Error('sin conexión'); } } } };
    const informe = await runner.evaluarTodos([{ id: 'a', categoria: 'x', mensajes: ['hola'] }], { ...opcionesBase, openai });

    expect(informe.total).toBe(1);
    expect(informe.pasaron).toBe(0);
    expect(informe.resultados[0].fallos[0]).toContain('sin conexión');
  });
});

describe('El corpus de casos', () => {
  const { casos } = require('../../evaluacion/casos.json');

  test('todos los casos están bien formados', () => {
    expect(casos.length).toBeGreaterThanOrEqual(20);
    for (const c of casos) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.categoria).toBe('string');
      // Cada caso explica QUÉ problema real cubre: sin eso, dentro de tres meses nadie
      // sabe por qué está ahí ni si se puede borrar.
      expect(typeof c.por_que).toBe('string');
      expect(Array.isArray(c.mensajes) && c.mensajes.length).toBeTruthy();
      expect(c.esperado).toBeDefined();
    }
  });

  test('no hay ids repetidos', () => {
    const ids = casos.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('las expresiones regulares de los casos son válidas', () => {
    for (const c of casos) {
      for (const patron of [...(c.esperado.texto_contiene ?? []), ...(c.esperado.texto_prohibido ?? [])]) {
        expect(() => new RegExp(patron, 'i')).not.toThrow();
      }
    }
  });

  test('cubre las categorías críticas del negocio', () => {
    const categorias = new Set(casos.map(c => c.categoria));
    for (const critica of ['precios', 'carrito', 'disponibilidad', 'agendar', 'objeciones', 'seguridad', 'politicas']) {
      expect(categorias).toContain(critica);
    }
  });
});
