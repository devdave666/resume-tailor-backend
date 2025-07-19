// Production Configuration Module
// Handles production-specific settings, security, and optimizations

const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

class ProductionConfig {
    /**
     * Validate production environment variables
     */
    static validateProductionEnvironment() {
        const errors = [];
        const warnings = [];

        // Required environment variables
        const required = [
            'DB_HOST',
            'DB_PASSWORD',
            'JWT_SECRET',
            'GEMINI_API_KEY',
            'STRIPE_SECRET_KEY',
            'STRIPE_WEBHOOK_SECRET'
        ];

        // Check required variables
        for (const variable of required) {
            if (!process.env[variable]) {
                errors.push(`Missing required environment variable: ${variable}`);
            }
        }

        // Check JWT secret strength
        if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
            warnings.push('JWT_SECRET should be at least 32 characters long');
        }

        // Check database SSL in production
        if (process.env.NODE_ENV === 'production' && !process.env.DB_SSL) {
            warnings.push('Consider enabling DB_SSL for production database connections');
        }

        // Check if using default values
        const defaultValues = {
            'JWT_SECRET': ['your-jwt-secret-key-here', 'change-me'],
            'DB_PASSWORD': ['your_password_here', 'password', '123456']
        };

        for (const [key, defaults] of Object.entries(defaultValues)) {
            if (process.env[key] && defaults.includes(process.env[key])) {
                errors.push(`${key} is using a default/weak value. Please change it.`);
            }
        }

        return { errors, warnings };
    }

    /**
     * Configure security middleware for production
     */
    static configureSecurityMiddleware(app) {
        // Helmet for security headers
        app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                    connectSrc: ["'self'"],
                    fontSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'none'"],
                    upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
                }
            },
            crossOriginEmbedderPolicy: false, // Allow Chrome extension integration
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            }
        }));

        // Compression middleware
        app.use(compression({
            level: 6,
            threshold: 1024,
            filter: (req, res) => {
                if (req.headers['x-no-compression']) {
                    return false;
                }
                return compression.filter(req, res);
            }
        }));

        // Trust proxy for load balancer
        app.set('trust proxy', 1);
    }

    /**
     * Get CORS configuration for production
     */
    static getCorsConfig() {
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
            ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
            : ['http://localhost:3000'];

        return {
            origin: (origin, callback) => {
                // Allow requests with no origin (mobile apps, Postman, etc.)
                if (!origin) return callback(null, true);

                // Check if origin is allowed
                if (allowedOrigins.includes(origin) || 
                    origin.startsWith('chrome-extension://') ||
                    origin.startsWith('moz-extension://')) {
                    return callback(null, true);
                }

                // In development, allow localhost
                if (process.env.NODE_ENV !== 'production' && 
                    (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
                    return callback(null, true);
                }

                callback(new Error('Not allowed by CORS'));
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining'],
            maxAge: 86400 // 24 hours
        };
    }

    /**
     * Get rate limiting configuration
     */
    static getRateLimitConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            global: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: isProduction ? 1000 : 10000, // requests per window
                message: {
                    error: 'Too many requests from this IP, please try again later.',
                    retryAfter: '15 minutes'
                },
                standardHeaders: true,
                legacyHeaders: false,
                handler: (req, res) => {
                    res.status(429).json({
                        error: 'Rate limit exceeded',
                        message: 'Too many requests from this IP, please try again later.',
                        retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
                    });
                }
            },
            auth: {
                windowMs: 15 * 60 * 1000, // 15 minutes
                max: isProduction ? 10 : 100, // login attempts per window
                message: {
                    error: 'Too many authentication attempts, please try again later.',
                    retryAfter: '15 minutes'
                },
                skipSuccessfulRequests: true,
                standardHeaders: true,
                legacyHeaders: false
            },
            generation: {
                windowMs: 60 * 1000, // 1 minute
                max: isProduction ? 5 : 50, // generations per minute
                message: {
                    error: 'Generation rate limit exceeded. Please wait before making another request.',
                    retryAfter: '1 minute'
                },
                standardHeaders: true,
                legacyHeaders: false
            },
            payment: {
                windowMs: 60 * 60 * 1000, // 1 hour
                max: isProduction ? 10 : 100, // payment attempts per hour
                message: {
                    error: 'Payment rate limit exceeded. Please contact support if you need assistance.',
                    retryAfter: '1 hour'
                },
                standardHeaders: true,
                legacyHeaders: false
            }
        };
    }

    /**
     * Get server configuration
     */
    static getServerConfig() {
        return {
            trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
            jsonLimit: '10mb',
            urlencodedLimit: '10mb',
            timeout: 30000, // 30 seconds
            keepAliveTimeout: 65000, // 65 seconds (higher than load balancer)
            headersTimeout: 66000 // 66 seconds
        };
    }

    /**
     * Get database configuration for production
     */
    static getDatabaseConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 5432,
            database: process.env.DB_NAME || 'resume_tailor',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD,
            ssl: isProduction ? { rejectUnauthorized: false } : false,
            
            // Connection pool settings
            max: parseInt(process.env.DB_POOL_MAX) || 20,
            min: parseInt(process.env.DB_POOL_MIN) || 2,
            idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
            acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
            evict: parseInt(process.env.DB_POOL_EVICT) || 1000,
            
            // Connection timeouts
            connectionTimeoutMillis: 30000,
            idleTimeoutMillis: 30000,
            query_timeout: 60000,
            
            // Logging
            logging: isProduction ? false : console.log,
            
            // Performance settings
            statement_timeout: 60000,
            lock_timeout: 30000,
            idle_in_transaction_session_timeout: 60000
        };
    }

    /**
     * Get Redis configuration for production
     */
    static getRedisConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            db: parseInt(process.env.REDIS_DB) || 0,
            
            // Connection settings
            connectTimeout: 10000,
            commandTimeout: 5000,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            
            // Connection pool
            lazyConnect: true,
            keepAlive: 30000,
            
            // Cluster settings (if using Redis Cluster)
            enableReadyCheck: true,
            maxRetriesPerRequest: null,
            retryDelayOnFailover: 100,
            
            // Performance settings
            keyPrefix: `resume-tailor:${process.env.NODE_ENV || 'development'}:`,
            
            // Error handling
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        };
    }

    /**
     * Get logging configuration
     */
    static getLoggingConfig() {
        const isProduction = process.env.NODE_ENV === 'production';
        
        return {
            level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
            format: isProduction ? 'json' : 'simple',
            
            // File logging for production
            files: isProduction ? {
                error: 'logs/error.log',
                combined: 'logs/combined.log',
                access: 'logs/access.log'
            } : null,
            
            // Console logging
            console: !isProduction,
            
            // Log rotation
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            
            // Structured logging fields
            defaultMeta: {
                service: 'resume-tailor-backend',
                environment: process.env.NODE_ENV || 'development',
                version: process.env.npm_package_version || '1.0.0'
            }
        };
    }

    /**
     * Get monitoring configuration
     */
    static getMonitoringConfig() {
        return {
            healthCheck: {
                path: '/health',
                interval: 30000, // 30 seconds
                timeout: 5000,   // 5 seconds
                retries: 3
            },
            
            metrics: {
                enabled: true,
                interval: 60000, // 1 minute
                retention: 24 * 60 * 60 * 1000 // 24 hours
            },
            
            alerts: {
                cpu: { threshold: 80, duration: 300000 }, // 80% for 5 minutes
                memory: { threshold: 85, duration: 300000 }, // 85% for 5 minutes
                disk: { threshold: 90, duration: 600000 }, // 90% for 10 minutes
                errorRate: { threshold: 5, duration: 300000 }, // 5% for 5 minutes
                responseTime: { threshold: 2000, duration: 300000 } // 2s for 5 minutes
            }
        };
    }

    /**
     * Get file upload configuration
     */
    static getUploadConfig() {
        return {
            maxFileSize: 10 * 1024 * 1024, // 10MB
            allowedMimeTypes: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain'
            ],
            uploadPath: process.env.UPLOAD_PATH || 'uploads/',
            tempPath: process.env.TEMP_PATH || 'temp/',
            cleanupInterval: 60 * 60 * 1000, // 1 hour
            tempFileMaxAge: 24 * 60 * 60 * 1000 // 24 hours
        };
    }

    /**
     * Initialize production optimizations
     */
    static initializeProduction(app) {
        if (process.env.NODE_ENV !== 'production') {
            return;
        }

        // Set production-specific Express settings
        app.set('env', 'production');
        app.set('x-powered-by', false);
        
        // Configure server timeouts
        const serverConfig = this.getServerConfig();
        app.use((req, res, next) => {
            req.setTimeout(serverConfig.timeout);
            res.setTimeout(serverConfig.timeout);
            next();
        });

        // Add production middleware
        this.configureSecurityMiddleware(app);

        console.log('✅ Production optimizations initialized');
    }
}

module.exports = ProductionConfig;