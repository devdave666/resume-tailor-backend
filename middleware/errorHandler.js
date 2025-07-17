// middleware/errorHandler.js
// Comprehensive error handling middleware

const { logger } = require('../config/database');

class ErrorHandler {

    /**
     * Global error handling middleware
     * @param {Error} err - Error object
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    static globalErrorHandler(err, req, res, next) {
        // Log the error with context
        logger.error('Unhandled error occurred', {
            error: {
                message: err.message,
                stack: err.stack,
                name: err.name
            },
            request: {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: req.body ? JSON.stringify(req.body).substring(0, 1000) : undefined,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            },
            user: req.user ? { id: req.user.id, email: req.user.email } : undefined,
            timestamp: new Date().toISOString()
        });

        // Don't expose internal errors in production
        const isDevelopment = process.env.NODE_ENV === 'development';

        // Determine error type and response
        const errorResponse = ErrorHandler.categorizeError(err, isDevelopment);

        // Send error response
        res.status(errorResponse.status).json({
            error: {
                code: errorResponse.code,
                message: errorResponse.message,
                ...(isDevelopment && { stack: err.stack }),
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Categorize error and determine appropriate response
     * @param {Error} err - Error object
     * @param {boolean} isDevelopment - Whether in development mode
     * @returns {Object} Error response object
     */
    static categorizeError(err, isDevelopment = false) {
        // Database errors
        if (err.code === '23505') { // PostgreSQL unique violation
            return {
                status: 409,
                code: 'DUPLICATE_ENTRY',
                message: 'A record with this information already exists'
            };
        }

        if (err.code === '23503') { // PostgreSQL foreign key violation
            return {
                status: 400,
                code: 'INVALID_REFERENCE',
                message: 'Referenced record does not exist'
            };
        }

        if (err.code === '23502') { // PostgreSQL not null violation
            return {
                status: 400,
                code: 'MISSING_REQUIRED_FIELD',
                message: 'Required field is missing'
            };
        }

        // JWT errors
        if (err.name === 'JsonWebTokenError') {
            return {
                status: 401,
                code: 'INVALID_TOKEN',
                message: 'Invalid authentication token'
            };
        }

        if (err.name === 'TokenExpiredError') {
            return {
                status: 401,
                code: 'TOKEN_EXPIRED',
                message: 'Authentication token has expired'
            };
        }

        // Multer errors (file upload)
        if (err.code === 'LIMIT_FILE_SIZE') {
            return {
                status: 400,
                code: 'FILE_TOO_LARGE',
                message: 'Uploaded file is too large'
            };
        }

        if (err.code === 'LIMIT_FILE_COUNT') {
            return {
                status: 400,
                code: 'TOO_MANY_FILES',
                message: 'Too many files uploaded'
            };
        }

        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return {
                status: 400,
                code: 'UNEXPECTED_FILE',
                message: 'Unexpected file field'
            };
        }

        // Validation errors
        if (err.name === 'ValidationError') {
            return {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: err.message || 'Input validation failed'
            };
        }

        // Custom application errors
        if (err.message === 'Insufficient tokens') {
            return {
                status: 402,
                code: 'INSUFFICIENT_TOKENS',
                message: 'Insufficient tokens. Please purchase more.'
            };
        }

        if (err.message === 'User not found') {
            return {
                status: 404,
                code: 'USER_NOT_FOUND',
                message: 'User not found'
            };
        }

        if (err.message === 'Email already exists') {
            return {
                status: 409,
                code: 'EMAIL_EXISTS',
                message: 'An account with this email already exists'
            };
        }

        // AI service errors
        if (err.message.includes('rate limit') || err.message.includes('quota')) {
            return {
                status: 429,
                code: 'AI_RATE_LIMIT',
                message: 'AI service rate limit exceeded. Please try again later.'
            };
        }

        if (err.message.includes('Invalid JSON') || err.message.includes('AI generation')) {
            return {
                status: 500,
                code: 'AI_GENERATION_FAILED',
                message: 'AI content generation failed. Please try again.'
            };
        }

        // Document parsing errors
        if (err.message.includes('parse') || err.message.includes('extract')) {
            return {
                status: 400,
                code: 'DOCUMENT_PARSE_FAILED',
                message: 'Failed to parse document. Please ensure the file is not corrupted.'
            };
        }

        // Network/timeout errors
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            return {
                status: 503,
                code: 'SERVICE_UNAVAILABLE',
                message: 'External service is temporarily unavailable'
            };
        }

        // Stripe errors
        if (err.type === 'StripeCardError') {
            return {
                status: 400,
                code: 'PAYMENT_FAILED',
                message: 'Payment failed. Please check your card details.'
            };
        }

        if (err.type === 'StripeInvalidRequestError') {
            return {
                status: 400,
                code: 'INVALID_PAYMENT_REQUEST',
                message: 'Invalid payment request'
            };
        }

        // Default error response
        return {
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: isDevelopment ? err.message : 'An unexpected error occurred'
        };
    }

    /**
     * Handle 404 errors (route not found)
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     */
    static notFoundHandler(req, res) {
        logger.warn('Route not found', {
            method: req.method,
            url: req.url,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(404).json({
            error: {
                code: 'ROUTE_NOT_FOUND',
                message: `Route ${req.method} ${req.url} not found`,
                timestamp: new Date().toISOString()
            }
        });
    }

    /**
     * Async error wrapper for route handlers
     * @param {Function} fn - Async route handler function
     * @returns {Function} Wrapped function with error handling
     */
    static asyncHandler(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    /**
     * Create custom error
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code
     * @param {string} code - Error code
     * @returns {Error} Custom error object
     */
    static createError(message, statusCode = 500, code = 'CUSTOM_ERROR') {
        const error = new Error(message);
        error.statusCode = statusCode;
        error.code = code;
        return error;
    }

    /**
     * Validate environment variables on startup
     * @returns {boolean} True if all required variables are present
     */
    static validateEnvironment() {
        const required = [
            'DB_HOST',
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
            'JWT_SECRET',
            'GEMINI_API_KEY'
        ];

        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            logger.error('Missing required environment variables', { missing });
            return false;
        }

        // Validate JWT secret strength
        if (process.env.JWT_SECRET.length < 32) {
            logger.warn('JWT_SECRET should be at least 32 characters for security');
        }

        // Check for placeholder values
        const placeholders = {
            'GEMINI_API_KEY': 'your-gemini-api-key-here',
            'STRIPE_SECRET_KEY': 'sk_test_placeholder-key-for-testing',
            'PDF_CO_API_KEY': 'test-placeholder-key-for-testing'
        };

        Object.entries(placeholders).forEach(([key, placeholder]) => {
            if (process.env[key] === placeholder) {
                logger.warn(`${key} is set to placeholder value`);
            }
        });

        return true;
    }

    /**
     * Graceful shutdown handler
     * @param {string} signal - Shutdown signal
     */
    static gracefulShutdown(signal) {
        logger.info(`Received ${signal}, starting graceful shutdown`);

        // Close database connections
        const { closePool } = require('../config/database');
        closePool().then(() => {
            logger.info('Database connections closed');
            process.exit(0);
        }).catch(err => {
            logger.error('Error during shutdown', err);
            process.exit(1);
        });
    }
}

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason, promise });
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', () => ErrorHandler.gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => ErrorHandler.gracefulShutdown('SIGINT'));

module.exports = ErrorHandler;