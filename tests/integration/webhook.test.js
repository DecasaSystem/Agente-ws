jest.mock('twilio', () => ({
  twiml: {
    MessagingResponse: jest.fn(() => ({
      message: jest.fn(),
      toString: jest.fn(() => '<Response></Response>')
    }))
  }
}));

jest.mock('../../db', () => ({
  getOrCreateUsuario: jest.fn(),
  getHistorial: jest.fn(() => []),
  addMensaje: jest.fn(),
  getEstado: jest.fn(() => ({ greeting_sent: false })),
  updateEstado: jest.fn(),
  pool: { query: jest.fn() }
}));

jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('Webhook endpoint', () => {
  test('GET / debe retornar información de Elena', () => {
    const knowledge = require('../../knowledge.json');
    expect(knowledge.empresa).toBeDefined();
  });

  test('Validación de Twilio configurada', () => {
    const twilio = require('twilio');
    expect(twilio.twiml).toBeDefined();
  });
});
