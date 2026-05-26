const mockMessagesCreate = jest.fn();

const twilio = jest.fn(() => ({
  messages: {
    create: mockMessagesCreate
  }
}));

module.exports = {
  twilio,
  mockMessagesCreate,
  resetMocks: () => {
    mockMessagesCreate.mockReset();
    twilio.mockReset();
  }
};
