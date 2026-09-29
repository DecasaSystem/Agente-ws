// Identificación visual por categoría: clasificar el mueble y comparar SOLO con las
// fotos de esa categoría. El cliente de OpenAI se simula: aquí se prueba la lógica de
// orquestación, umbrales, lotes y el contexto que recibe Elena — no el modelo.

const vc = require('../../vision-catalogo');

const IMAGEN = { base64: 'AAAA', mime: 'image/jpeg' };
const CATEGORIAS = [
  { clave: 'bases_comedores', nombre: 'Comedores' },
  { clave: 'sillas_comedor',  nombre: 'Sillas de Comedor' },
  { clave: 'sofas',           nombre: 'Sofás' },
];
const INVENTARIO = [
  { nombre: 'BASE ABANICA',   imagen: 'https://res.cloudinary.com/x/image/upload/v1/abanica.png', medidas: 'Diametro 120 (4 Puestos)', material: 'Chapilla', precio: '$2.180.000', categoria: 'bases_comedores' },
  { nombre: 'BASE 2K',        imagen: 'https://res.cloudinary.com/x/image/upload/v1/2k.png',      medidas: '1.20 x 0.90 (4 Puestos)', material: 'Madera',   precio: '$1.480.000', categoria: 'bases_comedores' },
  { nombre: 'BASE SIN FOTO',  imagen: null, medidas: '', material: '', precio: '$1', categoria: 'bases_comedores' },
  { nombre: 'SILLA SELENE',   imagen: 'https://res.cloudinary.com/x/image/upload/v1/selene.png',  medidas: '45x50', material: 'Madera', precio: '$780.000', categoria: 'sillas_comedor' },
  { nombre: 'SOFA ROMA',      imagen: 'https://res.cloudinary.com/x/image/upload/v1/roma.png',    medidas: '2.00', material: 'Tela', precio: '$3.000.000', categoria: 'sofas' },
];

// OpenAI simulado: responde según el nombre del json_schema que se le pide.
function openaiFalso({ clasificacion, comparaciones }) {
  const llamadas = [];
  let nComparacion = 0;
  return {
    llamadas,
    chat: { completions: { create: jest.fn(async (req) => {
      llamadas.push(req);
      const esquema = req.response_format?.json_schema?.name;
      let datos;
      if (esquema === 'clasificacion_imagen') datos = clasificacion;
      else if (esquema === 'comparacion_catalogo') datos = comparaciones[nComparacion++] ?? { coincidencias: [] };
      return { usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ message: { content: JSON.stringify(datos) } }] };
    }) } },
  };
}

const clasifComedor = { es_mueble: true, categorias: ['bases_comedores'], es_captura: true, texto_visible: '', descripcion: 'mesa redonda en pedestal' };

describe('Elección de modelo', () => {
  test('clasificar usa el modelo rápido; comparar usa el grande', async () => {
    const openai = openaiFalso({
      clasificacion: clasifComedor,
      comparaciones: [{ coincidencias: [{ indice: 1, similitud: 90, razon: 'igual' }] }],
    });
    await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });

    // La clasificación es un JSON corto en cada foto que llega: no necesita el modelo caro
    expect(openai.llamadas[0].model).toBe(vc.MODELO_RAPIDO);
    // La comparación visual sí: ahí el detalle importa
    expect(openai.llamadas[1].model).toBe(vc.MODELO);
  });
});

describe('urlMiniatura', () => {
  test('pide a Cloudinary una miniatura jpg de 256px', () => {
    expect(vc.urlMiniatura('https://res.cloudinary.com/x/image/upload/v1/a.png'))
      .toBe('https://res.cloudinary.com/x/image/upload/w_256,h_256,c_fit,q_auto,f_jpg/v1/a.png');
    expect(vc.urlMiniatura('https://otro.com/a.png')).toBe('https://otro.com/a.png');
  });
});

describe('identificarPorVision', () => {
  test('compara SOLO con la categoría clasificada, y solo productos con foto', async () => {
    const openai = openaiFalso({
      clasificacion: clasifComedor,
      comparaciones: [{ coincidencias: [{ indice: 1, similitud: 92, razon: 'misma base en pedestal' }, { indice: 2, similitud: 40, razon: 'patas rectas' }] }],
    });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS, resolverPorNombre: () => null });

    expect(r.tipo).toBe('alta');
    expect(r.producto.nombre).toBe('BASE ABANICA');
    expect(r.coincidencias[0]).toMatchObject({ nombre: 'BASE ABANICA', similitud: 92 });

    // Segunda llamada = comparación: solo las 2 bases con foto, ningún sofá ni silla
    const comparacion = openai.llamadas[1];
    const textos = comparacion.messages[1].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(textos).toContain('#1 BASE ABANICA');
    expect(textos).toContain('#2 BASE 2K');
    expect(textos).not.toContain('SOFA ROMA');
    expect(textos).not.toContain('SILLA SELENE');
    expect(textos).not.toContain('BASE SIN FOTO');
    const imagenes = comparacion.messages[1].content.filter(c => c.type === 'image_url');
    expect(imagenes).toHaveLength(3); // foto del cliente + 2 miniaturas
    expect(imagenes[0].image_url.detail).toBe('high');
    expect(imagenes[1].image_url.detail).toBe('low');
    expect(imagenes[1].image_url.url).toContain('w_256');
    // La clasificación va a baja resolución (barata)
    expect(openai.llamadas[0].messages[1].content[1].image_url.detail).toBe('low');
  });

  test('el texto leído en la captura identifica el producto sin comparar fotos', async () => {
    const openai = openaiFalso({ clasificacion: { ...clasifComedor, texto_visible: 'Base 2K' }, comparaciones: [] });
    const r = await vc.identificarPorVision(openai, IMAGEN, {
      inventarioPlano: INVENTARIO, categorias: CATEGORIAS,
      resolverPorNombre: t => INVENTARIO.find(p => p.nombre.toLowerCase() === t.toLowerCase()) ?? null,
    });
    expect(r.tipo).toBe('nombre');
    expect(r.producto.nombre).toBe('BASE 2K');
    expect(openai.llamadas).toHaveLength(1);
  });

  test('similitud media: no afirma que sea el producto', async () => {
    const openai = openaiFalso({ clasificacion: clasifComedor, comparaciones: [{ coincidencias: [{ indice: 2, similitud: 70, razon: 'forma parecida' }] }] });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });
    expect(r.tipo).toBe('media');
    expect(r.producto).toBeNull();
    const ctx = vc.construirContextoVision(r, p => p.nombre);
    expect(ctx).toContain('PARECIDOS VISUALES');
    expect(ctx).toContain('BASE 2K (parecido 70/100');
    expect(ctx).toContain('NO le preguntes qué tipo de mueble es');
  });

  test('similitud baja: reporta y ofrece fabricación a medida', async () => {
    const openai = openaiFalso({ clasificacion: clasifComedor, comparaciones: [{ coincidencias: [{ indice: 1, similitud: 30, razon: 'solo es una mesa' }] }] });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });
    expect(r.tipo).toBe('baja');
    const ctx = vc.construirContextoVision(r, p => p.nombre);
    expect(ctx).toContain('reportar_imagen_no_identificada');
    expect(ctx).toContain('FABRICAMOS a la medida');
  });

  test('comedor completo: compara en bases Y en sillas y mezcla resultados', async () => {
    const openai = openaiFalso({
      clasificacion: { ...clasifComedor, categorias: ['bases_comedores', 'sillas_comedor'] },
      comparaciones: [
        { coincidencias: [{ indice: 1, similitud: 88, razon: 'base' }] },
        { coincidencias: [{ indice: 1, similitud: 95, razon: 'silla' }] },
      ],
    });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });
    expect(openai.llamadas).toHaveLength(3);
    expect(r.coincidencias.map(c => c.nombre)).toEqual(['SILLA SELENE', 'BASE ABANICA']);
    expect(r.producto.nombre).toBe('SILLA SELENE');
  });

  test('no es un mueble: pide al cliente que aclare', async () => {
    const openai = openaiFalso({ clasificacion: { es_mueble: false, categorias: [], es_captura: false, texto_visible: '', descripcion: 'un perro' }, comparaciones: [] });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });
    expect(r.tipo).toBe('sin_categoria');
    expect(vc.construirContextoVision(r, p => p.nombre)).toContain('qué producto le interesa');
  });

  test('una categoría inválida devuelta por el modelo se ignora', async () => {
    const openai = openaiFalso({ clasificacion: { ...clasifComedor, categorias: ['neveras'] }, comparaciones: [] });
    const r = await vc.identificarPorVision(openai, IMAGEN, { inventarioPlano: INVENTARIO, categorias: CATEGORIAS });
    expect(r.tipo).toBe('sin_categoria');
  });
});

describe('compararConCategoria', () => {
  test('con más de 20 fotos hace tandas y conserva la mejor puntuación por producto', async () => {
    const muchos = Array.from({ length: 25 }, (_, i) => ({ nombre: `BASE ${i + 1}`, imagen: `https://res.cloudinary.com/x/image/upload/v1/${i}.png` }));
    const openai = openaiFalso({
      comparaciones: [
        { coincidencias: [{ indice: 3, similitud: 50, razon: 'a' }] },       // tanda 1: BASE 3
        { coincidencias: [{ indice: 2, similitud: 90, razon: 'b' }, { indice: 99, similitud: 100, razon: 'índice inválido' }] }, // tanda 2: BASE 22
      ],
    });
    const { coincidencias } = await vc.compararConCategoria(openai, IMAGEN, muchos);
    expect(openai.llamadas).toHaveLength(2);
    expect(openai.llamadas[0].messages[1].content.filter(c => c.type === 'image_url')).toHaveLength(21);
    expect(openai.llamadas[1].messages[1].content.filter(c => c.type === 'image_url')).toHaveLength(6);
    expect(coincidencias.map(c => c.nombre)).toEqual(['BASE 22', 'BASE 3']);
  });

  test('sin candidatos con foto no llama al modelo', async () => {
    const openai = openaiFalso({ comparaciones: [] });
    const r = await vc.compararConCategoria(openai, IMAGEN, [{ nombre: 'X', imagen: null }]);
    expect(r.coincidencias).toEqual([]);
    expect(openai.llamadas).toHaveLength(0);
  });
});
