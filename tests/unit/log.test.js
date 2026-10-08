// Logs con contexto de conversación.
//
// El objetivo es poder reconstruir qué pasó con un cliente concreto cuando se están
// atendiendo varios a la vez. Lo que se prueba aquí es que el contexto se propague de verdad
// por las llamadas asíncronas (que es lo que se rompe fácil) y que no se mezcle entre
// clientes.

const log = require('../../log');

function capturar(fn) {
  const lineas = [];
  const originales = { log: console.log, error: console.error };
  console.log = (...a) => lineas.push(a.join(' '));
  console.error = (...a) => lineas.push(a.join(' '));
  try { return { resultado: fn(), lineas }; }
  finally { console.log = originales.log; console.error = originales.error; }
}

const sinFormatoJSON = () => { delete process.env.LOG_FORMATO; };

beforeEach(sinFormatoJSON);
afterEach(sinFormatoJSON);

describe('Contexto del turno', () => {
  test('cada línea lleva el turno, el canal y el cliente', async () => {
    const { lineas } = capturar(() => log.conContexto({ canal: 'whatsapp', cliente: '+573001' }, () => {
      log.info('mensaje_recibido', { texto: 'hola' });
    }));

    expect(lineas[0]).toMatch(/\[[0-9a-f]{6} whatsapp \+573001\]/);
    expect(lineas[0]).toContain('mensaje_recibido');
    expect(lineas[0]).toContain('texto=hola');
  });

  test('el contexto sobrevive a las llamadas asíncronas', async () => {
    const lineas = [];
    const original = console.log;
    console.log = (...a) => lineas.push(a.join(' '));
    try {
      await log.conContexto({ canal: 'whatsapp', cliente: '+573001' }, async () => {
        await new Promise(r => setTimeout(r, 5));
        await Promise.resolve();
        log.info('despues_de_await');
      });
    } finally { console.log = original; }

    // Si el contexto se perdiera por el await, la línea saldría sin cabecera
    expect(lineas[0]).toContain('whatsapp +573001');
  });

  test('dos clientes atendidos a la vez no se mezclan', async () => {
    const lineas = [];
    const original = console.log;
    console.log = (...a) => lineas.push(a.join(' '));
    try {
      await Promise.all([
        log.conContexto({ canal: 'whatsapp', cliente: 'ana' }, async () => {
          await new Promise(r => setTimeout(r, 10));
          log.info('turno_ana');
        }),
        log.conContexto({ canal: 'instagram', cliente: 'luis' }, async () => {
          await new Promise(r => setTimeout(r, 5));
          log.info('turno_luis');
        }),
      ]);
    } finally { console.log = original; }

    const deAna = lineas.find(l => l.includes('turno_ana'));
    const deLuis = lineas.find(l => l.includes('turno_luis'));
    expect(deAna).toContain('ana');
    expect(deAna).not.toContain('luis');
    expect(deLuis).toContain('luis');
    expect(deLuis).not.toContain('ana');
  });

  test('cada turno tiene su propio id', () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      log.conContexto({ cliente: 'x' }, () => ids.push(log.contextoActual().turno));
    }
    expect(new Set(ids).size).toBe(5);
  });

  test('fuera de un contexto no falla, solo no hay cabecera', () => {
    const { lineas } = capturar(() => log.info('evento_suelto', { dato: 1 }));
    expect(lineas[0]).toBe('evento_suelto dato=1');
  });

  test('se pueden añadir datos al contexto en curso', () => {
    const { lineas } = capturar(() => log.conContexto({ cliente: 'ana' }, () => {
      log.anotar({ canal: 'whatsapp' });
      log.info('con_canal');
    }));
    expect(lineas[0]).toContain('whatsapp');
  });
});

describe('Formato JSON', () => {
  test('con LOG_FORMATO=json cada línea es un objeto parseable', () => {
    process.env.LOG_FORMATO = 'json';
    const { lineas } = capturar(() => log.conContexto({ canal: 'whatsapp', cliente: '+573001' }, () => {
      log.info('respuesta', { ms: 1200 });
    }));

    const objeto = JSON.parse(lineas[0]);
    expect(objeto).toMatchObject({ nivel: 'info', evento: 'respuesta', canal: 'whatsapp', cliente: '+573001', ms: 1200 });
    expect(objeto.turno).toMatch(/^[0-9a-f]{6}$/);
    expect(Date.parse(objeto.ts)).not.toBeNaN();
  });
});

describe('Medición de tiempos', () => {
  test('registra cuánto tardó y devuelve el resultado', async () => {
    const lineas = [];
    const original = console.log;
    console.log = (...a) => lineas.push(a.join(' '));
    let valor;
    try {
      valor = await log.medir('llamada_modelo', async () => { await new Promise(r => setTimeout(r, 5)); return 42; });
    } finally { console.log = original; }

    expect(valor).toBe(42);
    expect(lineas[0]).toContain('llamada_modelo');
    expect(lineas[0]).toMatch(/ms=\d+/);
  });

  test('si falla, lo registra como fallo y propaga el error', async () => {
    const lineas = [];
    const original = console.error;
    console.error = (...a) => lineas.push(a.join(' '));
    try {
      await expect(log.medir('llamada_modelo', async () => { throw new Error('OpenAI caído'); })).rejects.toThrow('OpenAI caído');
    } finally { console.error = original; }

    expect(lineas[0]).toContain('llamada_modelo_fallo');
    expect(lineas[0]).toContain('OpenAI caído');
  });
});
