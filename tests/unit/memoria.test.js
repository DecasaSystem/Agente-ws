// Memoria del cliente: el perfil que se recuerda entre conversaciones y el resumen de lo
// hablado cuando la conversación se hace larga.
//
// Dos riesgos que estos tests vigilan: que el perfil PIERDA datos (un turno donde el cliente
// no menciona su presupuesto no debe borrarlo) y que CREZCA sin límite (inflaría el prompt en
// cada mensaje).

const memoria = require('../../memoria');

const moneda = n => '$' + Number(n).toLocaleString('es-CO');

describe('Fusión del perfil', () => {
  test('los datos nuevos se suman a los que ya había', () => {
    let perfil = memoria.fusionarPerfil(null, { nombre: 'Ana', presupuesto: 3000000 });
    perfil = memoria.fusionarPerfil(perfil, { espacio: 'apartamento pequeño' });

    expect(perfil).toMatchObject({ nombre: 'Ana', presupuesto: 3000000, espacio: 'apartamento pequeño' });
  });

  test('un turno sin datos NO borra lo que ya se sabía', () => {
    const antes = memoria.fusionarPerfil(null, { nombre: 'Ana', presupuesto: 3000000, espacio: 'sala' });
    const despues = memoria.fusionarPerfil(antes, {});

    expect(despues).toMatchObject({ nombre: 'Ana', presupuesto: 3000000, espacio: 'sala' });
  });

  test('un presupuesto inválido no sobrescribe el bueno', () => {
    const antes = memoria.fusionarPerfil(null, { presupuesto: 3000000 });
    expect(memoria.fusionarPerfil(antes, { presupuesto: 0 }).presupuesto).toBe(3000000);
    expect(memoria.fusionarPerfil(antes, { presupuesto: 'no sé' }).presupuesto).toBe(3000000);
  });

  test('las preferencias no se duplican y las nuevas van primero', () => {
    let perfil = memoria.fusionarPerfil(null, { preferencias: ['madera clara'] });
    perfil = memoria.fusionarPerfil(perfil, { preferencias: ['resiste mascotas', 'Madera Clara'] });

    expect(perfil.preferencias).toHaveLength(2);           // "Madera Clara" no se repite
    expect(perfil.preferencias[0]).toBe('Madera Clara');   // lo último que dijo, primero
  });

  test('las listas tienen tope: el prompt no puede crecer sin freno', () => {
    let perfil = null;
    for (let i = 0; i < 20; i++) {
      perfil = memoria.fusionarPerfil(perfil, { preferencias: [`gusto ${i}`], productos_interes: [`PRODUCTO ${i}`] });
    }
    expect(perfil.preferencias.length).toBeLessThanOrEqual(memoria.MAX_PREFERENCIAS);
    expect(perfil.productos_interes.length).toBeLessThanOrEqual(memoria.MAX_PRODUCTOS);
  });

  test('los textos largos se recortan', () => {
    const perfil = memoria.fusionarPerfil(null, { espacio: 'x'.repeat(300), nombre: 'y'.repeat(200) });
    expect(perfil.espacio.length).toBeLessThanOrEqual(80);
    expect(perfil.nombre.length).toBeLessThanOrEqual(60);
  });
});

describe('Contexto del perfil', () => {
  test('sin datos no se inyecta nada (no se gastan tokens en vacío)', () => {
    expect(memoria.construirContextoPerfil(null)).toBeNull();
    expect(memoria.construirContextoPerfil(memoria.perfilVacio())).toBeNull();
  });

  test('con datos arma un bloque legible y con la moneda del negocio', () => {
    const perfil = memoria.fusionarPerfil(null, {
      nombre: 'Ana', presupuesto: 3000000, espacio: 'apartamento pequeño',
      preferencias: ['resiste mascotas'], productos_interes: ['CAMA BALI'],
    });
    const ctx = memoria.construirContextoPerfil(perfil, { formatearMoneda: moneda });

    expect(ctx).toContain('Ana');
    expect(ctx).toContain('$3.000.000');
    expect(ctx).toContain('apartamento pequeño');
    expect(ctx).toContain('CAMA BALI');
    // Y la instrucción de no recitarlo como una ficha
    expect(ctx).toContain('NO se lo recites');
  });
});

describe('Cuándo resumir', () => {
  test('con pocos mensajes no hace falta', () => {
    expect(memoria.necesitaResumen(5, null)).toBe(false);
    expect(memoria.necesitaResumen(memoria.UMBRAL_RESUMEN - 1, null)).toBe(false);
  });

  test('pasado el umbral, sí', () => {
    expect(memoria.necesitaResumen(memoria.UMBRAL_RESUMEN, null)).toBe(true);
  });

  test('no se resume en cada turno: hace falta que haya mensajes nuevos', () => {
    const previo = { texto: 'resumen', hasta: 12 };
    expect(memoria.necesitaResumen(13, previo)).toBe(false);   // solo uno nuevo
    expect(memoria.necesitaResumen(12 + memoria.MENSAJES_ENTRE_RESUMENES, previo)).toBe(true);
  });
});

describe('Generación del resumen', () => {
  function openaiFalso(respuesta) {
    return { llamadas: [], chat: { completions: { create: async (req) => {
      openaiFalso.ultimaPeticion = req;
      if (respuesta instanceof Error) throw respuesta;
      return { choices: [{ message: { content: respuesta } }] };
    } } } };
  }

  test('pide el resumen con la transcripción y devuelve el texto', async () => {
    const openai = openaiFalso('Busca cama para apartamento. Descartó la CAMA FIGY por precio.');
    const texto = await memoria.generarResumen(openai, [
      { role: 'user', content: 'busco una cama' },
      { role: 'assistant', content: 'tengo la CAMA FIGY a $5.780.000' },
      { role: 'user', content: 'muy caro' },
    ]);

    expect(texto).toContain('Descartó');
    const enviado = JSON.stringify(openaiFalso.ultimaPeticion);
    expect(enviado).toContain('busco una cama');
    expect(enviado).toContain('DESCART');  // se le pide explícitamente lo descartado
  });

  test('si el modelo falla, se sigue sin resumen en vez de romper el turno', async () => {
    const openai = openaiFalso(new Error('OpenAI caído'));
    expect(await memoria.generarResumen(openai, [{ role: 'user', content: 'hola' }])).toBeNull();
  });

  test('sin mensajes no se llama al modelo', async () => {
    let llamado = false;
    const openai = { chat: { completions: { create: async () => { llamado = true; return {}; } } } };
    expect(await memoria.generarResumen(openai, [])).toBeNull();
    expect(llamado).toBe(false);
  });
});

describe('Preparación del historial', () => {
  function dbFalsa(nMensajes, resumenPrevio = null) {
    const historial = Array.from({ length: nMensajes }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant', content: `mensaje ${i + 1}`,
    }));
    const guardados = [];
    return {
      _guardados: guardados,
      getHistorial: async () => historial,
      getResumenConversacion: async () => resumenPrevio,
      setResumenConversacion: async (d, r) => { guardados.push(r); },
    };
  }

  test('conversación corta: se pasa entera y no se resume', async () => {
    const db = dbFalsa(6);
    let llamado = false;
    const openai = { chat: { completions: { create: async () => { llamado = true; return {}; } } } };

    const r = await memoria.prepararHistorial({ db }, 'cliente', { openai });

    expect(r.mensajes).toHaveLength(6);
    expect(llamado).toBe(false);
  });

  test('conversación larga: solo los últimos literales y se genera el resumen', async () => {
    const db = dbFalsa(30);
    const openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'resumen de lo antiguo' } }] }) } } };

    const r = await memoria.prepararHistorial({ db }, 'cliente', { openai });

    expect(r.mensajes).toHaveLength(memoria.MENSAJES_LITERALES);
    expect(r.mensajes[r.mensajes.length - 1].content).toBe('mensaje 30'); // los más recientes
    expect(r.resumen.texto).toBe('resumen de lo antiguo');
    expect(db._guardados).toHaveLength(1);                                // se guarda para no repetirlo
  });

  test('si ya hay un resumen reciente, no se vuelve a pedir', async () => {
    const db = dbFalsa(14, { texto: 'ya resumido', hasta: 13 });
    let llamado = false;
    const openai = { chat: { completions: { create: async () => { llamado = true; return {}; } } } };

    const r = await memoria.prepararHistorial({ db }, 'cliente', { openai });

    expect(llamado).toBe(false);
    expect(r.resumen.texto).toBe('ya resumido');
  });

  test('sin cliente de OpenAI se trunca pero no se rompe', async () => {
    const db = dbFalsa(30);
    const r = await memoria.prepararHistorial({ db }, 'cliente', {});
    expect(r.mensajes).toHaveLength(memoria.MENSAJES_LITERALES);
    expect(r.resumenNuevo).toBeNull();
  });
});
