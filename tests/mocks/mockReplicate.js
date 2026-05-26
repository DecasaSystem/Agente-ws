const mockRun = jest.fn();

const Replicate = jest.fn(() => ({
  run: mockRun
}));

module.exports = {
  Replicate,
  mockRun,
  resetMocks: () => {
    mockRun.mockReset();
    Replicate.mockReset();
  }
};
