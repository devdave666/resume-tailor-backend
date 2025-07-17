// middleware/auth.js
// JWT Authentication middleware

const jwt = require('jsonwebtoken');
const { logger } = require('../config/database');
const UserRepository = require('../repositories/UserRepository');

// JWT token generation
function generateToken(user) {
    const payload = {
        userId: user.id,
        email: user.email
    };
    
    const options = {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: 'resume-tailor-backend'
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, options);
}

// JWT token verification
function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            throw new Error('Token expired');
        } else if (error.name === 'JsonWebTokenError') {
            throw new Error('Invalid token');
        } else {
            throw new Error('Token verification failed');
        }
    }
}

// Authentication middleware
async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({ 
                error: {
                    code: 'MISSING_TOKEN',
                    message: 'Access token is required',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        // Verify token
        const decoded = verifyToken(token);
        
        // Get user from database to ensure they still exist
        const user = await UserRepository.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ 
                error: {
                    code: 'USER_NOT_FOUND',
                    message: 'User associated with token not found',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        // Add user info to request
        req.user = {
            id: user.id,
            email: user.email,
            tokens: user.tokens
        };
        
        logger.debug('User authenticated successfully', { userId: user.id, email: user.email });
        next();
        
    } catch (error) {
        logger.warn('Authentication failed', { error: error.message, ip: req.ip });
        
        let errorCode = 'AUTH_FAILED';
        let statusCode = 401;
        
        if (error.message === 'Token expired') {
            errorCode = 'TOKEN_EXPIRED';
        } else if (error.message === 'Invalid token') {
            errorCode = 'INVALID_TOKEN';
        }
        
        return res.status(statusCode).json({ 
            error: {
                code: errorCode,
                message: error.message,
                timestamp: new Date().toISOString()
            }
        });
    }
}

// Optional authentication middleware (doesn't fail if no token)
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            const decoded = verifyToken(token);
            const user = await UserRepository.findById(decoded.userId);
            
            if (user) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    tokens: user.tokens
                };
            }
        }
        
        next();
    } catch (error) {
        // Continue without authentication for optional auth
        logger.debug('Optional auth failed, continuing without user', { error: error.message });
        next();
    }
}

// Validate JWT configuration
function validateJWTConfig() {
    if (!process.env.JWT_SECRET) {
        logger.error('JWT_SECRET environment variable is required');
        return false;
    }
    
    if (process.env.JWT_SECRET.length < 32) {
        logger.warn('JWT_SECRET should be at least 32 characters long for security');
    }
    
    return true;
}

module.exports = {
    generateToken,
    verifyToken,
    authenticateToken,
    optionalAuth,
    validateJWTConfig
};