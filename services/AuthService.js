// services/AuthService.js
// Authentication service layer

const { body, validationResult } = require('express-validator');
const UserRepository = require('../repositories/UserRepository');
const { generateToken } = require('../middleware/auth');
const { logger } = require('../config/database');

class AuthService {
    
    // Validation rules for registration
    static getRegistrationValidation() {
        return [
            body('email')
                .isEmail()
                .normalizeEmail()
                .withMessage('Valid email is required'),
            body('password')
                .isLength({ min: 8 })
                .withMessage('Password must be at least 8 characters long')
                .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
                .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
        ];
    }
    
    // Validation rules for login
    static getLoginValidation() {
        return [
            body('email')
                .isEmail()
                .normalizeEmail()
                .withMessage('Valid email is required'),
            body('password')
                .notEmpty()
                .withMessage('Password is required')
        ];
    }
    
    // Register new user
    async register(req, res) {
        try {
            // Check validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid input data',
                        details: errors.array(),
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            const { email, password } = req.body;
            
            // Check if user already exists
            const existingUser = await UserRepository.findByEmail(email);
            if (existingUser) {
                return res.status(409).json({
                    error: {
                        code: 'USER_EXISTS',
                        message: 'User with this email already exists',
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            // Create new user
            const user = await UserRepository.createUser(email, password);
            
            // Generate JWT token
            const token = generateToken(user);
            
            logger.info('User registered successfully', { userId: user.id, email: user.email });
            
            res.status(201).json({
                message: 'User registered successfully',
                user: {
                    id: user.id,
                    email: user.email,
                    tokens: user.tokens,
                    createdAt: user.created_at
                },
                token,
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            });
            
        } catch (error) {
            logger.error('Registration failed', { email: req.body?.email, error: error.message });
            
            if (error.message === 'Email already exists') {
                return res.status(409).json({
                    error: {
                        code: 'USER_EXISTS',
                        message: error.message,
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            res.status(500).json({
                error: {
                    code: 'REGISTRATION_FAILED',
                    message: 'Failed to register user',
                    timestamp: new Date().toISOString()
                }
            });
        }
    }
    
    // Login user
    async login(req, res) {
        try {
            // Check validation errors
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid input data',
                        details: errors.array(),
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            const { email, password } = req.body;
            
            // Verify user credentials
            const user = await UserRepository.verifyPassword(email, password);
            if (!user) {
                // Don't reveal whether email exists or password is wrong
                return res.status(401).json({
                    error: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Invalid email or password',
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            // Generate JWT token
            const token = generateToken(user);
            
            logger.info('User logged in successfully', { userId: user.id, email: user.email });
            
            res.json({
                message: 'Login successful',
                user: {
                    id: user.id,
                    email: user.email,
                    tokens: user.tokens
                },
                token,
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            });
            
        } catch (error) {
            logger.error('Login failed', { email: req.body?.email, error: error.message });
            
            res.status(500).json({
                error: {
                    code: 'LOGIN_FAILED',
                    message: 'Login process failed',
                    timestamp: new Date().toISOString()
                }
            });
        }
    }
    
    // Get current user profile
    async getProfile(req, res) {
        try {
            const user = await UserRepository.findById(req.user.id);
            if (!user) {
                return res.status(404).json({
                    error: {
                        code: 'USER_NOT_FOUND',
                        message: 'User not found',
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            res.json({
                user: {
                    id: user.id,
                    email: user.email,
                    tokens: user.tokens,
                    stripeCustomerId: user.stripe_customer_id,
                    createdAt: user.created_at,
                    updatedAt: user.updated_at
                }
            });
            
        } catch (error) {
            logger.error('Failed to get user profile', { userId: req.user.id, error: error.message });
            
            res.status(500).json({
                error: {
                    code: 'PROFILE_FETCH_FAILED',
                    message: 'Failed to retrieve user profile',
                    timestamp: new Date().toISOString()
                }
            });
        }
    }
    
    // Refresh token
    async refreshToken(req, res) {
        try {
            // User is already authenticated via middleware
            const user = await UserRepository.findById(req.user.id);
            if (!user) {
                return res.status(404).json({
                    error: {
                        code: 'USER_NOT_FOUND',
                        message: 'User not found',
                        timestamp: new Date().toISOString()
                    }
                });
            }
            
            // Generate new token
            const token = generateToken(user);
            
            logger.info('Token refreshed successfully', { userId: user.id });
            
            res.json({
                message: 'Token refreshed successfully',
                token,
                expiresIn: process.env.JWT_EXPIRES_IN || '24h'
            });
            
        } catch (error) {
            logger.error('Token refresh failed', { userId: req.user?.id, error: error.message });
            
            res.status(500).json({
                error: {
                    code: 'TOKEN_REFRESH_FAILED',
                    message: 'Failed to refresh token',
                    timestamp: new Date().toISOString()
                }
            });
        }
    }
}

module.exports = new AuthService();