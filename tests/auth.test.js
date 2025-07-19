// tests/auth.test.js
// Authentication system tests

const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock the database and repositories
jest.mock('../repositories/UserRepository', () => ({
  createUser: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  verifyPassword: jest.fn(),
  updateTokenBalance: jest.fn(),
  deductTokens: jest.fn(),
  addTokens: jest.fn()
}));

const UserRepository = require('../repositories/UserRepository');

describe('Authentication System', () => {
  let app;
  
  beforeAll(async () => {
    // Import app after mocks are set up
    const server = require('../server');
    app = server;
  });
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('POST /auth/register', () => {
    it('should register a new user with valid data', async () => {
      const userData = {
        id: 'new-user-id',
        email: 'newuser@example.com',
        tokens: 5,
        created_at: new Date()
      };
      
      UserRepository.findByEmail.mockResolvedValue(null);
      UserRepository.createUser.mockResolvedValue(userData);
      
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'SecurePass123'
        });
      
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('message', 'User registered successfully');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('newuser@example.com');
      
      expect(UserRepository.findByEmail).toHaveBeenCalledWith('newuser@example.com');
      expect(UserRepository.createUser).toHaveBeenCalledWith('newuser@example.com', 'SecurePass123');
    });
    
    it('should reject registration with invalid email', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123'
        });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
    
    it('should reject registration with weak password', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'test@example.com',
          password: 'weak'
        });
      
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
    
    it('should reject registration with existing email', async () => {
      UserRepository.findByEmail.mockResolvedValue({ id: 'existing-user' });
      
      const response = await request(app)
        .post('/auth/register')
        .send({
          email: 'existing@example.com',
          password: 'SecurePass123'
        });
      
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('USER_EXISTS');
    });
  });
  
  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const userData = {
        id: 'user-id',
        email: 'test@example.com',
        tokens: 5
      };
      
      UserRepository.verifyPassword.mockResolvedValue(userData);
      
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123'
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Login successful');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@example.com');
    });
    
    it('should reject login with invalid credentials', async () => {
      UserRepository.verifyPassword.mockResolvedValue(null);
      
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword'
        });
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });
    
    it('should reject login with invalid email format', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123'
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
  
  describe('GET /auth/profile', () => {
    it('should return user profile with valid token', async () => {
      const userData = {
        id: 'user-id',
        email: 'test@example.com',
        tokens: 5,
        created_at: new Date(),
        updated_at: new Date()
      };
      
      UserRepository.findById.mockResolvedValue(userData);
      
      const token = global.testUtils.createTestToken();
      
      const response = await request(app)
        .get('/auth/profile')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe('test@example.com');
    });
    
    it('should reject request without token', async () => {
      const response = await request(app)
        .get('/auth/profile');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });
    
    it('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/auth/profile')
        .set('Authorization', 'Bearer invalid-token');
      
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });
  });
  
  describe('POST /auth/refresh', () => {
    it('should refresh token with valid authentication', async () => {
      const userData = {
        id: 'user-id',
        email: 'test@example.com',
        tokens: 5
      };
      
      UserRepository.findById.mockResolvedValue(userData);
      
      const token = global.testUtils.createTestToken();
      
      const response = await request(app)
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Token refreshed successfully');
      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('expiresIn');
    });
  });
  
  describe('JWT Token Validation', () => {
    it('should create valid JWT tokens', () => {
      const userData = { id: 'user-id', email: 'test@example.com' };
      const { generateToken } = require('../middleware/auth');
      
      const token = generateToken(userData);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId).toBe('user-id');
      expect(decoded.email).toBe('test@example.com');
    });
    
    it('should validate JWT configuration', () => {
      const { validateJWTConfig } = require('../middleware/auth');
      
      const isValid = validateJWTConfig();
      expect(isValid).toBe(true);
    });
  });
});