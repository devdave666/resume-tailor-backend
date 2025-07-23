// server.js
// Secure backend for the Resume Tailor Chrome Extension

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');

const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config(); // To manage environment variables

// Import new database and authentication modules
const { testConnection, validateConfig, logger } = require('./config/database');
const ProductionConfig = require('./config/production');
const { authenticateToken, optionalAuth, validateJWTConfig } = require('./middleware/auth');
const ValidationMiddleware = require('./middleware/validation');
const ErrorHandler = require('./middleware/errorHandler');
const AuthService = require('./services/AuthService');
const DocumentParsingService = require('./services/DocumentParsingService');
const AIGenerationService = require('./services/AIGenerationService');
const DocumentGenerationService = require('./services/DocumentGenerationService');
const PaymentService = require('./services/PaymentService');
const MonitoringService = require('./services/MonitoringService');
const UserRepository = require('./repositories/UserRepository');
const GenerationRepository = require('./repositories/GenerationRepository');

// --- INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// Validate configuration on startup
async function validateStartupConfig() {
    logger.info('Validating startup configuration...');
    
    // Validate production environment
    const prodValidation = ProductionConfig.validateProductionEnvironment();
    if (prodValidation.errors.length > 0) {
        logger.error('Production environment validation failed', { errors: prodValidation.errors });
        process.exit(1);
    }
    if (prodValidation.warnings.length > 0) {
        logger.warn('Production environment warnings', { warnings: prodValidation.warnings });
    }
    
    // Validate environment variables
    if (!ErrorHandler.validateEnvironment()) {
        logger.error('Environment validation failed');
        process.exit(1);
    }
    
    // Validate database configuration
    if (!validateConfig()) {
        logger.error('Database configuration validation failed');
        process.exit(1);
    }
    
    // Validate JWT configuration
    if (!validateJWTConfig()) {
        logger.error('JWT configuration validation failed');
        process.exit(1);
    }
    
    // Test database connection
    const connected = await testConnection();
    if (!connected) {
        if (process.env.USE_MOCK_DB === 'true') {
            logger.warn('Using mock database for development');
        } else {
            logger.error('Database connection failed');
            process.exit(1);
        }
    }
    
    // Validate AI service configuration
    if (!AIGenerationService.validateConfiguration()) {
        logger.error('AI service configuration validation failed');
        process.exit(1);
    }
    
    // Validate payment service configuration
    if (!PaymentService.validateConfiguration()) {
        logger.error('Payment service configuration validation failed');
        process.exit(1);
    }
    
    logger.info('✓ All configurations validated successfully');
}

// Request logging and monitoring middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Log request
    logger.info(`${req.method} ${req.url}`, { 
        ip: req.ip, 
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });
    
    // Monitor response
    res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode < 400;
        
        // Record metrics
        MonitoringService.recordRequest(req.path, responseTime, success);
        
        // Log response
        logger.info(`${req.method} ${req.url} - ${res.statusCode}`, {
            responseTime: `${responseTime}ms`,
            statusCode: res.statusCode,
            success
        });
    });
    
    // Monitor errors
    res.on('error', (error) => {
        MonitoringService.recordError(error, req.path);
    });
    
    next();
});

// --- API CLIENTS SETUP ---
// IMPORTANT: API keys are loaded from a .env file for security.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PDF_CO_API_KEY = process.env.PDF_CO_API_KEY;

// --- MIDDLEWARE ---

// Configure production security middleware
ProductionConfig.configureSecurityMiddleware(app);

// Configure CORS with production settings
app.use(cors(ProductionConfig.getCorsConfig()));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Configure server settings
const serverConfig = ProductionConfig.getServerConfig();
app.set('trust proxy', serverConfig.trustProxy);

// Parse JSON bodies with limits
app.use(express.json({ limit: serverConfig.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: serverConfig.urlencodedLimit }));

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 5 // Maximum 5 files
    }
});

// Configure rate limiting with production settings
const rateLimitConfig = ProductionConfig.getRateLimitConfig();
const globalRateLimit = rateLimit(rateLimitConfig.global);
const authRateLimit = rateLimit(rateLimitConfig.auth);
const generationRateLimit = rateLimit(rateLimitConfig.generation);
const paymentRateLimit = rateLimit(rateLimitConfig.payment);

// Apply global rate limiting
app.use(globalRateLimit);

// --- AUTHENTICATION ENDPOINTS ---

/**
 * Endpoint: /auth/register
 * Method: POST
 * Description: Register a new user account
 */
app.post('/auth/register', 
    authRateLimit,
    ValidationMiddleware.getRegistrationValidation(),
    ErrorHandler.asyncHandler(async (req, res) => {
        await AuthService.register(req, res);
    })
);

/**
 * Endpoint: /auth/login
 * Method: POST
 * Description: Login user and return JWT token
 */
app.post('/auth/login', 
    authRateLimit,
    ValidationMiddleware.getLoginValidation(),
    ErrorHandler.asyncHandler(async (req, res) => {
        await AuthService.login(req, res);
    })
);

/**
 * Endpoint: /auth/profile
 * Method: GET
 * Description: Get current user profile (requires authentication)
 */
app.get('/auth/profile', authenticateToken, ErrorHandler.asyncHandler(async (req, res) => {
    await AuthService.getProfile(req, res);
}));

/**
 * Endpoint: /auth/refresh
 * Method: POST
 * Description: Refresh JWT token (requires authentication)
 */
app.post('/auth/refresh', authenticateToken, ErrorHandler.asyncHandler(async (req, res) => {
    await AuthService.refreshToken(req, res);
}));

// --- API ENDPOINTS ---

/**
 * Endpoint: /extract-job-posting
 * Method: POST
 * Description: Extract job description from webpage HTML for Chrome extension.
 */
app.post('/extract-job-posting', 
    optionalAuth, 
    ValidationMiddleware.getJobExtractionValidation(),
    ErrorHandler.asyncHandler(async (req, res) => {
        const { url, htmlContent } = req.body;
        
        // Sanitize HTML content
        const sanitizedHtml = ValidationMiddleware.sanitizeHtml(htmlContent);
        const jobDescription = extractJobFromHTML(sanitizedHtml);
        
        res.json({ jobDescription, url });
    })
);

/**
 * Endpoint: /quick-generate
 * Method: POST
 * Description: Simplified generation for extension popup.
 */
app.post('/quick-generate', 
    authenticateToken,
    ValidationMiddleware.createRateLimit({ max: 5, windowMs: 15 * 60 * 1000 }),
    ValidationMiddleware.validateFileUpload({ required: true, maxSize: 5 * 1024 * 1024 }),
    upload.single('resume'), 
    ValidationMiddleware.getGenerationValidation(),
    ErrorHandler.asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Check token balance
        if (req.user.tokens <= 0) {
            throw ErrorHandler.createError('Insufficient tokens', 402, 'INSUFFICIENT_TOKENS');
        }

        const { jobDescription } = req.body;
        const resumeFile = req.file;

        // Validate and parse document
        DocumentParsingService.validateFile(resumeFile);
        const resumeText = await DocumentParsingService.parseDocument(resumeFile);
        const aiResponse = await AIGenerationService.generateTailoredContent(resumeText, "Not provided.", jobDescription);
        
        // Deduct token atomically
        const newBalance = await UserRepository.deductTokens(userId, 1);
        
        // Record generation
        await GenerationRepository.createGeneration(userId, jobDescription, resumeFile.originalname);
        await GenerationRepository.recordApiUsage(userId, '/quick-generate', 1);

        res.json({
            tailoredResume: aiResponse.tailoredResume,
            coverLetter: aiResponse.coverLetter,
            newTokenBalance: newBalance
        });
    })
);

/**
 * Endpoint: /get-token-balance
 * Method: GET
 * Description: Retrieves the token balance for the authenticated user.
 */
app.get('/get-token-balance', authenticateToken, ErrorHandler.asyncHandler(async (req, res) => {
    const user = await UserRepository.findById(req.user.id);
    if (!user) {
        throw ErrorHandler.createError('User not found', 404, 'USER_NOT_FOUND');
    }
    
    res.json({ tokens: user.tokens });
}));

/**
 * Endpoint: /generate
 * Method: POST
 * Description: A single endpoint to handle parsing, AI generation, and file creation.
 * This is more efficient than multiple round-trips from the client.
 */
app.post('/generate', 
    authenticateToken,
    ValidationMiddleware.createRateLimit({ max: 5, windowMs: 15 * 60 * 1000 }),
    ValidationMiddleware.validateFileUpload({ required: true, maxSize: 10 * 1024 * 1024 }),
    upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'profile', maxCount: 1 }]),
    ValidationMiddleware.getGenerationValidation(),
    ErrorHandler.asyncHandler(async (req, res) => {
        const userId = req.user.id;

        // Check token balance
        if (req.user.tokens <= 0) {
            throw ErrorHandler.createError('Insufficient tokens', 402, 'INSUFFICIENT_TOKENS');
        }
        
        const { jobDescription } = req.body;
        const resumeFile = req.files['resume'] ? req.files['resume'][0] : null;
        const profileFile = req.files['profile'] ? req.files['profile'][0] : null;

        if (!resumeFile) {
            throw ErrorHandler.createError('Resume file is required', 400, 'MISSING_RESUME_FILE');
        }

        // --- 1. Parse Documents ---
        logger.info('Parsing documents', { userId, filename: resumeFile.originalname });
        const resumeText = await DocumentParsingService.parseDocument(resumeFile);
        const profileText = profileFile ? await DocumentParsingService.parseDocument(profileFile) : "Not provided.";

        // --- 2. Generate Content with AI ---
        logger.info('Generating content with AI', { userId });
        const aiResponse = await AIGenerationService.generateTailoredContent(resumeText, profileText, jobDescription);

        // --- 3. Generate DOCX and PDF Files ---
        logger.info('Generating document files', { userId });
        const { tailoredResume, coverLetter } = aiResponse;
        
        // Generate professionally formatted documents
        const resumeDocuments = await DocumentGenerationService.generateDocuments(tailoredResume, 'resume');
        const coverLetterDocuments = await DocumentGenerationService.generateDocuments(coverLetter, 'coverLetter');
        
        const resumeDocxBuffer = resumeDocuments.docx;
        const resumePdfBuffer = resumeDocuments.pdf;
        const coverLetterDocxBuffer = coverLetterDocuments.docx;
        const coverLetterPdfBuffer = coverLetterDocuments.pdf;

        // --- 4. Deduct Token ---
        const newBalance = await UserRepository.deductTokens(userId, 1);
        
        // --- 5. Record Generation ---
        await GenerationRepository.createGeneration(userId, jobDescription, resumeFile.originalname);
        await GenerationRepository.recordApiUsage(userId, '/generate', 1);

        // --- 6. Send Files Back to Client ---
        logger.info('Sending files to client', { userId, newBalance });
        res.status(200).json({
            resumeDocx: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${resumeDocxBuffer.toString('base64')}`,
            resumePdf: `data:application/pdf;base64,${resumePdfBuffer.toString('base64')}`,
            coverLetterDocx: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${coverLetterDocxBuffer.toString('base64')}`,
            coverLetterPdf: `data:application/pdf;base64,${coverLetterPdfBuffer.toString('base64')}`,
            newTokenBalance: newBalance
        });
    })
);

/**
 * Endpoint: /create-payment-session
 * Method: POST
 * Description: Creates a Stripe Checkout session for purchasing tokens.
 */
app.post('/create-payment-session', 
    authenticateToken, 
    paymentRateLimit,
    [
        body('packageType')
            .optional()
            .isIn(['starter', 'standard', 'premium'])
            .withMessage('Package type must be starter, standard, or premium'),
        ValidationMiddleware.handleValidationErrors
    ],
    ErrorHandler.asyncHandler(async (req, res) => {
        const userId = req.user.id;
        const packageType = req.body.packageType || 'starter';

        const result = await PaymentService.createCheckoutSession(userId, packageType);
        
        res.json({
            sessionId: result.sessionId,
            url: result.url,
            package: result.package
        });
    })
);

/**
 * Endpoint: /payment/packages
 * Method: GET
 * Description: Get available token packages
 */
app.get('/payment/packages', ErrorHandler.asyncHandler(async (req, res) => {
    const packages = PaymentService.getTokenPackages();
    res.json({ packages });
}));

/**
 * Endpoint: /payment/history
 * Method: GET
 * Description: Get user's payment history
 */
app.get('/payment/history', authenticateToken, ErrorHandler.asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const history = await PaymentService.getPaymentHistory(userId);
    res.json({ history });
}));

/**
 * Endpoint: /webhook-payment-success
 * Method: POST
 * Description: Stripe webhook to handle successful payment events.
 */
app.post('/webhook-payment-success', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];

    try {
        const result = await PaymentService.handleWebhook(req.body, sig);
        
        logger.info('Webhook processed successfully', { 
            processed: result.processed,
            message: result.message,
            userId: result.userId,
            tokensAdded: result.tokensAdded
        });
        
        res.json({ received: true, ...result });
        
    } catch (error) {
        logger.error('Webhook processing failed', { error: error.message });
        res.status(400).json({ 
            error: error.message,
            received: false 
        });
    }
});

// --- HELPER FUNCTIONS ---







/**
 * Extract job description from HTML content.
 * @param {string} htmlContent - The HTML content of the job posting page.
 * @returns {string} Extracted job description.
 */
function extractJobFromHTML(htmlContent) {
    // Simple text extraction - remove HTML tags and clean up
    const textContent = htmlContent
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Try to find job-specific sections
    const jobKeywords = ['responsibilities', 'requirements', 'qualifications', 'skills', 'experience'];
    const lines = textContent.split('\n');
    const relevantLines = [];
    
    let foundJobSection = false;
    for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (jobKeywords.some(keyword => lowerLine.includes(keyword))) {
            foundJobSection = true;
        }
        if (foundJobSection && line.trim().length > 20) {
            relevantLines.push(line.trim());
        }
        if (relevantLines.length > 50) break; // Limit length
    }
    
    return relevantLines.length > 0 ? relevantLines.join('\n') : textContent.substring(0, 2000);
}

// --- DEVELOPMENT TEST ENDPOINTS ---
if (process.env.NODE_ENV === 'development') {
    app.get('/test/health', (req, res) => {
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    });
    
    app.post('/test/generate-mock', (req, res) => {
        res.json({
            resumeText: 'Mock resume content',
            aiResponse: {
                tailoredResume: 'Mock tailored resume',
                coverLetter: 'Mock cover letter'
            },
            message: 'This is a test endpoint with mock data'
        });
    });
    
    app.post('/test/parse-document', upload.single('document'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            // Validate file
            DocumentParsingService.validateFile(req.file);
            
            // Get file type info
            const fileTypeInfo = DocumentParsingService.getFileTypeInfo(req.file.mimetype);
            
            // Parse document
            const extractedText = await DocumentParsingService.parseDocument(req.file);
            
            res.json({
                message: 'Document parsed successfully',
                fileInfo: {
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                    type: fileTypeInfo
                },
                extractedText: extractedText.substring(0, 1000) + (extractedText.length > 1000 ? '...' : ''),
                textLength: extractedText.length,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            logger.error('Document parsing test failed', { error: error.message });
            res.status(500).json({ 
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    app.post('/test/ai-generate', async (req, res) => {
        try {
            const { resumeText, jobDescription, profileText } = req.body;
            
            if (!resumeText || !jobDescription) {
                return res.status(400).json({ 
                    error: 'resumeText and jobDescription are required' 
                });
            }
            
            // Test AI generation
            const aiResponse = await AIGenerationService.generateTailoredContent(
                resumeText, 
                profileText || "Not provided.", 
                jobDescription
            );
            
            // Get AI service stats
            const stats = AIGenerationService.getStats();
            
            res.json({
                message: 'AI generation completed successfully',
                result: {
                    tailoredResumeLength: aiResponse.tailoredResume.length,
                    coverLetterLength: aiResponse.coverLetter.length,
                    tailoredResumePreview: aiResponse.tailoredResume.substring(0, 200) + '...',
                    coverLetterPreview: aiResponse.coverLetter.substring(0, 200) + '...'
                },
                aiStats: stats,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            logger.error('AI generation test failed', { error: error.message });
            res.status(500).json({ 
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    app.post('/test/generate-documents', async (req, res) => {
        try {
            const { content, type } = req.body;
            
            if (!content) {
                return res.status(400).json({ 
                    error: 'content is required' 
                });
            }
            
            const documentType = type || 'resume';
            
            // Test document generation
            const documents = await DocumentGenerationService.generateDocuments(content, documentType);
            
            res.json({
                message: 'Documents generated successfully',
                result: {
                    type: documentType,
                    sectionsCount: documents.sections,
                    docxSize: documents.docx.length,
                    pdfSize: documents.pdf.length,
                    docxBase64: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${documents.docx.toString('base64')}`,
                    pdfBase64: `data:application/pdf;base64,${documents.pdf.toString('base64')}`
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            logger.error('Document generation test failed', { error: error.message });
            res.status(500).json({ 
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
}

// --- MONITORING AND HEALTH CHECK ENDPOINTS ---

/**
 * Endpoint: /health
 * Method: GET
 * Description: Comprehensive health check endpoint
 */
app.get('/health', ErrorHandler.asyncHandler(async (req, res) => {
    const healthReport = await MonitoringService.performHealthCheck();
    
    // Set appropriate HTTP status based on health
    const statusCode = healthReport.status === 'healthy' ? 200 : 
                      healthReport.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(healthReport);
}));

/**
 * Endpoint: /health/quick
 * Method: GET
 * Description: Quick health check for load balancers
 */
app.get('/health/quick', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: MonitoringService.getUptime().formatted
    });
});

/**
 * Endpoint: /metrics
 * Method: GET
 * Description: Application metrics and statistics
 */
app.get('/metrics', ErrorHandler.asyncHandler(async (req, res) => {
    const metrics = MonitoringService.getMetrics();
    res.json(metrics);
}));

/**
 * Endpoint: /status
 * Method: GET
 * Description: System status and information
 */
app.get('/status', ErrorHandler.asyncHandler(async (req, res) => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
        status: 'running',
        timestamp: new Date().toISOString(),
        uptime: MonitoringService.getUptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        node: {
            version: process.version,
            platform: process.platform,
            architecture: process.arch,
            pid: process.pid
        },
        memory: {
            heap: {
                used: MonitoringService.formatBytes(memoryUsage.heapUsed),
                total: MonitoringService.formatBytes(memoryUsage.heapTotal),
                percent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
            },
            rss: MonitoringService.formatBytes(memoryUsage.rss),
            external: MonitoringService.formatBytes(memoryUsage.external)
        },
        cpu: cpuUsage,
        loadAverage: require('os').loadavg()
    });
}));

// --- GLOBAL ERROR HANDLING ---

// 404 handler - must be after all routes
app.use(ErrorHandler.notFoundHandler);

// Global error handler - must be last middleware
app.use(ErrorHandler.globalErrorHandler);

// --- START SERVER ---
async function startServer() {
    try {
        // Validate configuration before starting
        await validateStartupConfig();
        
        app.listen(PORT, () => {
            logger.info(`Server is running on http://0.0.0.0:${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        logger.error('Failed to start server', error);
        process.exit(1);
    }
}

startServer();