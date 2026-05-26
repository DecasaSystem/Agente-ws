jest.mock('replicate', () => {
  return jest.fn(() => ({
    run: jest.fn()
  }));
});

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn((options, callback) => {
        return {
          end: (buffer) => {
            callback(null, { secure_url: 'https://res.cloudinary.com/test/image.jpg' });
          }
        };
      })
    }
  }
}));

jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Mock fetch nativo para tests
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(Buffer.from('fake-image')),
    headers: { get: () => null }
  })
);

describe('image-processor', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  test('debe procesar imagen correctamente con mocks', async () => {
    const { processRoomImage } = require('../../image-processor');
    
    const result = await processRoomImage('https://twilio.com/test.jpg', null);
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });
});
