const mockQuery = jest.fn();

const pool = {
  query: mockQuery,
  getConnection: jest.fn(),
  end: jest.fn()
};

module.exports = {
  pool,
  mockQuery,
  resetMocks: () => {
    mockQuery.mockReset();
  }
};
