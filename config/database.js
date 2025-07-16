// config/database.js
// Database configuration and connection management

const { Pool } = require('pg');
const winston = require('winston');

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
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'resume_tailor',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    maxUses: 7500, // Close (and replace) a connection after it has been used 7500 times
};

// Create connection pool
const pool = new Pool(dbConfig);

// Handle pool errors
pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Test database connection
async function testConnection() {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        client.release();
        logger.info('Database connection successful', { timestamp: result.rows[0].now });
        return true;
    } catch (err) {
        logger.error('Database connection failed', err);
        return false;
    }
}

// Execute query with error handling
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        logger.debug('Executed query', { text, duration, rows: res.rowCount });
        return res;
    } catch (err) {
        const duration = Date.now() - start;
        logger.error('Query error', { text, duration, error: err.message });
        throw err;
    }
}

// Get a client from the pool for transactions
async function getClient() {
    return await pool.connect();
}

// Close all connections
async function closePool() {
    try {
        await pool.end();
        logger.info('Database pool closed');
    } catch (err) {
        logger.error('Error closing database pool', err);
    }
}

// Validate required environment variables
function validateConfig() {
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        logger.error('Missing required database environment variables', { missing });
        return false;
    }
    
    return true;
}

module.exports = {
    pool,
    query,
    getClient,
    testConnection,
    closePool,
    validateConfig,
    logger
};