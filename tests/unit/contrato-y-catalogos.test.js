// Piezas de core/ que hablan con la BD del sistema de ventas: de dónde salen los
// catálogos (catalogos.js) y la verificación del esquema que lee el agente (contrato-bd.js).

const { leerCatalogos } = require('../../catalogos');
const { verificarContrato, describirFaltantes, CONTRATO } = require('../../contrato-bd');

// Pool falso: responde según la tabla que aparezca en el SQL.
function poolCon(respuestas) {
  return {
    query: jest.fn(async (sql) => {
      for (const [tabla, r] of Object.entries(respuestas)) {
        if (sql.includes(tabla)) {
          if (r instanceof Error) throw r;
          return [r];
        }
      }
      return [[]];
    }),
  };
}

describe('leerCatalogos', () => {
  test('usa herramientas, que es donde se editan, y quita el prefijo', async () => {
    const pool = poolCon({
      herramientas: [{ clave: 'catalogo_sillas', valor: 'https://nuevo/sillas' }],
      configuracion: [{ clave: 'catalogo_sillas', valor: 'https://viejo/sillas' }],
    });
    const r = await leerCatalogos(pool);
    expect(r).toEqual({ fuente: 'herramientas', catalogos: { sillas: 'https://nuevo/sillas' } });
  });

  test('si herramientas no tiene la columna clave (BD vieja), cae a configuracion', async () => {
    const pool = poolCon({
      herramientas: new Error("Unknown column 'clave'"),
      configuracion: [{ clave: 'catalogo_camas', valor: 'https://viejo/camas' }],
    });
    const r = await leerCatalogos(pool);
    expect(r).toEqual({ fuente: 'configuracion', catalogos: { camas: 'https://viejo/camas' } });
  });

  test('si herramientas está vacía, cae a configuracion', async () => {
    const pool = poolCon({
      herramientas: [],
      configuracion: [{ clave: 'catalogo_camas', valor: 'https://viejo/camas' }],
    });
    expect((await leerCatalogos(pool)).fuente).toBe('configuracion');
  });
});

describe('resolverCatalogo: catálogo de Gestión → página del inventario → enlace viejo', () => {
  const { resolverCatalogo, catalogosDisponibles, crearCatalogos, slugSeccion } = require('../../catalogos');
  const opciones = {
    urlBase: 'https://app.decasa',
    mapaCategoriasBD: { comedores: 'bases_comedores' },
    etiquetas: { bases_comedores: 'Comedores', sillas_comedor: 'Sillas de Comedor' },
  };
  const fuentes = {
    herramientas: { sillas_comedor: 'https://pdf/sillas-comedor', sillas_barra: 'https://pdf/barra', camas: 'https://pdf/camas' },
    visuales: [{ nombre: 'Mesas de centro', slug: 'mesas-de-centro' }, { nombre: 'Comedores', slug: 'comedores' }, { nombre: 'Camas', slug: 'camas' }],
    secciones: [{ categoria: 'Cunas', productos: 10 }, { categoria: 'Reloj', productos: 4 }, { categoria: 'Vacía', productos: 0 }],
  };

  test('una categoría sin PDF ni catálogo visual sale con la página del inventario', () => {
    expect(resolverCatalogo('cunas', fuentes, opciones)).toEqual({ url: 'https://app.decasa/catalogo/cunas', fuente: 'inventario', nombre: 'Cunas' });
    // Singular / plural: "relojes" encuentra la sección "Reloj".
    expect(resolverCatalogo('relojes', fuentes, opciones).url).toBe('https://app.decasa/catalogo/reloj');
  });

  test('el catálogo de Gestión le gana al enlace viejo de Herramientas', () => {
    // Hay PDF de camas en Herramientas y catálogo visual de camas: manda el visual.
    expect(resolverCatalogo('camas', fuentes, opciones)).toMatchObject({ fuente: 'visual', url: 'https://app.decasa/c/camas' });
  });

  test('la página del inventario le gana al enlace viejo de Herramientas', () => {
    const conPdfDeCunas = { ...fuentes, herramientas: { ...fuentes.herramientas, cunas: 'https://pdf/cunas-2025' } };
    expect(resolverCatalogo('cunas', conPdfDeCunas, opciones).fuente).toBe('inventario');
  });

  test('el enlace viejo solo sale si no hay nada más, y nunca si está roto', () => {
    expect(resolverCatalogo('sillas_comedor', fuentes, opciones)).toMatchObject({ fuente: 'pdf', url: 'https://pdf/sillas-comedor' });
    expect(resolverCatalogo('sillas_comedor', fuentes, { ...opciones, rotos: new Set(['https://pdf/sillas-comedor']) })).toBeNull();
  });

  test('sin categoría ("el catálogo", "todos") va la portada con todos', () => {
    expect(resolverCatalogo('todos', fuentes, opciones)).toMatchObject({ fuente: 'portada', url: 'https://app.decasa/c' });
    expect(resolverCatalogo('el catálogo', fuentes, opciones).fuente).toBe('portada');
  });

  test('compara por palabras: "mesas_centro" es el catálogo "mesas-de-centro"', () => {
    expect(resolverCatalogo('mesas_centro', fuentes, opciones).url).toBe('https://app.decasa/c/mesas-de-centro');
  });

  test('la clave del agente encuentra el catálogo que en la BD se llama distinto', () => {
    // bases_comedores ↔ "comedores" (mapaCategoriasBD). Antes "comedores" estaba DENTRO de
    // "sillas de comedor" y se mandaba el PDF de sillas a quien pedía la mesa.
    expect(resolverCatalogo('bases_comedores', fuentes, opciones)).toMatchObject({ fuente: 'visual', url: 'https://app.decasa/c/comedores' });
  });

  test('lo ambiguo no se adivina', () => {
    // "sillas" no es "sillas de comedor" ni "sillas de barra": se pregunta.
    expect(resolverCatalogo('sillas', fuentes, opciones)).toBeNull();
    expect(resolverCatalogo('sillas', { herramientas: { sillas_comedor: 'https://pdf/x' } }, opciones)).toBeNull();
  });

  test('una sección sin productos activos no se manda (daría 404)', () => {
    expect(resolverCatalogo('vacia', fuentes, opciones)).toBeNull();
  });

  test('sin la dirección de la app solo quedan los enlaces de Herramientas', () => {
    expect(resolverCatalogo('cunas', fuentes, { ...opciones, urlBase: null })).toBeNull();
    expect(resolverCatalogo('camas', fuentes, { ...opciones, urlBase: null }).fuente).toBe('pdf');
  });

  test('la lista de disponibles sirve para ofrecerle al cliente lo que sí hay', () => {
    const hay = catalogosDisponibles(fuentes, opciones);
    expect(hay).toEqual(expect.arrayContaining(['cunas', 'reloj', 'comedores', 'mesas de centro']));
    expect(hay).not.toContain('vacía');
  });

  test('el enlace del inventario se arma igual que el botón Compartir', () => {
    expect(slugSeccion('Sillas de Comedor')).toBe('sillas-de-comedor');
    expect(slugSeccion('mesas_aux')).toBe('mesas-aux');
  });

  test('crearCatalogos: si la BD falla, conserva la última carga buena', async () => {
    let falla = false;
    const pool = {
      query: jest.fn(async (sql) => {
        if (falla) throw new Error('BD caída');
        if (sql.includes('herramientas')) return [[{ clave: 'catalogo_camas', valor: 'https://pdf/camas' }]];
        if (sql.includes('catalogos c')) return [[{ nombre: 'Bancas', slug: 'bancas' }]];
        if (sql.includes('GROUP BY categoria')) return [[{ categoria: 'Cunas', productos: 10 }]];
        return [[]];
      }),
    };
    const fetchOriginal = global.fetch;
    global.fetch = jest.fn(async () => ({ status: 200 }));
    try {
      const c = crearCatalogos({ pool, opciones, log: { log() {}, warn() {} } });
      await c.cargar();
      expect(c.resolver('cunas').fuente).toBe('inventario');
      falla = true;
      await c.cargar();
      expect(c.resolver('cunas').fuente).toBe('inventario');
      expect(c.resolver('bancas').fuente).toBe('visual');
      expect(c.resolver('camas').fuente).toBe('pdf'); // no hay visual de camas en este caso
    } finally {
      global.fetch = fetchOriginal;
    }
  });
});

describe('revisarEnlaces', () => {
  const { revisarEnlaces } = require('../../catalogos');

  test('solo un 404/410 da el enlace por roto; un fallo de red no', async () => {
    const respuestas = { 'https://a': 404, 'https://b': 200, 'https://c': 405, 'https://d': 410 };
    const fetchImpl = jest.fn(async (url) => {
      if (url === 'https://e') throw new Error('timeout');
      return { status: respuestas[url] };
    });
    const rotos = await revisarEnlaces(['https://a', 'https://b', 'https://c', 'https://d', 'https://e'], { fetchImpl });
    expect([...rotos].sort()).toEqual(['https://a', 'https://d']);
  });
});

describe('verificarContrato', () => {
  const esquemaCompleto = () => {
    const rows = [];
    for (const [tabla, cols] of Object.entries(CONTRATO)) for (const c of cols) rows.push({ tabla, columna: c });
    return rows;
  };

  test('esquema completo: no falta nada (configuracion es opcional)', async () => {
    const pool = poolCon({ INFORMATION_SCHEMA: esquemaCompleto() });
    expect(await verificarContrato(pool)).toEqual({ faltantes: [] });
  });

  test('una columna renombrada en Laravel se reporta', async () => {
    const rows = esquemaCompleto().filter(r => !(r.tabla === 'productos' && r.columna === 'precio_base'));
    const { faltantes } = await verificarContrato(poolCon({ INFORMATION_SCHEMA: rows }));
    expect(faltantes).toEqual([{ tabla: 'productos', columna: 'precio_base' }]);
    expect(describirFaltantes(faltantes)).toBe('productos.precio_base');
  });

  test('una tabla que no existe se reporta como tabla', async () => {
    const rows = esquemaCompleto().filter(r => r.tabla !== 'herramientas');
    const { faltantes } = await verificarContrato(poolCon({ INFORMATION_SCHEMA: rows }));
    expect(describirFaltantes(faltantes)).toBe('tabla herramientas');
  });

  test('si no se puede leer INFORMATION_SCHEMA no lanza: devuelve el error', async () => {
    const r = await verificarContrato(poolCon({ INFORMATION_SCHEMA: new Error('sin permiso') }));
    expect(r).toEqual({ faltantes: [], error: 'sin permiso' });
  });
});

describe('revisión del sistema de ventas: sedes y categorías', () => {
  const { categoriasSinConfigurar, crearRevisionSistema, CONTRATO } = require('../../contrato-bd');

  test('categorías del inventario que negocio.json no conoce', () => {
    const secciones = [
      { categoria: 'camas', productos: 5 }, { categoria: 'comedores', productos: 3 },
      { categoria: 'Electrica', productos: 2 }, { categoria: 'Vacía', productos: 0 },
    ];
    const r = categoriasSinConfigurar(secciones, { categorias: { camas: 'Camas' }, mapaCategoriasBD: { comedores: 'bases_comedores' } });
    expect(r).toEqual(['Electrica']);
  });

  function negocioFalso() {
    const cerradas = new Set();
    return {
      sedes: [{ id: 1, tiendaId: 1 }, { id: 2, tiendaId: 2 }, { id: 5, tiendaId: 5, activa: false }],
      SEDE_NOMBRE: { 1: 'Bolívar', 2: 'El Edén', 5: 'Circunvalar' },
      SEDE_TIENDA_ID: { 1: 1, 2: 2, 5: 5 },
      CATEGORIAS: { camas: 'Camas' }, mapaCategoriasBD: {},
      marcarSedesCerradas: (ids) => { cerradas.clear(); ids.forEach(i => cerradas.add(i)); },
      cerradas,
    };
  }

  function poolCon(tiendas) {
    const esquema = [];
    for (const [tabla, cols] of Object.entries(CONTRATO)) for (const c of cols) esquema.push({ tabla, columna: c });
    return { query: jest.fn(async (sql) => [sql.includes('INFORMATION_SCHEMA') ? esquema : sql.includes('FROM tiendas') ? tiendas : []]) };
  }

  const silencio = { log() {}, warn() {}, error() {} };

  test('una tienda que cerró en el sistema se marca cerrada y se avisa UNA vez', async () => {
    const negocio = negocioFalso();
    const alertar = jest.fn();
    const pool = poolCon([{ id: 1, activa: 1 }, { id: 2, activa: 0 }, { id: 5, activa: 0 }]);
    const revisar = crearRevisionSistema({ pool, negocio, alertar, log: silencio });

    await revisar();
    expect([...negocio.cerradas].sort()).toEqual([2, 5]);
    // Solo la que negocio.json todavía ofrece (El Edén); Circunvalar ya está "activa": false.
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar.mock.calls[0][1]).toMatch(/El Edén/);
    expect(alertar.mock.calls[0][1]).not.toMatch(/Circunvalar/);

    await revisar(); // la hora siguiente, igual: no repite la alerta
    expect(alertar).toHaveBeenCalledTimes(1);
  });

  test('categoría nueva en el inventario: un aviso', async () => {
    const negocio = negocioFalso();
    const alertar = jest.fn();
    const pool = poolCon([{ id: 1, activa: 1 }, { id: 2, activa: 1 }, { id: 5, activa: 0 }]);
    const revisar = crearRevisionSistema({ pool, negocio, alertar, log: silencio, secciones: () => [{ categoria: 'Electrica', productos: 3 }] });
    await revisar();
    expect(alertar).toHaveBeenCalledTimes(1);
    expect(alertar.mock.calls[0][0]).toMatch(/Categorías nuevas/);
  });
});
