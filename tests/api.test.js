// tests/api.test.js
// API endpoints tests

const request = require('supertest');

// Mock repositories and services
jest.mock('../repositories/UserRepository', () => ({
  findById: jest.fn(),
  deductTokens: jest.fn(),
  addTokens: jest.fn()
}));

jest.mock('../repositories/GenerationRepository', () => ({
  createGeneration: jest.fn(),
  recordApiUsage: jest.fn()
}));

jest.mock('../services/DocumentParsingService', () => ({
  validateFile: jest.fn(),
  parseDocument: jest.fn().mockResolvedValue('Mock parsed document content')
}));

const UserRepository = require('../repositories/UserRepository');
const GenerationRepository = require('../repositories/GenerationRepository');
const DocumentParsingService = require('../services/DocumentParsingService');

describe('API Endpoints', () => {
  let app;
  let authToken;
  
  beforeAll(async () => {
    // Import app after mocks are set up
    const server = require('../server');
    app = server;
    authToken = global.testUtils.createTestToken();
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default user mock
    UserRepository.findById.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      tokens: 5
    });
  });
  
  describe('GET /get-token-balance', () => {
    it('should return user token balance', async () => {
      const response = await request(app)
        .get('/get-token-balance')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('tokens', 5);
      expect(UserRepository.findById).toHaveBeenCalledWith('test-user-id');
    });
    
    it('should require authentication', async () => {
      const response = await request(app)
        .get('/get-token-balance');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
    
    it('should handle user not found', async () => {
      UserRepository.findById.mockResolvedValue(null);
      
      const response = await request(app)
        .get('/get-token-balance')
        .set('Authorization', `Bearer ${authToken}`);
      
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });
  });
  
  describe('POST /quick-generate', () => {
    it('should generate content with valid input', async () => {
      UserRepository.deductTokens.mockResolvedValue(4);
      GenerationRepository.createGeneration.mockResolvedValue({ id: 'gen-id' });
      GenerationRepository.recordApiUsage.mockResolvedValue({ id: 'usage-id' });
      
      const testFile = global.testUtils.createTestFile('Resume content', 'text/plain');
      
      const response = await request(app)
        .post('/quick-generate')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', testFile.buffer, testFile.originalname)
        .field('jobDescription', 'Software Engineer position requiring JavaScript skills');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('tailoredResume');
      expect(response.body).toHaveProperty('coverLetter');
      expect(response.body).toHaveProperty('newTokenBalance', 4);
      
      expect(DocumentParsingService.validateFile).toHaveBeenCalled();
      expect(DocumentParsingService.parseDocument).toHaveBeenCalled();
      expect(UserRepository.deductTokens).toHaveBeenCalledWith('test-user-id', 1);
    });
    
    it('should reject request with insufficient tokens', async () => {
      UserRepository.findById.mockResolvedValue({
        id: 'test-user-id',
        email: 'test@example.com',
        tokens: 0
      });
      
      const testFile = global.testUtils.createTestFile();
      
      const response = await request(app)
        .post('/quick-generate')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', testFile.buffer, testFile.originalname)
        .field('jobDescription', 'Job description');
      
      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe('INSUFFICIENT_TOKENS');
    });
    
    it('should validate job description', async () => {
      const testFile = global.testUtils.createTestFile();
      
      const response = await request(app)
        .post('/quick-generate')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', testFile.buffer, testFile.originalname)
        .field('jobDescription', 'short'); // Too short
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
    
    it('should require file upload', async () => {
      const response = await request(app)
        .post('/quick-generate')
        .set('Authorization', `Bearer ${authToken}`)
        .field('jobDescription', 'Software Engineer position requiring JavaScript skills');
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('FILE_REQUIRED');
    });
  });
  
  describe('POST /generate', () => {
    it('should generate documents with resume and profile', async () => {
      UserRepository.deductTokens.mockResolvedValue(4);
      GenerationRepository.createGeneration.mockResolvedValue({ id: 'gen-id' });
      GenerationRepository.recordApiUsage.mockResolvedValue({ id: 'usage-id' });
      
      const resumeFile = global.testUtils.createTestFile('Resume content', 'text/plain');
      const profileFile = global.testUtils.createTestFile('Profile content', 'text/plain');
      
      const response = await request(app)
        .post('/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', resumeFile.buffer, resumeFile.originalname)
        .attach('profile', profileFile.buffer, profileFile.originalname)
        .field('jobDescription', 'Software Engineer position requiring JavaScript and React skills');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('resumeDocx');
      expect(response.body).toHaveProperty('resumePdf');
      expect(response.body).toHaveProperty('coverLetterDocx');
      expect(response.body).toHaveProperty('coverLetterPdf');
      expect(response.body).toHaveProperty('newTokenBalance', 4);
      
      expect(DocumentParsingService.parseDocument).toHaveBeenCalledTimes(2);
      expect(UserRepository.deductTokens).toHaveBeenCalledWith('test-user-id', 1);
    });
    
    it('should work with resume only', async () => {
      UserRepository.deductTokens.mockResolvedValue(4);
      GenerationRepository.createGeneration.mockResolvedValue({ id: 'gen-id' });
      GenerationRepository.recordApiUsage.mockResolvedValue({ id: 'usage-id' });
      
      const resumeFile = global.testUtils.createTestFile('Resume content', 'text/plain');
      
      const response = await request(app)
        .post('/generate')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('resume', resumeFile.buffer, resumeFile.originalname)
        .field('jobDescription', 'Software Engineer position requiring JavaScript and React skills');
      
      expect(response.status).toBe(200);
      expect(DocumentParsingService.parseDocument).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('POST /extract-job-posting', () => {
    it('should extract job description from HTML', async () => {
      const htmlContent = `
        <html>
          <body>
            <h1>Software Engineer</h1>
            <div>
              <h2>Requirements</h2>
              <ul>
                <li>JavaScript experience</li>
                <li>React knowledge</li>
              </ul>
            </div>
          </body>
        </html>
      `;
      
      const response = await request(app)
        .post('/extract-job-posting')
        .send({
          url: 'https://example.com/job',
          htmlContent
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('jobDescription');
      expect(response.body).toHaveProperty('url', 'https://example.com/job');
      expect(response.body.jobDescription).toContain('Requirements');
    });
    
    it('should validate HTML content', async () => {
      const response = await request(app)
        .post('/extract-job-posting')
        .send({
          htmlContent: 'short' // Too short
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
    
    it('should sanitize HTML content', async () => {
      const maliciousHtml = `
        <script>alert('xss')</script>
        <div onclick="malicious()">Job Description</div>
        <a href="javascript:void(0)">Link</a>
      `;
      
      const response = await request(app)
        .post('/extract-job-posting')
        .send({
          htmlContent: maliciousHtml
        });
      
      expect(response.status).toBe(200);
      expect(response.body.jobDescription).not.toContain('<script>');
      expect(response.body.jobDescription).not.toContain('onclick');
      expect(response.body.jobDescription).not.toContain('javascript:');
    });
  });
  
  describe('Payment Endpoints', () => {
    describe('POST /create-payment-session', () => {
      it('should create payment session', async () => {
        const response = await request(app)
          .post('/create-payment-session')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            packageType: 'starter'
          });
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('sessionId');
        expect(response.body).toHaveProperty('url');
        expect(response.body).toHaveProperty('package');
      });
      
      it('should validate package type', async () => {
        const response = await request(app)
          .post('/create-payment-session')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            packageType: 'invalid'
          });
        
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });
    });
    
    describe('GET /payment/packages', () => {
      it('should return available packages', async () => {
        const response = await request(app)
          .get('/payment/packages');
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('packages');
        expect(response.body.packages).toHaveProperty('starter');
      });
    });
    
    describe('POST /webhook-payment-success', () => {
      it('should handle webhook with valid signature', async () => {
        const webhookBody = JSON.stringify({
          type: 'checkout.session.completed',
          data: { object: { id: 'cs_test' } }
        });
        
        const response = await request(app)
          .post('/webhook-payment-success')
          .set('stripe-signature', 'test-signature')
          .send(webhookBody);
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('received', true);
      });
    });
  });
});