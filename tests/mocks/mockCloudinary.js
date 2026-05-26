const mockUploadStream = jest.fn((options, callback) => {
  return {
    end: (buffer) => {
      callback(null, { secure_url: 'https://res.cloudinary.com/test/image.jpg' });
    }
  };
});

const cloudinary = {
  config: jest.fn(),
  uploader: {
    upload_stream: mockUploadStream
  }
};

module.exports = {
  cloudinary,
  mockUploadStream,
  resetMocks: () => {
    mockUploadStream.mockReset();
    cloudinary.config.mockReset();
  }
};
