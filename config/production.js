// config/production.js
// Production environment configuration and security settings

const helmet = require('helmet');
const compression = require('compression');
const { logger } = require('./database');

class ProductionConfig {
    
    /**
     * Configure security middleware for production
     * @param {Object} app - Express app instance
     */
    static configureSecurityMiddleware(app) {
        // Helmet for security headers
        app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com"],
                    imgSrc: ["'self'", "data:", "https:"],
                    scriptSrc: ["'self'"],
                    connectSrc: [
                        "'self'", 
                        "https://api.stripe.com",
                        "https://generativelanguage.googleapis.com",
                        "https://api.pdf.co"
                    ],
                    frameSrc: ["https://js.stripe.com"],
                    frameAncestors: ["'none'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"]
                }
            },
            crossOriginEmbedderPolicy: false, // Allow file downloads
            hsts: {
                maxAge: 31536000, // 1 year
                includeSubDomains: true,
                preload: true
            },
            noSniff: true,
            frameguard: { action: 'deny' },
            xssFilter: true,
            referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
        }));

        // Compression for better performance
        app.use(compression({
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            },
            level: 6,
            threshold: 1024
        }));

        logger.info('Production security middleware configured');
    }

    /**
     * Configure CORS for production
     * @returns {Object} CORS configuration
     */
    static getCorsConfig() {
        const allowedOrigins = [
            'chrome-extension://*',
            ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [])
        ];

        // In production, be more restrictive
        if (process.env.NODE_ENV === 'production') {
            // Remove wildcard and use specific origins
            const productionOrigins = process.env.ALLOWED_ORIGINS 
                ? process.env.ALLOWED_ORIGINS.split(',').filter(origin => origin !== '*')
                : [];
            
            return {
                origin: (origin, callback) => {
                    // Allow Chrome extensions
                    if (!origin || origin.startsWith('chrome-extension://')) {
                        return callback(null, true);
                    }
                    
                    // Check against allowed origins
                    if (productionOrigins.includes(origin)) {
                        return callback(null, true);
                    }
                    
                    logger.warn('CORS blocked origin', { origin, allowedOrigins: productionOrigins });
                    callback(new Error('Not allowed by CORS'));
                },
                methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
                credentials: true,
                maxAge: 86400 // 24 hours
            };
        }

        // Development CORS (more permissive)
        return {
            origin: allowedOrigins,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            credentials: true
        };
    }

    /**
     * Configure rate limiting for production
     * @returns {Object} Rate limiting configurations
     */
    static getRateLimitConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            // Global rate limit
            global: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: isProduction ? 1000 : 10000, // More restrictive in production
                message: {
                    error: {
                        code: 'RATE_LIMIT_EXCEEDED',
                        message: 'Too many requests from this IP, please try again later.',
                        timestamp: new Date().toISOString()
                    }
                },
                standardHeaders: true,
                legacyHeaders: false,
                skip: (req) => {
                    // Skip rate limiting for health checks
                    return req.path === '/health' || req.path === '/test/health';
                }
            },
            
            // Authentication endpoints
            auth: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: isProduction ? 10 : 100, // Very restrictive for auth
                message: {
                    error: {
                        code: 'AUTH_RATE_LIMIT_EXCEEDED',
                        message: 'Too many authentication attempts, please try again later.',
                        timestamp: new Date().toISOString()
                    }
                }
            },
            
            // Generation endpoints
            generation: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: isProduction ? 5 : 50, // Very restrictive for expensive operations
                message: {
                    error: {
                        code: 'GENERATION_RATE_LIMIT_EXCEEDED',
                        message: 'Too many generation requests, please try again later.',
                        timestamp: new Date().toISOString()
                    }
                }
            },
            
            // Payment endpoints
            payment: {
                windowMs: 60 * 60 * 1000, // 1 hour
                max: isProduction ? 10 : 100, // Restrictive for payments
                message: {
                    error: {
                        code: 'PAYMENT_RATE_LIMIT_EXCEEDED',
                        message: 'Too many payment requests, please try again later.',
                        timestamp: new Date().toISOString()
                    }
                }
            }
        };
    }

    /**
     * Validate production environment variables
     * @returns {Object} Validation result
     */
    static validateProductionEnvironment() {
        const errors = [];
        const warnings = [];
        
        // Required for production
        const requiredVars = [
            'NODE_ENV',
            'PORT',
            'DB_HOST',
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
            'JWT_SECRET',
            'GEMINI_API_KEY',
            'STRIPE_SECRET_KEY',
            'STRIPE_WEBHOOK_SECRET'
        ];
        
        // Check required variables
        requiredVars.forEach(varName => {
            if (!process.env[varName]) {
                errors.push(`Missing required environment variable: ${varName}`);
            }
        });
        
        // Production-specific validations
        if (process.env.NODE_ENV === 'production') {
            // JWT Secret strength
            if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
                errors.push('JWT_SECRET must be at least 32 characters in production');
            }
            
            // Database security
            if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.length < 12) {
                warnings.push('DB_PASSWORD should be at least 12 characters for production');
            }
            
            // API Keys validation
            if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
                warnings.push('Using test Stripe key in production environment');
            }
            
            if (process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
                errors.push('GEMINI_API_KEY is set to placeholder value');
            }
            
            // CORS origins
            if (!process.env.ALLOWED_ORIGINS) {
                warnings.push('ALLOWED_ORIGINS not set - CORS will be very restrictive');
            }
            
            // SSL/TLS
            if (!process.env.FORCE_HTTPS && process.env.NODE_ENV === 'production') {
                warnings.push('FORCE_HTTPS not enabled - consider enabling for production');
            }
        }
        
        return { errors, warnings };
    }

    /**
     * Configure logging for production
     * @returns {Object} Winston logger configuration
     */
    static getLoggingConfig() {
        const winston = require('winston');
        const isProduction = process.env.NODE_ENV === 'production';
        
        const transports = [];
        
        // Console transport
        transports.push(new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                isProduction 
                    ? winston.format.json() 
                    : winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
            )
        }));
        
        // File transport for production
        if (isProduction) {
            transports.push(new winston.transports.File({
                filename: 'logs/error.log',
                level: 'error',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                ),
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }));
            
            transports.push(new winston.transports.File({
                filename: 'logs/combined.log',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.errors({ stack: true }),
                    winston.format.json()
                ),
                maxsize: 5242880, // 5MB
                maxFiles: 5
            }));
        }
        
        return {
            level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.json()
            ),
            transports,
            exitOnError: false
        };
    }

    /**
     * Configure database for production
     * @returns {Object} Database configuration
     */
    static getDatabaseConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            
            // Connection pool settings
            max: isProduction ? 20 : 10, // Maximum connections
            min: isProduction ? 5 : 2,   // Minimum connections
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            maxUses: 7500,
            
            // SSL configuration for production
            ssl: isProduction ? {
                rejectUnauthorized: false, // Set to true with proper certificates
                ca: process.env.DB_SSL_CA,
                key: process.env.DB_SSL_KEY,
                cert: process.env.DB_SSL_CERT
            } : false,
            
            // Query timeout
            query_timeout: 30000,
            statement_timeout: 30000
        };
    }

    /**
     * Configure session settings for production
     * @returns {Object} Session configuration
     */
    static getSessionConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: isProduction, // HTTPS only in production
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000, // 24 hours
                sameSite: isProduction ? 'strict' : 'lax'
            },
            name: 'resume-tailor-session'
        };
    }

    /**
     * Get server configuration
     * @returns {Object} Server configuration
     */
    static getServerConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            port: process.env.PORT || 3000,
            host: process.env.HOST || '0.0.0.0',
            
            // Trust proxy in production (for load balancers)
            trustProxy: isProduction,
            
            // Request limits
            jsonLimit: '10mb',
            urlencodedLimit: '10mb',
            
            // Timeout settings
            timeout: 30000, // 30 seconds
            keepAliveTimeout: 5000,
            headersTimeout: 60000
        };
    }

    /**
     * Configure monitoring and health checks
     * @returns {Object} Monitoring configuration
     */
    static getMonitoringConfig() {
        return {
            healthCheck: {
                path: '/health',
                interval: 30000, // 30 seconds
                timeout: 5000,   // 5 seconds
                checks: [
                    'database',
                    'redis', // if using Redis
                    'external_apis'
                ]
            },
            
            metrics: {
                enabled: process.env.ENABLE_METRICS === 'true',
                path: '/metrics',
                collectDefaultMetrics: true,
                requestDuration: true,
                requestCount: true
            },
            
            alerts: {
                errorThreshold: 10, // Alert after 10 errors in 5 minutes
                responseTimeThreshold: 5000, // Alert if response time > 5s
                memoryThreshold: 0.9 // Alert if memory usage > 90%
            }
        };
    }
}

module.exports = ProductionConfig;