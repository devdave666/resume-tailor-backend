// scripts/migrate.js
// Database migration script

const fs = require('fs');
const path = require('path');
const { query, testConnection, closePool, validateConfig, logger } = require('../config/database');

async function runMigrations() {
    try {
        // Validate configuration
        if (!validateConfig()) {
            logger.error('Database configuration validation failed');
            process.exit(1);
        }

        // Test connection
        const connected = await testConnection();
        if (!connected) {
            logger.error('Could not connect to database');
            process.exit(1);
        }

        // Read migration files
        const migrationsDir = path.join(__dirname, '../migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        if (migrationFiles.length === 0) {
            logger.info('No migration files found');
            return;
        }

        logger.info(`Found ${migrationFiles.length} migration files`);

        // Run each migration
        for (const file of migrationFiles) {
            const filePath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(filePath, 'utf8');
            
            logger.info(`Running migration: ${file}`);
            
            try {
                await query(sql);
                logger.info(`Migration completed: ${file}`);
            } catch (error) {
                logger.error(`Migration failed: ${file}`, error);
                throw error;
            }
        }

        logger.info('All migrations completed successfully');

    } catch (error) {
        logger.error('Migration process failed', error);
        process.exit(1);
    } finally {
        await closePool();
    }
}

// Run migrations if this script is executed directly
if (require.main === module) {
    runMigrations();
}

module.exports = { runMigrations };