// Pedido del dueño (2026-10-30): (1) la foto adicional de Inventario sirve para que Elena
// reconozca el mueble que manda el cliente, no solo para mandarla; (2) cada hoja del
// catálogo tiene nombre en Gestión para que Elena sepa qué hoja manda y mande solo esa.

const fotos = require('../../fotos-producto');
const { resolverHoja, hojasDelCatalogo, leerOtrasFuentes } = require('../../catalogos');
const vc = require('../../vision-catalogo');

describe('fotos-producto', () => {
  test('indexa las dos fotos y la segunda vuelve al nombre del producto', () => {
    const lista = fotos.fotosParaIndexar([
      { nombre: 'CAMA BALI', imagen: 'a.jpg', imagen2: 'b.jpg' },
      { nombre: 'SOFA ROMA', imagen: 'c.jpg', imagen2: 'c.jpg' }, // la misma: una sola
      { nombre: 'MESA', imagen: 'd.jpg', imagen2: null },
    ]);
    expect(lista.map(f => f.imagen)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    expect(fotos.nombreDeClave(lista[1].clave)).toBe('CAMA BALI');
    expect(fotos.nombreDeClave('CAMA BALI')).toBe('CAMA BALI');
  });

  test('un nombre que con el sufijo no cabe en la columna se queda con la primera foto', () => {
    const largo = 'X'.repeat(148);
    expect(fotos.fotosParaIndexar([{ nombre: largo, imagen: 'a.jpg', imagen2: 'b.jpg' }])).toHaveLength(1);
  });
});

describe('vision: la foto adicional va con el mismo número', () => {
  test('manda las dos miniaturas y la coincidencia es del producto', async () => {
    let pedido;
    const openai = { chat: { completions: { create: jest.fn(async (req) => {
      pedido = req;
      return { usage: {}, choices: [{ message: { content: JSON.stringify({ coincidencias: [{ indice: 1, similitud: 92, razon: 'mismo respaldo' }] }) } }] };
    }) } } };
    const { coincidencias } = await vc.compararConCategoria(openai, { base64: 'AAA', mime: 'image/jpeg' }, [
      { nombre: 'CAMA BALI', imagen: 'https://res.cloudinary.com/d/image/upload/a.jpg', imagen2: 'https://res.cloudinary.com/d/image/upload/b.jpg' },
    ]);
    const imagenes = pedido.messages[1].content.filter(c => c.type === 'image_url');
    expect(imagenes).toHaveLength(3); // la del cliente + las dos del producto
    expect(coincidencias[0].nombre).toBe('CAMA BALI');
  });
});

describe('hojas del catálogo', () => {
  const fuentes = {
    hojas: [
      { id: 5, nombre: 'Camas Bali y Roma', slug: 'camas', catalogo: 'Camas', imagen: 'https://res.cloudinary.com/d/image/upload/v1/p5.jpg' },
      { id: 6, nombre: 'Camas Roma', slug: 'camas', catalogo: 'Camas', imagen: null },
      { id: 9, nombre: 'Sofá Bali', slug: 'sofas', catalogo: 'Sofás', imagen: null },
    ],
  };
  const opciones = { urlBase: 'https://app.test/' };

  test('basta con que las palabras pedidas estén en el nombre', () => {
    const r = resolverHoja('la bali', fuentes, opciones, 'camas');
    expect(r.hoja.url).toBe('https://app.test/c/camas?hoja=5');
    expect(r.hoja.nombre).toBe('Camas Bali y Roma');
    // Imagen liviana para el chat.
    expect(r.hoja.imagen).toContain('/image/upload/f_jpg,q_auto,w_1600,c_limit/');
  });

  test('con varias, gana la de las mismas palabras; si no hay, pregunta', () => {
    expect(resolverHoja('camas roma', fuentes, opciones).hoja.nombre).toBe('Camas Roma');
    expect(resolverHoja('bali', fuentes, opciones).opciones).toEqual(['Camas Bali y Roma', 'Sofá Bali']);
  });

  test('busca primero en el catálogo que se manda, y si no está, en todos', () => {
    expect(resolverHoja('bali', fuentes, opciones, 'sofas').hoja.nombre).toBe('Sofá Bali');
    expect(resolverHoja('sofa bali', fuentes, opciones, 'camas').hoja.nombre).toBe('Sofá Bali');
  });

  test('lo que no está no se inventa', () => {
    expect(resolverHoja('nevera', fuentes, opciones)).toBeNull();
    expect(resolverHoja('bali', fuentes, {})).toBeNull(); // sin urlBase no hay enlace
  });

  test('hojasDelCatalogo da solo las de ese catálogo', () => {
    expect(hojasDelCatalogo(fuentes, 'camas')).toEqual(['Camas Bali y Roma', 'Camas Roma']);
  });

  test('sin la columna nombre en la base, no hay hojas y lo demás sigue', async () => {
    const pool = { query: jest.fn(async (sql) => {
      if (sql.includes('p.nombre')) throw new Error("Unknown column 'p.nombre'");
      if (sql.includes('FROM catalogos')) return [[{ nombre: 'Camas', slug: 'camas' }]];
      return [[]];
    }) };
    const f = await leerOtrasFuentes(pool);
    expect(f.visuales).toEqual([{ nombre: 'Camas', slug: 'camas' }]);
    expect(f.hojas).toBeUndefined();
  });
});

// La búsqueda dice en qué hoja está cada producto, para ofrecer esa hoja (2026-10-30).
describe('hojaDelProducto: en qué hoja del catálogo está un producto', () => {
  const { hojaDelProducto } = require('../../catalogos');
  const etiquetas = { camas: 'Camas', sofas: 'Sofás', sofas_modulares: 'Sofás Modulares' };
  const hojas = [
    { nombre: 'Camas Bali y Roma', catalogo: 'Camas' },
    { nombre: 'Sofá Confort y Modular Terra', catalogo: 'Sofas y modulares' },
    { nombre: 'Sofacama Roma', catalogo: 'Sofa camas' },
    { nombre: 'Torello', catalogo: 'Sofas y modulares' },
  ];
  const hoja = n => hojaDelProducto(n, { hojas }, { etiquetas })?.nombre ?? null;

  test('por las palabras propias del producto, sin importar las genéricas ni la medida', () => {
    expect(hoja('CAMA BALI')).toBe('Camas Bali y Roma');
    expect(hoja('CAMA BALI 1.40')).toBe('Camas Bali y Roma');
    expect(hoja('MODULAR TERRA')).toBe('Sofá Confort y Modular Terra');
    expect(hoja('SOFA TORELLO')).toBe('Torello');
  });

  test('si dos hojas comparten el nombre, gana la que encaja completa', () => {
    expect(hoja('CAMA ROMA')).toBe('Camas Bali y Roma');
    expect(hoja('SOFACAMA ROMA')).toBe('Sofacama Roma');
  });

  test('sin hoja, o solo con palabras genéricas, no adivina', () => {
    expect(hoja('CAMA MIAMI')).toBeNull();
    expect(hoja('CAMA DOBLE')).toBeNull();
    expect(hojaDelProducto('CAMA BALI', {}, { etiquetas })).toBeNull();
  });
});
