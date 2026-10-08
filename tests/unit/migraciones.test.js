// Migraciones con registro de versión.
//
// Lo que se prueba: que cada cambio se aplique UNA sola vez (aunque el servicio reinicie diez
// veces al día), que quede registrado, y que un error real de SQL se note en vez de quedar
// tapado — que es justo lo que pasaba con los `try/catch` silenciosos que había antes.

const migraciones = require('../../migraciones');

// Pool de mentira con una "base de datos" en memoria.
function poolFalso({ fallarEn = null } = {}) {
  const aplicadas = [];
  const consultas = [];
  return {
    _aplicadas: aplicadas,
    _consultas: consultas,
    query: async (sql, params) => {
      consultas.push(sql);
      if (/CREATE TABLE IF NOT EXISTS esquema_migraciones/.test(sql)) return [[]];
      if (/^SELECT id FROM esquema_migraciones/.test(sql)) return [aplicadas.map(id => ({ id }))];
      if (/^SELECT id, aplicada_at FROM esquema_migraciones/.test(sql)) {
        return [aplicadas.map(id => ({ id, aplicada_at: '2026-09-29 10:00:00' }))];
      }
      if (/^INSERT INTO esquema_migraciones/.test(sql)) { aplicadas.push(params[0]); return [{}]; }
      if (fallarEn && sql.includes(fallarEn)) throw new Error('error de sintaxis en SQL');
      return [{}];
    },
  };
}

const silencio = { log: () => {}, error: () => {} };

describe('Aplicación de migraciones', () => {
  test('aplica las pendientes y las registra', async () => {
    const pool = poolFalso();
    const lista = [
      { id: '001-tabla-a', descripcion: 'tabla A', sql: 'CREATE TABLE a (id INT)' },
      { id: '002-tabla-b', descripcion: 'tabla B', sql: 'CREATE TABLE b (id INT)' },
    ];

    const r = await migraciones.aplicar(pool, lista, silencio);

    expect(r.aplicadas).toEqual(['001-tabla-a', '002-tabla-b']);
    expect(r.omitidas).toEqual([]);
    expect(r.fallo).toBeNull();
    expect(pool._aplicadas).toEqual(['001-tabla-a', '002-tabla-b']);
  });

  test('no repite lo ya aplicado: el servicio puede reiniciar mil veces', async () => {
    const pool = poolFalso();
    const lista = [{ id: '001-tabla-a', sql: 'CREATE TABLE a (id INT)' }];

    await migraciones.aplicar(pool, lista, silencio);
    const segunda = await migraciones.aplicar(pool, lista, silencio);

    expect(segunda.aplicadas).toEqual([]);
    expect(segunda.omitidas).toEqual(['001-tabla-a']);
    expect(pool._consultas.filter(s => s === 'CREATE TABLE a (id INT)')).toHaveLength(1);
  });

  test('una migración nueva se aplica sin tocar las anteriores', async () => {
    const pool = poolFalso();
    await migraciones.aplicar(pool, [{ id: '001', sql: 'CREATE TABLE a (id INT)' }], silencio);

    const r = await migraciones.aplicar(pool, [
      { id: '001', sql: 'CREATE TABLE a (id INT)' },
      { id: '002', sql: 'CREATE TABLE b (id INT)' },
    ], silencio);

    expect(r.aplicadas).toEqual(['002']);
    expect(r.omitidas).toEqual(['001']);
  });

  test('un error de SQL se reporta y NO queda registrada como aplicada', async () => {
    const pool = poolFalso({ fallarEn: 'CREATE TABLE mala' });
    const r = await migraciones.aplicar(pool, [{ id: '001-mala', sql: 'CREATE TABLE mala (' }], silencio);

    expect(r.fallo).toMatchObject({ id: '001-mala' });
    expect(r.fallo.error).toContain('error de sintaxis');
    expect(pool._aplicadas).not.toContain('001-mala');
  });

  test('si una falla, no se siguen aplicando las de después', async () => {
    const pool = poolFalso({ fallarEn: 'CREATE TABLE mala' });
    const r = await migraciones.aplicar(pool, [
      { id: '001-buena', sql: 'CREATE TABLE buena (id INT)' },
      { id: '002-mala', sql: 'CREATE TABLE mala (' },
      { id: '003-nunca', sql: 'CREATE TABLE nunca (id INT)' },
    ], silencio);

    expect(r.aplicadas).toEqual(['001-buena']);
    expect(r.fallo.id).toBe('002-mala');
    expect(pool._consultas).not.toContain('CREATE TABLE nunca (id INT)');
  });

  test('acepta migraciones con función, no solo SQL', async () => {
    const pool = poolFalso();
    let ejecutada = false;
    await migraciones.aplicar(pool, [{ id: '001-fn', ejecutar: async () => { ejecutada = true; } }], silencio);
    expect(ejecutada).toBe(true);
    expect(pool._aplicadas).toEqual(['001-fn']);
  });

  test('una lista vacía no rompe nada', async () => {
    const r = await migraciones.aplicar(poolFalso(), [], silencio);
    expect(r).toMatchObject({ aplicadas: [], omitidas: [], fallo: null });
  });
});

describe('Estado del esquema', () => {
  test('dice cuántas hay y cuál fue la última', async () => {
    const pool = poolFalso();
    await migraciones.aplicar(pool, [{ id: '001' }, { id: '002' }].map(m => ({ ...m, sql: 'SELECT 1' })), silencio);

    const estado = await migraciones.estado(pool);

    expect(estado.total).toBe(2);
    expect(estado.ultima.id).toBe('002');
  });

  test('con la base de datos caída informa del error en vez de romper', async () => {
    const pool = { query: async () => { throw new Error('sin conexión'); } };
    const estado = await migraciones.estado(pool);
    expect(estado.total).toBe(0);
    expect(estado.error).toContain('sin conexión');
  });
});
