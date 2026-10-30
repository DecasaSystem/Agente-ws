// Reportado por el dueño (2026-10-30): antes de mandar las fotos, Elena escribía los enlaces
// de Cloudinary en el texto. El cliente podía abrirlos sin darse cuenta de que las fotos
// ya venían. El modelo ya no ve esas URLs y, si se cuela una, se quita del texto.

const { sinCamposInternos, quitarEnlacesDeImagenes } = require('../../verificacion');

describe('sinCamposInternos: el modelo no ve las URLs de las fotos', () => {
  test('quita los campos que empiezan por "_", también anidados', () => {
    const r = { exito: true, nombre: 'CAMA BALI', _imagenUrl: 'https://res.cloudinary.com/x/a.jpg', _imagen2Url: null, extra: { _interno: 1, visible: 2 } };
    expect(JSON.parse(JSON.stringify(r, sinCamposInternos))).toEqual({ exito: true, nombre: 'CAMA BALI', extra: { visible: 2 } });
  });
});

describe('quitarEnlacesDeImagenes', () => {
  test('quita los enlaces de fotos y las líneas que solo eran eso', () => {
    const texto = [
      '¡Claro! Aquí está la Cama Bali 😍',
      'https://res.cloudinary.com/dj5/image/upload/v1/bali.jpg',
      'Foto: https://res.cloudinary.com/dj5/image/upload/v1/bali2.png',
      '📸 Cama Bali: https://res.cloudinary.com/x/image/upload/b.jpg',
      'Precio: $2.880.000 (ver https://res.cloudinary.com/x/image/upload/a.webp).',
      '¿Te gusta?',
    ].join('\n');
    expect(quitarEnlacesDeImagenes(texto)).toBe('¡Claro! Aquí está la Cama Bali 😍\nPrecio: $2.880.000.\n¿Te gusta?');
  });

  test('una foto de otro sitio (.jpg) también sale', () => {
    expect(quitarEnlacesDeImagenes('Mírala aquí: https://ejemplo.com/fotos/sofa.jpg?v=2')).toBe('');
  });

  test('los enlaces de catálogos y páginas se quedan', () => {
    const texto = 'Aquí tienes el catálogo 📖\nhttps://sistema-de-ventas-olive.vercel.app/c/camas?hoja=12';
    expect(quitarEnlacesDeImagenes(texto)).toBe(texto);
  });

  test('sin enlaces, el texto no cambia', () => {
    const texto = 'Hola 😊\n\n¿Qué mueble buscas?';
    expect(quitarEnlacesDeImagenes(texto)).toBe(texto);
  });
});
