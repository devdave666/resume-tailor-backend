// scripts/setup-db.js
// Database setup and initialization script

const { testConnection, validateConfig, logger, closePool } = require('../config/database');
const { runMigrations } = require('./migrate');

async function setupDatabase() {
    try {
        logger.info('Starting database setup...');

        // Step 1: Validate configuration
        logger.info('Validating database configuration...');
        if (!validateConfig()) {
            logger.error('Database configuration validation failed');
            logger.info('Please check your .env file and ensure all required database variables are set:');
            logger.info('- DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD');
            process.exit(1);
        }
        logger.info('✓ Database configuration is valid');

        // Step 2: Test connection
        logger.info('Testing database connection...');
        const connected = await testConnection();
        if (!connected) {
            logger.error('Could not connect to database');
            logger.info('Please ensure:');
            logger.info('1. PostgreSQL is running');
            logger.info('2. Database exists (create it if needed)');
            logger.info('3. User has proper permissions');
            process.exit(1);
        }
        logger.info('✓ Database connection successful');

        // Step 3: Run migrations
        logger.info('Running database migrations...');
        await runMigrations();
        logger.info('✓ Database migrations completed');

        logger.info('🎉 Database setup completed successfully!');
        logger.info('You can now start the server with: npm run dev');

    } catch (error) {
        logger.error('Database setup failed', error);
        process.exit(1);
    } finally {
        await closePool();
    }
}

// Run setup if this script is executed directly
if (require.main === module) {
    setupDatabase();
}

module.exports = { setupDatabase };