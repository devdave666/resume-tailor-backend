// Database Configuration and Connection Management
// Handles PostgreSQL connections, pooling, and health checks

const { Pool } = require('pg');
const winston = require('winston');
const ProductionConfig = require('./production');

// Configure logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.simple()
        })
    ]
});

class DatabaseManager {
    constructor() {
        this.pool = null;
        this.config = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.retryDelay = 5000; // 5 seconds
    }

    /**
     * Initialize database configuration
     */
    initializeConfig() {
        this.config = ProductionConfig.getDatabaseConfig();
        
        // Validate required configuration
        if (!this.config.password) {
            throw new Error('Database password is required');
        }

        logger.info('Database configuration initialized', {
            host: this.config.host,
            port: this.config.port,
            database: this.config.database,
            user: this.config.user,
            ssl: !!this.config.ssl,
            poolMax: this.config.max,
            poolMin: this.config.min
        });
    }

    /**
     * Create database connection pool
     */
    createPool() {
        if (!this.config) {
            this.initializeConfig();
        }

        this.pool = new Pool(this.config);

        // Handle pool events
        this.pool.on('connect', (client) => {
            logger.debug('New database client connected', {
                processId: client.processID,
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount,
                waitingCount: this.pool.waitingCount
            });
        });

        this.pool.on('acquire', (client) => {
            logger.debug('Database client acquired from pool', {
                processId: client.processID,
                totalCount: this.pool.totalCount,
                idleCount: this.pool.idleCount
            });
        });

        this.pool.on('remove', (client) => {
            logger.debug('Database client removed from pool', {
                processId: client.processID,
                totalCount: this.pool.totalCount
            });
        });

        this.pool.on('error', (err, client) => {
            logger.error('Database pool error', {
                error: err.message,
                stack: err.stack,
                processId: client?.processID
            });
        });

        logger.info('Database connection pool created');
        return this.pool;
    }

    /**
     * Test database connection
     */
    async testConnection() {
        try {
            if (!this.pool) {
                this.createPool();
            }

            const client = await this.pool.connect();
            
            try {
                // Test basic connectivity
                const result = await client.query('SELECT NOW() as current_time, version() as version');
                const { current_time, version } = result.rows[0];
                
                // Test database permissions
                await client.query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1', ['public']);
                
                this.isConnected = true;
                this.connectionAttempts = 0;
                
                logger.info('Database connection test successful', {
                    currentTime: current_time,
                    version: version.split(' ')[0] + ' ' + version.split(' ')[1],
                    totalConnections: this.pool.totalCount,
                    idleConnections: this.pool.idleCount
                });
                
                return true;
            } finally {
                client.release();
            }
        } catch (error) {
            this.isConnected = false;
            this.connectionAttempts++;
            
            logger.error('Database connection test failed', {
                error: error.message,
                code: error.code,
                attempts: this.connectionAttempts,
                maxRetries: this.maxRetries
            });
            
            return false;
        }
    }

    /**
     * Connect to database with retry logic
     */
    async connect() {
        while (this.connectionAttempts < this.maxRetries) {
            const success = await this.testConnection();
            
            if (success) {
                return this.pool;
            }
            
            if (this.connectionAttempts < this.maxRetries) {
                logger.warn(`Database connection failed, retrying in ${this.retryDelay}ms...`, {
                    attempt: this.connectionAttempts,
                    maxRetries: this.maxRetries
                });
                
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                this.retryDelay = Math.min(this.retryDelay * 1.5, 30000); // Exponential backoff, max 30s
            }
        }
        
        throw new Error(`Failed to connect to database after ${this.maxRetries} attempts`);
    }

    /**
     * Execute query with error handling and logging
     */
    async query(text, params = []) {
        const start = Date.now();
        
        try {
            if (!this.pool || !this.isConnected) {
                await this.connect();
            }
            
            const result = await this.pool.query(text, params);
            const duration = Date.now() - start;
            
            logger.debug('Database query executed', {
                query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
                params: params.length,
                rows: result.rowCount,
                duration: `${duration}ms`
            });
            
            return result;
        } catch (error) {
            const duration = Date.now() - start;
            
            logger.error('Database query failed', {
                query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
                params: params.length,
                error: error.message,
                code: error.code,
                duration: `${duration}ms`
            });
            
            throw error;
        }
    }

    /**
     * Execute transaction with automatic rollback on error
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        
        try {
            await client.query('BEGIN');
            
            const result = await callback(client);
            
            await client.query('COMMIT');
            
            logger.debug('Database transaction committed successfully');
            
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            
            logger.error('Database transaction rolled back', {
                error: error.message,
                code: error.code
            });
            
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get database health status
     */
    async getHealthStatus() {
        try {
            const start = Date.now();
            
            if (!this.pool) {
                return {
                    status: 'disconnected',
                    message: 'Database pool not initialized'
                };
            }
            
            const client = await this.pool.connect();
            
            try {
                // Test query performance
                await client.query('SELECT 1');
                const responseTime = Date.now() - start;
                
                // Get connection pool stats
                const poolStats = {
                    totalConnections: this.pool.totalCount,
                    idleConnections: this.pool.idleCount,
                    waitingCount: this.pool.waitingCount
                };
                
                // Get database stats
                const dbStats = await client.query(`
                    SELECT 
                        numbackends as active_connections,
                        xact_commit as transactions_committed,
                        xact_rollback as transactions_rolled_back,
                        blks_read as blocks_read,
                        blks_hit as blocks_hit,
                        tup_returned as tuples_returned,
                        tup_fetched as tuples_fetched,
                        tup_inserted as tuples_inserted,
                        tup_updated as tuples_updated,
                        tup_deleted as tuples_deleted
                    FROM pg_stat_database 
                    WHERE datname = current_database()
                `);
                
                const stats = dbStats.rows[0];
                const hitRatio = stats.blocks_hit / (stats.blocks_read + stats.blocks_hit) * 100;
                
                return {
                    status: 'healthy',
                    responseTime: `${responseTime}ms`,
                    pool: poolStats,
                    database: {
                        activeConnections: parseInt(stats.active_connections),
                        transactionsCommitted: parseInt(stats.transactions_committed),
                        transactionsRolledBack: parseInt(stats.transactions_rolled_back),
                        cacheHitRatio: `${hitRatio.toFixed(2)}%`,
                        tuplesReturned: parseInt(stats.tuples_returned),
                        tuplesInserted: parseInt(stats.tuples_inserted),
                        tuplesUpdated: parseInt(stats.tuples_updated),
                        tuplesDeleted: parseInt(stats.tuples_deleted)
                    }
                };
            } finally {
                client.release();
            }
        } catch (error) {
            logger.error('Database health check failed', {
                error: error.message,
                code: error.code
            });
            
            return {
                status: 'unhealthy',
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Close database connections
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
            this.isConnected = false;
            
            logger.info('Database connections closed');
        }
    }

    /**
     * Get connection pool statistics
     */
    getPoolStats() {
        if (!this.pool) {
            return null;
        }
        
        return {
            totalCount: this.pool.totalCount,
            idleCount: this.pool.idleCount,
            waitingCount: this.pool.waitingCount,
            maxConnections: this.config.max,
            minConnections: this.config.min
        };
    }
}

// Create singleton instance
const dbManager = new DatabaseManager();

// Export functions for backward compatibility
module.exports = {
    // Database manager instance
    dbManager,
    
    // Legacy functions
    testConnection: () => dbManager.testConnection(),
    validateConfig: () => {
        try {
            dbManager.initializeConfig();
            return true;
        } catch (error) {
            logger.error('Database configuration validation failed', { error: error.message });
            return false;
        }
    },
    query: (text, params) => dbManager.query(text, params),
    transaction: (callback) => dbManager.transaction(callback),
    getPool: () => dbManager.pool || dbManager.createPool(),
    close: () => dbManager.close(),
    
    // Logger instance
    logger
};