// Elena como asesora experta (dueño, 2026-10-08): datos de contacto antes de transferir,
// descuento del 5 % calculado por el código, seguimientos que de verdad llegan, y un prompt
// con método de venta y sin promesas falsas.

const contacto = require('../../contacto');
const negocio = require('../../negocio');
const seguimientos = require('../../seguimientos');
const { construirSystemPrompt } = require('../../prompt');

describe('contacto: normalizar celulares', () => {
  test.each([
    ['3001234567', '+573001234567'],
    ['300 123 4567', '+573001234567'],
    ['+57 300-123-4567', '+573001234567'],
    ['57 3001234567', '+573001234567'],
    ['(606) 7451234', '+576067451234'],
    ['+1 305 555 1234', '+13055551234'],
  ])('%s → %s', (entrada, esperado) => {
    expect(contacto.normalizarTelefono(entrada)).toBe(esperado);
  });

  test.each(['', 'no sé', '12345', '2001234567', null, undefined])('"%s" no es un celular', entrada => {
    expect(contacto.normalizarTelefono(entrada)).toBeNull();
  });
});

describe('contacto: nombres', () => {
  test('quita "me llamo" y capitaliza', () => {
    expect(contacto.limpiarNombre('me llamo laura gómez')).toBe('Laura Gómez');
    expect(contacto.limpiarNombre('Hola, soy PEDRO')).toBe('Pedro');
  });
  test('saludos, monosílabos y números no son nombres', () => {
    for (const t of ['hola', 'sí', 'ok', '3001234567', 'a', '']) expect(contacto.limpiarNombre(t)).toBeNull();
  });
  test('el nombre de perfil con emojis queda limpio', () => {
    expect(contacto.limpiarNombre('💕Caro💕')).toBe('Caro');
  });
});

describe('contacto: qué falta antes de transferir', () => {
  test('en WhatsApp "este_mismo" usa el número del chat', () => {
    const r = contacto.resolverContacto({ canal: 'whatsapp', args: { nombre: 'Ana', telefono_contacto: 'este_mismo' }, telefonoCanal: '+573001112233' });
    expect(r).toMatchObject({ nombre: 'Ana', telefono: '+573001112233', faltan: [] });
  });
  test('en Instagram "este_mismo" no vale: no hay número del chat', () => {
    const r = contacto.resolverContacto({ canal: 'instagram', args: { nombre: 'Ana', telefono_contacto: 'este_mismo' } });
    expect(r.faltan).toEqual(['telefono']);
  });
  test('lo guardado en el perfil completa lo que falte', () => {
    const r = contacto.resolverContacto({ canal: 'instagram', args: { nombre: 'Ana' }, perfil: { telefono_contacto: '+573209998877' } });
    expect(r.faltan).toEqual([]);
    expect(r.telefono).toBe('+573209998877');
  });
  test('la instrucción pide solo lo que falta y deja la salida si no quiere', () => {
    const t = contacto.instruccionPedirDatos({ canal: 'instagram', faltan: ['telefono'], herramienta: 'solicitar_asesor' });
    expect(t).toMatch(/un número de celular/);
    expect(t).not.toMatch(/su nombre/);
    expect(t).toMatch(/cliente_no_quiso_dar_datos=true/);
    expect(t).not.toMatch(/este_mismo/);
  });
  test('el payload no lleva claves vacías', () => {
    const p = contacto.payloadContacto({ nombre: 'Ana', telefono: null }, { presupuesto: 0, preferencias: [] }, {});
    expect(p).toEqual({ nombre: 'Ana' });
    expect(contacto.payloadContacto({}, {}, {})).toBeNull();
  });
});

describe('descuento por efectivo o transferencia', () => {
  test('es del 5 % y lo calcula el código', () => {
    expect(negocio.porcentajeDescuentoEfectivo).toBe(5);
    expect(negocio.conDescuentoEfectivo(2980000)).toBe(2831000);
    expect(negocio.conDescuentoEfectivo(0)).toBeNull();
    expect(negocio.conDescuentoEfectivo('x')).toBeNull();
  });
});

describe('seguimientos comerciales', () => {
  function depsEnMemoria() {
    const cola = [];
    return {
      _cola: cola,
      db: {
        programarSeguimiento: async s => { cola.push(s); return true; },
        cancelarSeguimientos: async () => 0,
      },
    };
  }

  test('el carrito abandonado se programa DENTRO de la ventana de 24 h, con referencia fija', async () => {
    const deps = depsEnMemoria();
    const antes = Date.now();
    await seguimientos.programarCarritoAbandonado(deps, { destinatario: '573001112233', producto: 'CAMA MIAMI', nombre: 'Ana' });
    const [s] = deps._cola;
    const horas = (s.cuando.getTime() - antes) / 3600000;
    expect(horas).toBeGreaterThan(19.9);
    expect(horas).toBeLessThan(24);
    // Con NULL el índice único de MySQL no frenaba los repetidos.
    expect(s.referencia).toBe('carrito');
  });

  test('"lo pienso" sin carrito programa un único seguimiento al día siguiente', async () => {
    const deps = depsEnMemoria();
    await seguimientos.programarInteresPendiente(deps, { destinatario: '573001112233', producto: 'SOFÁ ROMA', nombre: 'Ana' });
    expect(deps._cola).toHaveLength(1);
    expect(deps._cola[0]).toMatchObject({ tipo: 'interes_pendiente', referencia: 'interes' });
    const texto = seguimientos.construirMensaje('interes_pendiente', deps._cola[0].datos);
    expect(texto).toMatch(/SOFÁ ROMA/);
    expect(texto).toMatch(/asesor/);
  });

  test('con carrito no se programa: ya lo cubre el de carrito abandonado', async () => {
    const deps = depsEnMemoria();
    expect(await seguimientos.programarInteresPendiente(deps, { destinatario: 'x', tieneCarrito: true })).toBe(false);
    expect(deps._cola).toHaveLength(0);
  });

  test('sin producto el mensaje sigue leyéndose bien', () => {
    const texto = seguimientos.construirMensaje('interes_pendiente', { producto: 'lo que estabas buscando' });
    expect(texto).not.toMatch(/undefined|\{/);
  });
});

describe('prompt de ventas', () => {
  const ws = construirSystemPrompt('whatsapp');
  const ig = construirSystemPrompt('instagram');

  test('el catálogo va de una vez cuando piden una categoría, y en el mismo mensaje una pregunta', () => {
    for (const p of [ws, ig]) {
      expect(p).toContain('MUESTRA EL CATÁLOGO Y ENTIENDE QUÉ BUSCA');
      expect(p).not.toMatch(/antoj/i);
      expect(p).toMatch(/"quiero ver camas".*tu PRIMER paso es LLAMAR la herramienta enviar_catalogo/s);
      expect(p).toMatch(/arranca la conversación con UNA pregunta clave/);
    }
  });

  test('pide nombre y celular temprano y lleva lo que busca, aunque no transfiera', () => {
    for (const p of [ws, ig]) {
      expect(p).toContain('DATOS DEL CLIENTE — PÍDELOS TEMPRANO Y GUÁRDALOS');
      expect(p).toMatch(/llama guardar_contacto/);
      expect(p).toMatch(/recordar_preferencia con el campo interes/);
      expect(p).toMatch(/NO se los vuelvas a pedir/);
    }
    expect(ws).toMatch(/¿Y te puedo contactar a este mismo número/);
    expect(ig).toMatch(/Déjame también un celular/);
  });

  test('si no sabe un dato no lo inventa: lo pasa a un asesor', () => {
    for (const [p, herramienta] of [[ws, 'transferir_asesor'], [ig, 'solicitar_asesor']]) {
      expect(p).toContain('SI NO LO SABES, NO LO INVENTES: PÁSALO A UN ASESOR — REGLA ABSOLUTA');
      expect(p).toMatch(/tiempos de fabricación o de entrega, garantía/);
      expect(p).toContain(`llama ${herramienta} con un motivo que diga exactamente qué hay que confirmarle`);
      expect(p).toMatch(/Nunca respondas "sí" o "claro" a algo que no puedes verificar/);
    }
  });

  test('trae el método de venta completo', () => {
    for (const p of [ws, ig]) {
      expect(p).toContain('PREGUNTA DE ENGANCHE AL FINAL');
      expect(p).toContain('ASESOR HUMANO SIEMPRE A LA MANO');
      expect(p).toContain('NO DEJES IR AL CLIENTE TAN FÁCIL');
      expect(p).toContain('MANEJO DE OBJECIONES');
      expect(p).toContain('POR QUÉ DECASA');
    }
  });

  test('pide nombre y celular antes de transferir, con la herramienta de cada canal', () => {
    expect(ws).toMatch(/Antes de llamar transferir_asesor .*NOMBRE.*CELULAR/s);
    expect(ig).toMatch(/Antes de llamar solicitar_asesor .*NOMBRE.*CELULAR/s);
    expect(ws).toContain('telefono_contacto="este_mismo"');
    expect(ig).not.toContain('este_mismo');
  });

  test('dice el 5 % y no promete más', () => {
    expect(ws).toContain('5% de descuento');
    expect(ws).toMatch(/NUNCA prometas más del 5%/);
    expect(ws).toMatch(/NUNCA calcules tú el valor con descuento/);
  });

  test('sin promesas que no puede cumplir', () => {
    expect(ws).not.toMatch(/te lo aparto/i);
    // "más pedidos" solo puede aparecer como prohibición.
    expect(ws).not.toMatch(/urgencia suave y honesta: "es de los más pedidos"/);
    expect(ws).toMatch(/NUNCA digas que un producto "es de los más pedidos"/);
  });

  test('ningún hueco sin rellenar', () => {
    expect(ws).not.toMatch(/undefined|null%/);
    expect(ig).not.toMatch(/undefined|null%/);
  });
});

describe('aviso por turno para pedir nombre y celular (memoria.notaPedirDatos)', () => {
  const memoria = require('../../memoria');
  const hist = (...m) => m.map(([role, content]) => ({ role, content }));

  test('en el primer mensaje no: primero se atiende', () => {
    expect(memoria.notaPedirDatos({ perfil: null, historial: [] })).toBeNull();
  });
  test('desde el segundo mensaje, si no sabe el nombre, toca pedirlo', () => {
    const nota = memoria.notaPedirDatos({ perfil: null, historial: hist(['user', 'quiero ver camas'], ['assistant', 'Aquí tienes el catálogo']) });
    expect(nota).toMatch(/TODAVÍA NO SABES EL NOMBRE/);
    expect(nota).toMatch(/guardar_contacto/);
  });
  test('no se pide si ya sabe el nombre, si dijo que no o si ya se lo pidió', () => {
    const h = hist(['user', 'hola'], ['assistant', 'Hola']);
    expect(memoria.notaPedirDatos({ perfil: { nombre: 'Ana' }, historial: h })).toBeNull();
    expect(memoria.notaPedirDatos({ perfil: { no_quiso_dar_datos: true }, historial: h })).toBeNull();
    expect(memoria.notaPedirDatos({ perfil: { datos_pedidos: true }, historial: h })).toBeNull();
    expect(memoria.notaPedirDatos({ perfil: null, historial: hist(['user', 'hola'], ['assistant', 'Por cierto, ¿con quién tengo el gusto?']) })).toBeNull();
  });
  test('reconoce cuándo Elena pidió los datos', () => {
    expect(memoria.pidioDatos('¿Con quién tengo el gusto? 😊')).toBe(true);
    expect(memoria.pidioDatos('Te mando fotos de cerca')).toBe(false);
  });
});

describe('repaso final del prompt', () => {
  const ws = construirSystemPrompt('whatsapp');
  test('el prompt termina con el repaso de lo que más se le olvidaba al modelo', () => {
    const repaso = ws.slice(ws.lastIndexOf('ANTES DE ENVIAR CADA RESPUESTA, REVISA'));
    expect(ws.endsWith(repaso)).toBe(true);
    expect(repaso).toMatch(/sin haber llamado la herramienta/);
    expect(repaso).toMatch(/enlace que no me dio una herramienta/);
    expect(repaso).toMatch(/agregar_al_carrito ya/);
    expect(repaso).toMatch(/nunca solo una despedida/);
  });
  test('no hay frases de ejemplo de catálogo que se puedan copiar sin llamar la herramienta', () => {
    expect(ws).not.toMatch(/"¡Claro! Aquí tienes nuestro catálogo/);
    expect(ws).toMatch(/tu PRIMER paso es LLAMAR la herramienta enviar_catalogo/);
  });
});

describe('evaluador: nota por turno y cada caso desde cero', () => {
  const runner = require('../../evaluacion/runner');
  test('la nota llega como mensaje de sistema solo en su turno y no queda en el historial', async () => {
    const vistos = [];
    const openai = { chat: { completions: { create: async ({ messages }) => {
      vistos.push(messages.map(m => m.content));
      return { choices: [{ message: { content: 'ok' } }] };
    } } } };
    await runner.ejecutarCaso({ mensajes: ['a', 'b'] }, {
      openai, modelo: 'x', systemPrompt: 'PROMPT', tools: [], ejecutarHerramienta: async () => ({}),
      notaPorTurno: ({ historial }) => (historial.length ? 'NOTA' : null),
    });
    expect(vistos[0]).toEqual(['PROMPT', 'a']);
    expect(vistos[1]).toEqual(['PROMPT', 'NOTA', 'a', 'ok', 'b']);
  });
  test('alEmpezarCaso se llama una vez por caso', async () => {
    let n = 0;
    const openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } } };
    await runner.evaluarTodos([{ id: '1', mensajes: ['a'] }, { id: '2', mensajes: ['b'] }], {
      openai, modelo: 'x', systemPrompt: 'P', tools: [], ejecutarHerramienta: async () => ({}), alEmpezarCaso: () => { n++; },
    });
    expect(n).toBe(2);
  });
});

describe('revisión antes de enviar (verificacion.js)', () => {
  const { revisarRespuesta } = require('../../verificacion');

  test.each([
    ['¡Claro! Te envío el catálogo de camas.', [], /catálogo/],
    ['Aquí tienes nuestro catálogo de camas 😊', [], /enviar_catalogo/],
    ['Voy a notificar a nuestro equipo de compras sobre tu propuesta.', [], /reportar_proveedor/],
    ['Listo, ya la agregué al carrito 🛒', [], /agregar_al_carrito/],
    ['Ya quedó agendada tu cita para el sábado.', [], /agendar_cita/],
  ])('"%s" sin la herramienta se corrige', (texto, herramientas, esperado) => {
    expect(revisarRespuesta({ texto, herramientas, resultados: [] })).toMatch(esperado);
  });

  test('con la herramienta llamada en el turno, pasa', () => {
    expect(revisarRespuesta({
      texto: 'Aquí tienes nuestro catálogo de camas: https://sistema-de-ventas-olive.vercel.app/catalogo/camas',
      herramientas: ['enviar_catalogo'],
      resultados: [{ exito: true, url: 'https://sistema-de-ventas-olive.vercel.app/catalogo/camas' }],
    })).toBeNull();
    expect(revisarRespuesta({ texto: 'Ya notifiqué al equipo de compras 😊', herramientas: ['reportar_proveedor'] })).toBeNull();
  });

  test('las preguntas son ofrecimientos, no promesas', () => {
    expect(revisarRespuesta({ texto: '¿Te envío el catálogo de camas? ¿O te mando fotos de cerca?', herramientas: [] })).toBeNull();
  });

  test('un enlace que no devolvió ninguna herramienta es inventado', () => {
    const r = revisarRespuesta({ texto: 'Mira: [Catálogo](https://www.decasa.com/catalogo/camas)', herramientas: ['enviar_catalogo'], resultados: [{ url: 'https://sistema-de-ventas-olive.vercel.app/catalogo/camas' }] });
    expect(r).toMatch(/decasa\.com\/catalogo\/camas/);
    expect(r).toMatch(/inventado/);
  });

  test('el evaluador aplica la misma revisión, una vez por turno', async () => {
    const runner = require('../../evaluacion/runner');
    const respuestas = ['Te envío el catálogo de camas.', '¿Las buscas dobles o queen?'];
    const openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content: respuestas.shift() } }] }) } } };
    const turnos = await runner.ejecutarCaso({ mensajes: ['busco una cama'] }, {
      openai, modelo: 'x', systemPrompt: 'P', tools: [], ejecutarHerramienta: async () => ({}), revisarRespuesta,
    });
    expect(turnos[0].respuesta).toBe('¿Las buscas dobles o queen?');
  });
});

describe('nota de venta por categoría', () => {
  test('las bases de comedor traen "las sillas se venden aparte"; otras categorías no', () => {
    expect(negocio.notaDeVenta('bases_comedores')).toMatch(/Sillas se venden por UNIDAD/);
    expect(negocio.notaDeVenta('camas')).toBeNull();
  });
});
