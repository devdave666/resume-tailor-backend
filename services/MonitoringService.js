// services/MonitoringService.js
// Comprehensive monitoring and health check service

const os = require('os');
const { logger } = require('../config/database');
const { testConnection } = require('../config/database');
const AIGenerationService = require('./AIGenerationService');
const PaymentService = require('./PaymentService');

class MonitoringService {
    
    constructor() {
        this.startTime = Date.now();
        this.healthChecks = new Map();
        this.metrics = {
            requests: {
                total: 0,
                successful: 0,
                failed: 0,
                byEndpoint: new Map()
            },
            performance: {
                averageResponseTime: 0,
                slowestEndpoint: null,
                fastestEndpoint: null
            },
            errors: {
                total: 0,
                byType: new Map(),
                recent: []
            },
            system: {
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                uptime: process.uptime()
            }
        };
        
        // Start periodic system monitoring
        this.startSystemMonitoring();
    }

    /**
     * Comprehensive health check
     * @returns {Promise<Object>} Health check results
     */
    async performHealthCheck() {
        const startTime = Date.now();
        const checks = {};
        let overallStatus = 'healthy';
        
        try {
            // Database health check
            checks.database = await this.checkDatabase();
            
            // External services health check
            checks.externalServices = await this.checkExternalServices();
            
            // System resources health check
            checks.system = await this.checkSystemResources();
            
            // Application health check
            checks.application = await this.checkApplicationHealth();
            
            // Determine overall status
            const failedChecks = Object.values(checks).filter(check => check.status !== 'healthy');
            if (failedChecks.length > 0) {
                overallStatus = failedChecks.some(check => check.status === 'critical') ? 'critical' : 'degraded';
            }
            
            const responseTime = Date.now() - startTime;
            
            const healthReport = {
                status: overallStatus,
                timestamp: new Date().toISOString(),
                uptime: this.getUptime(),
                responseTime: `${responseTime}ms`,
                version: process.env.npm_package_version || '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                checks,
                summary: {
                    total: Object.keys(checks).length,
                    healthy: Object.values(checks).filter(c => c.status === 'healthy').length,
                    degraded: Object.values(checks).filter(c => c.status === 'degraded').length,
                    critical: Object.values(checks).filter(c => c.status === 'critical').length
                }
            };
            
            // Log health check results
            if (overallStatus !== 'healthy') {
                logger.warn('Health check failed', { status: overallStatus, failedChecks });
            } else {
                logger.debug('Health check passed', { responseTime });
            }
            
            return healthReport;
            
        } catch (error) {
            logger.error('Health check error', { error: error.message });
            return {
                status: 'critical',
                timestamp: new Date().toISOString(),
                error: error.message,
                uptime: this.getUptime()
            };
        }
    }

    /**
     * Check database connectivity and performance
     * @returns {Promise<Object>} Database health status
     */
    async checkDatabase() {
        const startTime = Date.now();
        
        try {
            const connected = await testConnection();
            const responseTime = Date.now() - startTime;
            
            if (!connected) {
                return {
                    status: 'critical',
                    message: 'Database connection failed',
                    responseTime: `${responseTime}ms`
                };
            }
            
            // Check response time
            let status = 'healthy';
            let message = 'Database connection successful';
            
            if (responseTime > 5000) {
                status = 'critical';
                message = 'Database response time critical (>5s)';
            } else if (responseTime > 1000) {
                status = 'degraded';
                message = 'Database response time slow (>1s)';
            }
            
            return {
                status,
                message,
                responseTime: `${responseTime}ms`,
                details: {
                    host: process.env.DB_HOST,
                    database: process.env.DB_NAME,
                    ssl: process.env.DB_SSL_CA ? 'enabled' : 'disabled'
                }
            };
            
        } catch (error) {
            return {
                status: 'critical',
                message: 'Database health check failed',
                error: error.message,
                responseTime: `${Date.now() - startTime}ms`
            };
        }
    }

    /**
     * Check external services (APIs)
     * @returns {Promise<Object>} External services health status
     */
    async checkExternalServices() {
        const services = {};
        
        // Check AI service configuration
        try {
            const aiConfigValid = AIGenerationService.validateConfiguration();
            services.geminiAI = {
                status: aiConfigValid ? 'healthy' : 'degraded',
                message: aiConfigValid ? 'AI service configured' : 'AI service configuration invalid',
                details: {
                    configured: !!process.env.GEMINI_API_KEY,
                    keyValid: process.env.GEMINI_API_KEY !== 'your-gemini-api-key-here'
                }
            };
        } catch (error) {
            services.geminiAI = {
                status: 'critical',
                message: 'AI service check failed',
                error: error.message
            };
        }
        
        // Check payment service configuration
        try {
            const paymentConfigValid = PaymentService.validateConfiguration();
            services.stripe = {
                status: paymentConfigValid ? 'healthy' : 'degraded',
                message: paymentConfigValid ? 'Payment service configured' : 'Payment service configuration invalid',
                details: {
                    configured: !!process.env.STRIPE_SECRET_KEY,
                    webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
                    environment: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test'
                }
            };
        } catch (error) {
            services.stripe = {
                status: 'critical',
                message: 'Payment service check failed',
                error: error.message
            };
        }
        
        // Check PDF.co service (if configured)
        services.pdfCo = {
            status: process.env.PDF_CO_API_KEY && process.env.PDF_CO_API_KEY !== 'test-placeholder-key-for-testing' ? 'healthy' : 'degraded',
            message: process.env.PDF_CO_API_KEY ? 'PDF service configured' : 'PDF service not configured',
            details: {
                configured: !!process.env.PDF_CO_API_KEY,
                isPlaceholder: process.env.PDF_CO_API_KEY === 'test-placeholder-key-for-testing'
            }
        };
        
        // Determine overall external services status
        const statuses = Object.values(services).map(s => s.status);
        const overallStatus = statuses.includes('critical') ? 'critical' : 
                            statuses.includes('degraded') ? 'degraded' : 'healthy';
        
        return {
            status: overallStatus,
            message: `External services ${overallStatus}`,
            services
        };
    }

    /**
     * Check system resources
     * @returns {Promise<Object>} System health status
     */
    async checkSystemResources() {
        try {
            const memoryUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            const systemMemory = {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem()
            };
            
            // Calculate memory usage percentages
            const heapUsedPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
            const systemMemoryPercent = (systemMemory.used / systemMemory.total) * 100;
            
            // Determine status based on resource usage
            let status = 'healthy';
            let warnings = [];
            
            if (heapUsedPercent > 90) {
                status = 'critical';
                warnings.push('Heap memory usage critical (>90%)');
            } else if (heapUsedPercent > 80) {
                status = 'degraded';
                warnings.push('Heap memory usage high (>80%)');
            }
            
            if (systemMemoryPercent > 95) {
                status = 'critical';
                warnings.push('System memory usage critical (>95%)');
            } else if (systemMemoryPercent > 85) {
                status = status === 'critical' ? 'critical' : 'degraded';
                warnings.push('System memory usage high (>85%)');
            }
            
            return {
                status,
                message: warnings.length > 0 ? warnings.join(', ') : 'System resources healthy',
                details: {
                    memory: {
                        heap: {
                            used: this.formatBytes(memoryUsage.heapUsed),
                            total: this.formatBytes(memoryUsage.heapTotal),
                            percent: Math.round(heapUsedPercent)
                        },
                        system: {
                            used: this.formatBytes(systemMemory.used),
                            total: this.formatBytes(systemMemory.total),
                            free: this.formatBytes(systemMemory.free),
                            percent: Math.round(systemMemoryPercent)
                        },
                        rss: this.formatBytes(memoryUsage.rss),
                        external: this.formatBytes(memoryUsage.external)
                    },
                    cpu: {
                        user: cpuUsage.user,
                        system: cpuUsage.system,
                        loadAverage: os.loadavg()
                    },
                    uptime: {
                        process: this.formatUptime(process.uptime()),
                        system: this.formatUptime(os.uptime())
                    }
                }
            };
            
        } catch (error) {
            return {
                status: 'critical',
                message: 'System resource check failed',
                error: error.message
            };
        }
    }

    /**
     * Check application-specific health
     * @returns {Promise<Object>} Application health status
     */
    async checkApplicationHealth() {
        try {
            const issues = [];
            
            // Check environment variables
            const requiredEnvVars = ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER'];
            const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
            
            if (missingEnvVars.length > 0) {
                issues.push(`Missing environment variables: ${missingEnvVars.join(', ')}`);
            }
            
            // Check JWT secret strength
            if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
                issues.push('JWT secret is too short (should be 32+ characters)');
            }
            
            // Check if in production with test keys
            if (process.env.NODE_ENV === 'production') {
                if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
                    issues.push('Using test Stripe key in production');
                }
                if (process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
                    issues.push('Using placeholder Gemini API key');
                }
            }
            
            const status = issues.length === 0 ? 'healthy' : 'degraded';
            
            return {
                status,
                message: status === 'healthy' ? 'Application configuration healthy' : 'Application configuration issues detected',
                issues: issues.length > 0 ? issues : undefined,
                details: {
                    nodeVersion: process.version,
                    platform: process.platform,
                    architecture: process.arch,
                    environment: process.env.NODE_ENV || 'development',
                    pid: process.pid,
                    uptime: this.formatUptime(process.uptime())
                }
            };
            
        } catch (error) {
            return {
                status: 'critical',
                message: 'Application health check failed',
                error: error.message
            };
        }
    }

    /**
     * Get application metrics
     * @returns {Object} Application metrics
     */
    getMetrics() {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            timestamp: new Date().toISOString(),
            uptime: this.getUptime(),
            requests: {
                ...this.metrics.requests,
                byEndpoint: Object.fromEntries(this.metrics.requests.byEndpoint)
            },
            performance: this.metrics.performance,
            errors: {
                ...this.metrics.errors,
                byType: Object.fromEntries(this.metrics.errors.byType),
                recent: this.metrics.errors.recent.slice(-10) // Last 10 errors
            },
            system: {
                memory: {
                    heap: {
                        used: this.formatBytes(memoryUsage.heapUsed),
                        total: this.formatBytes(memoryUsage.heapTotal)
                    },
                    rss: this.formatBytes(memoryUsage.rss),
                    external: this.formatBytes(memoryUsage.external)
                },
                cpu: cpuUsage,
                loadAverage: os.loadavg(),
                platform: process.platform,
                nodeVersion: process.version
            }
        };
    }

    /**
     * Record request metrics
     * @param {string} endpoint - API endpoint
     * @param {number} responseTime - Response time in ms
     * @param {boolean} success - Whether request was successful
     */
    recordRequest(endpoint, responseTime, success = true) {
        this.metrics.requests.total++;
        
        if (success) {
            this.metrics.requests.successful++;
        } else {
            this.metrics.requests.failed++;
        }
        
        // Track by endpoint
        const endpointStats = this.metrics.requests.byEndpoint.get(endpoint) || {
            count: 0,
            totalTime: 0,
            averageTime: 0,
            successful: 0,
            failed: 0
        };
        
        endpointStats.count++;
        endpointStats.totalTime += responseTime;
        endpointStats.averageTime = Math.round(endpointStats.totalTime / endpointStats.count);
        
        if (success) {
            endpointStats.successful++;
        } else {
            endpointStats.failed++;
        }
        
        this.metrics.requests.byEndpoint.set(endpoint, endpointStats);
        
        // Update performance metrics
        this.updatePerformanceMetrics(endpoint, responseTime);
    }

    /**
     * Record error metrics
     * @param {Error} error - Error object
     * @param {string} endpoint - API endpoint where error occurred
     */
    recordError(error, endpoint = 'unknown') {
        this.metrics.errors.total++;
        
        const errorType = error.name || 'UnknownError';
        const currentCount = this.metrics.errors.byType.get(errorType) || 0;
        this.metrics.errors.byType.set(errorType, currentCount + 1);
        
        // Add to recent errors (keep last 50)
        this.metrics.errors.recent.push({
            timestamp: new Date().toISOString(),
            endpoint,
            type: errorType,
            message: error.message,
            stack: error.stack?.split('\n')[0] // First line of stack trace
        });
        
        if (this.metrics.errors.recent.length > 50) {
            this.metrics.errors.recent = this.metrics.errors.recent.slice(-50);
        }
    }

    /**
     * Update performance metrics
     * @param {string} endpoint - API endpoint
     * @param {number} responseTime - Response time in ms
     */
    updatePerformanceMetrics(endpoint, responseTime) {
        // Update average response time
        const totalRequests = this.metrics.requests.total;
        const currentAverage = this.metrics.performance.averageResponseTime;
        this.metrics.performance.averageResponseTime = Math.round(
            ((currentAverage * (totalRequests - 1)) + responseTime) / totalRequests
        );
        
        // Update slowest endpoint
        if (!this.metrics.performance.slowestEndpoint || 
            responseTime > this.metrics.performance.slowestEndpoint.time) {
            this.metrics.performance.slowestEndpoint = {
                endpoint,
                time: responseTime,
                timestamp: new Date().toISOString()
            };
        }
        
        // Update fastest endpoint
        if (!this.metrics.performance.fastestEndpoint || 
            responseTime < this.metrics.performance.fastestEndpoint.time) {
            this.metrics.performance.fastestEndpoint = {
                endpoint,
                time: responseTime,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Start periodic system monitoring
     */
    startSystemMonitoring() {
        setInterval(() => {
            this.metrics.system = {
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage(),
                uptime: process.uptime()
            };
        }, 30000); // Update every 30 seconds
    }

    /**
     * Get formatted uptime
     * @returns {Object} Formatted uptime
     */
    getUptime() {
        const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        return {
            seconds: uptimeSeconds,
            formatted: this.formatUptime(uptimeSeconds)
        };
    }

    /**
     * Format uptime in human readable format
     * @param {number} seconds - Uptime in seconds
     * @returns {string} Formatted uptime
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m ${secs}s`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    /**
     * Format bytes in human readable format
     * @param {number} bytes - Bytes to format
     * @returns {string} Formatted bytes
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = new MonitoringService();