// middleware/validation.js
// Comprehensive input validation middleware

const { body, param, query, validationResult } = require('express-validator');
const { logger } = require('../config/database');

class ValidationMiddleware {
    
    /**
     * Handle validation results and return formatted errors
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    static handleValidationErrors(req, res, next) {
        const errors = validationResult(req);
        
        if (!errors.isEmpty()) {
            const formattedErrors = errors.array().map(error => ({
                field: error.path || error.param,
                message: error.msg,
                value: error.value,
                location: error.location
            }));
            
            logger.warn('Validation failed', { 
                endpoint: req.path,
                method: req.method,
                errors: formattedErrors,
                ip: req.ip
            });
            
            return res.status(400).json({
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Input validation failed',
                    details: formattedErrors,
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        next();
    }
    
    /**
     * Validation rules for user registration
     */
    static getRegistrationValidation() {
        return [
            body('email')
                .isEmail()
                .normalizeEmail()
                .withMessage('Must be a valid email address')
                .isLength({ max: 255 })
                .withMessage('Email must be less than 255 characters'),
            
            body('password')
                .isLength({ min: 8, max: 128 })
                .withMessage('Password must be between 8 and 128 characters')
                .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
                .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number')
                .not()
                .isIn(['password', '12345678', 'qwerty', 'abc123'])
                .withMessage('Password is too common'),
            
            ValidationMiddleware.handleValidationErrors
        ];
    }
    
    /**
     * Validation rules for user login
     */
    static getLoginValidation() {
        return [
            body('email')
                .isEmail()
                .normalizeEmail()
                .withMessage('Must be a valid email address'),
            
            body('password')
                .notEmpty()
                .withMessage('Password is required')
                .isLength({ max: 128 })
                .withMessage('Password is too long'),
            
            ValidationMiddleware.handleValidationErrors
        ];
    }
    
    /**
     * Validation rules for document generation
     */
    static getGenerationValidation() {
        return [
            body('jobDescription')
                .notEmpty()
                .withMessage('Job description is required')
                .isLength({ min: 50, max: 10000 })
                .withMessage('Job description must be between 50 and 10,000 characters')
                .trim(),
            
            ValidationMiddleware.handleValidationErrors
        ];
    }
    
    /**
     * Validation rules for job posting extraction
     */
    static getJobExtractionValidation() {
        return [
            body('htmlContent')
                .notEmpty()
                .withMessage('HTML content is required')
                .isLength({ min: 100, max: 100000 })
                .withMessage('HTML content must be between 100 and 100,000 characters'),
            
            body('url')
                .optional()
                .isURL()
                .withMessage('URL must be valid if provided'),
            
            ValidationMiddleware.handleValidationErrors
        ];
    }
    
    /**
     * Validation for file uploads
     * @param {Object} options - Validation options
     */
    static validateFileUpload(options = {}) {
        const {
            required = true,
            maxSize = 10 * 1024 * 1024, // 10MB default
            allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword', 'text/plain']
        } = options;
        
        return (req, res, next) => {
            try {
                // Check if file is required
                if (required && (!req.file && !req.files)) {
                    return res.status(400).json({
                        error: {
                            code: 'FILE_REQUIRED',
                            message: 'File upload is required',
                            timestamp: new Date().toISOString()
                        }
                    });
                }
                
                // Get file(s) to validate
                const files = [];
                if (req.file) files.push(req.file);
                if (req.files) {
                    if (Array.isArray(req.files)) {
                        files.push(...req.files);
                    } else {
                        Object.values(req.files).forEach(fileArray => {
                            if (Array.isArray(fileArray)) {
                                files.push(...fileArray);
                            } else {
                                files.push(fileArray);
                            }
                        });
                    }
                }
                
                // Validate each file
                for (const file of files) {
                    // Check file size
                    if (file.size > maxSize) {
                        return res.status(400).json({
                            error: {
                                code: 'FILE_TOO_LARGE',
                                message: `File "${file.originalname}" is too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB`,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    
                    // Check file type
                    if (!allowedTypes.includes(file.mimetype)) {
                        return res.status(400).json({
                            error: {
                                code: 'INVALID_FILE_TYPE',
                                message: `File "${file.originalname}" has invalid type. Allowed types: ${allowedTypes.join(', ')}`,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    
                    // Check filename
                    if (!file.originalname || file.originalname.length > 255) {
                        return res.status(400).json({
                            error: {
                                code: 'INVALID_FILENAME',
                                message: 'File must have a valid name (max 255 characters)',
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                    
                    // Check for potentially dangerous filenames
                    if (/[<>:"/\\|?*]/.test(file.originalname)) {
                        return res.status(400).json({
                            error: {
                                code: 'UNSAFE_FILENAME',
                                message: 'Filename contains unsafe characters',
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                }
                
                logger.debug('File validation passed', { 
                    fileCount: files.length,
                    files: files.map(f => ({ name: f.originalname, size: f.size, type: f.mimetype }))
                });
                
                next();
                
            } catch (error) {
                logger.error('File validation error', { error: error.message });
                return res.status(500).json({
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'File validation failed',
                        timestamp: new Date().toISOString()
                    }
                });
            }
        };
    }
    
    /**
     * Validation for test endpoints
     */
    static getTestValidation() {
        return [
            body('resumeText')
                .optional()
                .isLength({ min: 50, max: 20000 })
                .withMessage('Resume text must be between 50 and 20,000 characters'),
            
            body('jobDescription')
                .optional()
                .isLength({ min: 50, max: 10000 })
                .withMessage('Job description must be between 50 and 10,000 characters'),
            
            body('content')
                .optional()
                .isLength({ min: 10, max: 50000 })
                .withMessage('Content must be between 10 and 50,000 characters'),
            
            body('type')
                .optional()
                .isIn(['resume', 'coverLetter'])
                .withMessage('Type must be either "resume" or "coverLetter"'),
            
            ValidationMiddleware.handleValidationErrors
        ];
    }
    
    /**
     * Sanitize HTML content to prevent XSS
     * @param {string} html - HTML content to sanitize
     * @returns {string} Sanitized HTML
     */
    static sanitizeHtml(html) {
        if (!html || typeof html !== 'string') return '';
        
        return html
            // Remove script tags
            .replace(/<script[^>]*>.*?<\/script>/gis, '')
            // Remove style tags
            .replace(/<style[^>]*>.*?<\/style>/gis, '')
            // Remove event handlers
            .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
            // Remove javascript: URLs
            .replace(/javascript:/gi, '')
            // Remove data: URLs (except images)
            .replace(/data:(?!image\/)/gi, '')
            // Limit to reasonable length
            .substring(0, 100000);
    }
    
    /**
     * Rate limiting validation
     * @param {Object} options - Rate limiting options
     */
    static createRateLimit(options = {}) {
        const {
            windowMs = 15 * 60 * 1000, // 15 minutes
            max = 100, // requests per window
            message = 'Too many requests, please try again later',
            skipSuccessfulRequests = false
        } = options;
        
        return rateLimit({
            windowMs,
            max,
            skipSuccessfulRequests,
            message: {
                error: {
                    code: 'RATE_LIMIT_EXCEEDED',
                    message,
                    timestamp: new Date().toISOString()
                }
            },
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                logger.warn('Rate limit exceeded', { 
                    ip: req.ip,
                    endpoint: req.path,
                    method: req.method,
                    userAgent: req.get('User-Agent')
                });
                
                res.status(429).json({
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message,
                        retryAfter: Math.round(windowMs / 1000),
                        timestamp: new Date().toISOString()
                    }
                });
            }
        });
    }
}

module.exports = ValidationMiddleware;