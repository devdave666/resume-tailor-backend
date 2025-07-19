// tests/setup.js
// Test setup and configuration

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-purposes-only';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'resume_tailor_test';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_test_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.PDF_CO_API_KEY = 'test-pdf-co-key';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Increase timeout for async operations
jest.setTimeout(30000);

// Mock external services by default
jest.mock('../services/AIGenerationService', () => ({
  generateTailoredContent: jest.fn().mockResolvedValue({
    tailoredResume: 'Mock tailored resume content',
    coverLetter: 'Mock cover letter content'
  }),
  validateConfiguration: jest.fn().mockReturnValue(true),
  getStats: jest.fn().mockReturnValue({
    requestCount: 0,
    maxRequestsPerMinute: 60
  })
}));

jest.mock('../services/PaymentService', () => ({
  createCheckoutSession: jest.fn().mockResolvedValue({
    sessionId: 'cs_test_session_id',
    url: 'https://checkout.stripe.com/test',
    package: {
      type: 'starter',
      tokens: 5,
      price: 500,
      name: '5 Resume Tokens - Starter Pack'
    }
  }),
  handleWebhook: jest.fn().mockResolvedValue({
    processed: true,
    userId: 'test-user-id',
    tokensAdded: 5,
    message: 'Tokens added successfully'
  }),
  validateConfiguration: jest.fn().mockReturnValue(true),
  getTokenPackages: jest.fn().mockReturnValue({
    starter: { tokens: 5, price: 500, name: '5 Resume Tokens' }
  })
}));

// Global test utilities
global.testUtils = {
  // Create test user data
  createTestUser: () => ({
    id: 'test-user-id',
    email: 'test@example.com',
    tokens: 5,
    created_at: new Date(),
    updated_at: new Date()
  }),
  
  // Create test file buffer
  createTestFile: (content = 'Test file content', mimetype = 'text/plain') => ({
    buffer: Buffer.from(content),
    originalname: 'test-file.txt',
    mimetype,
    size: Buffer.from(content).length
  }),
  
  // Create test JWT token
  createTestToken: () => {
    const jwt = require('jsonwebtoken');
    return jwt.sign(
      { userId: 'test-user-id', email: 'test@example.com' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  },
  
  // Wait for async operations
  wait: (ms = 100) => new Promise(resolve => setTimeout(resolve, ms))
};