// tests/middleware.test.js
// Middleware tests

const request = require('supertest');
const express = require('express');

describe('Middleware', () => {
  
  describe('ValidationMiddleware', () => {
    const ValidationMiddleware = require('../middleware/validation');
    let app;
    
    beforeEach(() => {
      app = express();
      app.use(express.json());
    });
    
    describe('handleValidationErrors', () => {
      it('should pass through when no validation errors', () => {
        app.post('/test', ValidationMiddleware.handleValidationErrors, (req, res) => {
          res.json({ success: true });
        });
        
        return request(app)
          .post('/test')
          .send({})
          .expect(200)
          .expect({ success: true });
      });
    });
    
    describe('sanitizeHtml', () => {
      it('should remove script tags', () => {
        const maliciousHtml = '<script>alert("xss")</script><p>Safe content</p>';
        const sanitized = ValidationMiddleware.sanitizeHtml(maliciousHtml);
        
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).toContain('Safe content');
      });
      
      it('should remove event handlers', () => {
        const maliciousHtml = '<div onclick="malicious()">Content</div>';
        const sanitized = ValidationMiddleware.sanitizeHtml(maliciousHtml);
        
        expect(sanitized).not.toContain('onclick');
        expect(sanitized).toContain('Content');
      });
      
      it('should remove javascript URLs', () => {
        const maliciousHtml = '<a href="javascript:void(0)">Link</a>';
        const sanitized = ValidationMiddleware.sanitizeHtml(maliciousHtml);
        
        expect(sanitized).not.toContain('javascript:');
      });
      
      it('should handle empty input', () => {
        expect(ValidationMiddleware.sanitizeHtml('')).toBe('');
        expect(ValidationMiddleware.sanitizeHtml(null)).toBe('');
        expect(ValidationMiddleware.sanitizeHtml(undefined)).toBe('');
      });
    });
    
    describe('validateFileUpload', () => {
      it('should validate file size', async () => {
        const middleware = ValidationMiddleware.validateFileUpload({ maxSize: 1000 });
        
        app.post('/test', middleware, (req, res) => {
          res.json({ success: true });
        });
        
        const req = {
          file: {
            size: 2000, // Exceeds limit
            originalname: 'test.txt',
            mimetype: 'text/plain'
          }
        };
        
        // Mock the middleware behavior
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();
        
        await middleware(req, mockRes, mockNext);
        
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 'FILE_TOO_LARGE'
            })
          })
        );
      });
      
      it('should validate file type', async () => {
        const middleware = ValidationMiddleware.validateFileUpload({
          allowedTypes: ['text/plain']
        });
        
        const req = {
          file: {
            size: 1000,
            originalname: 'test.exe',
            mimetype: 'application/x-executable'
          }
        };
        
        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn()
        };
        const mockNext = jest.fn();
        
        await middleware(req, mockRes, mockNext);
        
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code: 'INVALID_FILE_TYPE'
            })
          })
        );
      });
    });
  });
  
  describe('ErrorHandler', () => {
    const ErrorHandler = require('../middleware/errorHandler');
    
    describe('categorizeError', () => {
      it('should categorize database unique violation', () => {
        const error = new Error('Duplicate entry');
        error.code = '23505';
        
        const result = ErrorHandler.categorizeError(error);
        
        expect(result.status).toBe(409);
        expect(result.code).toBe('DUPLICATE_ENTRY');
      });
      
      it('should categorize JWT errors', () => {
        const error = new Error('Invalid token');
        error.name = 'JsonWebTokenError';
        
        const result = ErrorHandler.categorizeError(error);
        
        expect(result.status).toBe(401);
        expect(result.code).toBe('INVALID_TOKEN');
      });
      
      it('should categorize token expired errors', () => {
        const error = new Error('Token expired');
        error.name = 'TokenExpiredError';
        
        const result = ErrorHandler.categorizeError(error);
        
        expect(result.status).toBe(401);
        expect(result.code).toBe('TOKEN_EXPIRED');
      });
      
      it('should categorize file upload errors', () => {
        const error = new Error('File too large');
        error.code = 'LIMIT_FILE_SIZE';
        
        const result = ErrorHandler.categorizeError(error);
        
        expect(result.status).toBe(400);
        expect(result.code).toBe('FILE_TOO_LARGE');
      });
      
      it('should categorize custom application errors', () => {
        const error = new Error('Insufficient tokens');
        
        const result = ErrorHandler.categorizeError(error);
        
        expect(result.status).toBe(402);
        expect(result.code).toBe('INSUFFICIENT_TOKENS');
      });
      
      it('should handle unknown errors', () => {
        const error = new Error('Unknown error');
        
        const result = ErrorHandler.categorizeError(error, true); // Development mode
        
        expect(result.status).toBe(500);
        expect(result.code).toBe('INTERNAL_SERVER_ERROR');
        expect(result.message).toBe('Unknown error');
      });
      
      it('should hide error details in production', () => {
        const error = new Error('Internal error details');
        
        const result = ErrorHandler.categorizeError(error, false); // Production mode
        
        expect(result.status).toBe(500);
        expect(result.code).toBe('INTERNAL_SERVER_ERROR');
        expect(result.message).toBe('An unexpected error occurred');
      });
    });
    
    describe('createError', () => {
      it('should create custom error with status code', () => {
        const error = ErrorHandler.createError('Custom error', 422, 'CUSTOM_CODE');
        
        expect(error.message).toBe('Custom error');
        expect(error.statusCode).toBe(422);
        expect(error.code).toBe('CUSTOM_CODE');
      });
      
      it('should use default values', () => {
        const error = ErrorHandler.createError('Simple error');
        
        expect(error.message).toBe('Simple error');
        expect(error.statusCode).toBe(500);
        expect(error.code).toBe('CUSTOM_ERROR');
      });
    });
    
    describe('validateEnvironment', () => {
      const originalEnv = process.env;
      
      beforeEach(() => {
        process.env = { ...originalEnv };
      });
      
      afterEach(() => {
        process.env = originalEnv;
      });
      
      it('should validate when all required variables are present', () => {
        process.env.DB_HOST = 'localhost';
        process.env.DB_NAME = 'test_db';
        process.env.DB_USER = 'test_user';
        process.env.DB_PASSWORD = 'test_password';
        process.env.JWT_SECRET = 'test-jwt-secret-32-characters-long';
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        
        const isValid = ErrorHandler.validateEnvironment();
        expect(isValid).toBe(true);
      });
      
      it('should fail when required variables are missing', () => {
        delete process.env.DB_HOST;
        
        const isValid = ErrorHandler.validateEnvironment();
        expect(isValid).toBe(false);
      });
    });
    
    describe('asyncHandler', () => {
      it('should handle successful async operations', async () => {
        const asyncFn = jest.fn().mockResolvedValue('success');
        const wrappedFn = ErrorHandler.asyncHandler(asyncFn);
        
        const mockReq = {};
        const mockRes = {};
        const mockNext = jest.fn();
        
        await wrappedFn(mockReq, mockRes, mockNext);
        
        expect(asyncFn).toHaveBeenCalledWith(mockReq, mockRes, mockNext);
        expect(mockNext).not.toHaveBeenCalled();
      });
      
      it('should handle async errors', async () => {
        const error = new Error('Async error');
        const asyncFn = jest.fn().mockRejectedValue(error);
        const wrappedFn = ErrorHandler.asyncHandler(asyncFn);
        
        const mockReq = {};
        const mockRes = {};
        const mockNext = jest.fn();
        
        await wrappedFn(mockReq, mockRes, mockNext);
        
        expect(mockNext).toHaveBeenCalledWith(error);
      });
    });
  });
  
  describe('Auth Middleware', () => {
    const { generateToken, verifyToken, validateJWTConfig } = require('../middleware/auth');
    const jwt = require('jsonwebtoken');
    
    describe('generateToken', () => {
      it('should generate valid JWT token', () => {
        const user = { id: 'user-id', email: 'test@example.com' };
        const token = generateToken(user);
        
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        
        // Verify token structure
        const decoded = jwt.decode(token);
        expect(decoded.userId).toBe('user-id');
        expect(decoded.email).toBe('test@example.com');
        expect(decoded.iss).toBe('resume-tailor-backend');
      });
    });
    
    describe('verifyToken', () => {
      it('should verify valid token', () => {
        const user = { id: 'user-id', email: 'test@example.com' };
        const token = generateToken(user);
        
        const decoded = verifyToken(token);
        expect(decoded.userId).toBe('user-id');
        expect(decoded.email).toBe('test@example.com');
      });
      
      it('should throw error for invalid token', () => {
        expect(() => verifyToken('invalid-token')).toThrow('Invalid token');
      });
      
      it('should throw error for expired token', () => {
        const expiredToken = jwt.sign(
          { userId: 'user-id' },
          process.env.JWT_SECRET,
          { expiresIn: '-1h' } // Expired 1 hour ago
        );
        
        expect(() => verifyToken(expiredToken)).toThrow('Token expired');
      });
    });
    
    describe('validateJWTConfig', () => {
      const originalEnv = process.env;
      
      beforeEach(() => {
        process.env = { ...originalEnv };
      });
      
      afterEach(() => {
        process.env = originalEnv;
      });
      
      it('should validate when JWT_SECRET is present', () => {
        process.env.JWT_SECRET = 'test-jwt-secret';
        
        const isValid = validateJWTConfig();
        expect(isValid).toBe(true);
      });
      
      it('should fail when JWT_SECRET is missing', () => {
        delete process.env.JWT_SECRET;
        
        const isValid = validateJWTConfig();
        expect(isValid).toBe(false);
      });
    });
  });
});