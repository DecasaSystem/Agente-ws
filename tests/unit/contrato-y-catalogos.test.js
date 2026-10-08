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
