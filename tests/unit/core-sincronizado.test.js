// Los archivos compartidos con el otro agente se copian desde core/ (ver core/README.md:
// no se importan con require('../core/...') porque cada agente se despliega por separado y
// esa ruta no existe en producción).
//
// El riesgo de copiar no es la copia: es que nadie se entere cuando las dos versiones se
// separan — que es exactamente lo que ya había pasado con los prompts. Este test lo detecta.

const fs   = require('fs');
const path = require('path');

const AGENTE = path.join(__dirname, '../..');
const CORE   = path.join(AGENTE, '../core');

const hayCore = fs.existsSync(CORE);

// En un despliegue aislado (solo la carpeta del agente) core/ no existe: no hay nada que
// comparar y el test se salta en vez de fallar.
const describeSiHayCore = hayCore ? describe : describe.skip;

describeSiHayCore('Archivos compartidos sincronizados con core/', () => {
  const compartidos = hayCore
    ? fs.readdirSync(CORE).filter(f => /\.(js|json)$/.test(f)).sort()
    : [];

  test('core/ tiene los archivos esperados', () => {
    expect(compartidos).toEqual(expect.arrayContaining([
      'fechas.js', 'negocio.js', 'negocio.json', 'prompt.js', 'reintentos.js', 'vision-catalogo.js',
    ]));
  });

  test.each(compartidos)('%s coincide con la copia de core/', archivo => {
    const enCore   = fs.readFileSync(path.join(CORE, archivo), 'utf8');
    const enAgente = fs.readFileSync(path.join(AGENTE, archivo), 'utf8');

    if (enCore !== enAgente) {
      throw new Error(
        `"${archivo}" difiere de core/${archivo}.\n` +
        'Los archivos compartidos se editan en core/ y se copian con:  npm run sync  (desde la raíz del proyecto).\n' +
        'Si el cambio lo hiciste en este agente, muévelo a core/ y vuelve a sincronizar.'
      );
    }
  });
});
