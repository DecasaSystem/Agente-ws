// Las cerraduras de seguridad.js (revisión del 2026-10-08).

const seguridad = require('../../seguridad');

describe('webhook sin firma', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });

  test('en producción NO se acepta sin poder verificar la firma', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PERMITIR_WEBHOOK_SIN_FIRMA;
    expect(seguridad.puedeAceptarSinFirma()).toBe(false);
  });

  test('solo en pruebas o si se pide a propósito para desarrollo', () => {
    process.env.NODE_ENV = 'test';
    expect(seguridad.puedeAceptarSinFirma()).toBe(true);
    process.env.NODE_ENV = 'development';
    process.env.PERMITIR_WEBHOOK_SIN_FIRMA = '1';
    expect(seguridad.puedeAceptarSinFirma()).toBe(true);
  });
});

describe('credenciales de Twilio solo a Twilio', () => {
  test('acepta las URLs de media de Twilio', () => {
    expect(seguridad.esUrlDeTwilio('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1')).toBe(true);
    expect(seguridad.esUrlDeTwilio('https://media.twiliocdn.twilio.com/x')).toBe(true);
  });

  test('rechaza cualquier otra cosa', () => {
    expect(seguridad.esUrlDeTwilio('https://atacante.com/robar')).toBe(false);
    expect(seguridad.esUrlDeTwilio('https://api.twilio.com.atacante.com/x')).toBe(false);
    expect(seguridad.esUrlDeTwilio('http://api.twilio.com/x')).toBe(false);   // sin https
    expect(seguridad.esUrlDeTwilio('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(seguridad.esUrlDeTwilio('no es url')).toBe(false);
  });
});

describe('tokenValido', () => {
  test('solo el token exacto', () => {
    expect(seguridad.tokenValido('abc123', 'abc123')).toBe(true);
    expect(seguridad.tokenValido('abc124', 'abc123')).toBe(false);
    expect(seguridad.tokenValido(undefined, 'abc123')).toBe(false);
  });

  test('sin token configurado, nada pasa', () => {
    expect(seguridad.tokenValido('', '')).toBe(false);
    expect(seguridad.tokenValido('x', undefined)).toBe(false);
  });
});
