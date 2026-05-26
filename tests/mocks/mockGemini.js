const mockCallGemini = jest.fn();

module.exports = {
  mockCallGemini,
  resetMocks: () => {
    mockCallGemini.mockReset();
  }
};
