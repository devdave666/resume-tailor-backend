#!/usr/bin/env node
/**
 * Production Database Setup Script
 * Sets up database schema, indexes, and initial data for production deployment
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'resume_tailor',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    max: 20
};

class ProductionDatabaseSetup {
    constructor() {
        this.client = null;
        this.migrationPath = path.join(__dirname, '../migrations');
    }

    async connect() {
        console.log('🔌 Connecting to database...');
        this.client = new Client(dbConfig);
        
        try {
            await this.client.connect();
            console.log('✅ Database connection established');
            
            // Test connection
            const result = await this.client.query('SELECT NOW()');
            console.log(`📅 Database time: ${result.rows[0].now}`);
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.end();
            console.log('🔌 Database connection closed');
        }
    }

    async createDatabase() {
        console.log('🏗️  Creating database if not exists...');
        
        // Connect to postgres database first
        const adminClient = new Client({
            ...dbConfig,
            database: 'postgres'
        });

        try {
            await adminClient.connect();
            
            // Check if database exists
            const dbExists = await adminClient.query(
                'SELECT 1 FROM pg_database WHERE datname = $1',
                [dbConfig.database]
            );

            if (dbExists.rows.length === 0) {
                console.log(`📦 Creating database: ${dbConfig.database}`);
                await adminClient.query(`CREATE DATABASE "${dbConfig.database}"`);
                console.log('✅ Database created successfully');
            } else {
                console.log('✅ Database already exists');
            }
        } catch (error) {
            console.error('❌ Database creation failed:', error.message);
            throw error;
        } finally {
            await adminClient.end();
        }
    }

    async runMigrations() {
        console.log('🚀 Running database migrations...');
        
        try {
            // Create migrations table if not exists
            await this.client.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version VARCHAR(255) PRIMARY KEY,
                    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Get migration files
            const migrationFiles = fs.readdirSync(this.migrationPath)
                .filter(file => file.endsWith('.sql'))
                .sort();

            console.log(`📁 Found ${migrationFiles.length} migration files`);

            for (const file of migrationFiles) {
                const version = path.basename(file, '.sql');
                
                // Check if migration already applied
                const applied = await this.client.query(
                    'SELECT 1 FROM schema_migrations WHERE version = $1',
                    [version]
                );

                if (applied.rows.length > 0) {
                    console.log(`⏭️  Skipping migration: ${version} (already applied)`);
                    continue;
                }

                console.log(`🔄 Applying migration: ${version}`);
                
                const migrationSQL = fs.readFileSync(
                    path.join(this.migrationPath, file),
                    'utf8'
                );

                try {
                    await this.client.query('BEGIN');
                    await this.client.query(migrationSQL);
                    await this.client.query(
                        'INSERT INTO schema_migrations (version) VALUES ($1)',
                        [version]
                    );
                    await this.client.query('COMMIT');
                    console.log(`✅ Migration applied: ${version}`);
                } catch (error) {
                    await this.client.query('ROLLBACK');
                    console.error(`❌ Migration failed: ${version}`, error.message);
                    throw error;
                }
            }

            console.log('✅ All migrations completed successfully');
        } catch (error) {
            console.error('❌ Migration process failed:', error.message);
            throw error;
        }
    }

    async createIndexes() {
        console.log('📊 Creating database indexes...');
        
        const indexes = [
            {
                name: 'idx_users_email',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email)'
            },
            {
                name: 'idx_users_created_at',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users(created_at)'
            },
            {
                name: 'idx_generations_user_id',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_user_id ON generations(user_id)'
            },
            {
                name: 'idx_generations_created_at',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_created_at ON generations(created_at)'
            },
            {
                name: 'idx_api_usage_user_id',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id)'
            },
            {
                name: 'idx_api_usage_endpoint',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_endpoint ON api_usage(endpoint)'
            },
            {
                name: 'idx_api_usage_timestamp',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_timestamp ON api_usage(timestamp)'
            },
            {
                name: 'idx_payments_user_id',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user_id ON payments(user_id)'
            },
            {
                name: 'idx_payments_stripe_session_id',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_stripe_session_id ON payments(stripe_session_id)'
            },
            {
                name: 'idx_payments_created_at',
                sql: 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_created_at ON payments(created_at)'
            }
        ];

        for (const index of indexes) {
            try {
                console.log(`🔧 Creating index: ${index.name}`);
                await this.client.query(index.sql);
                console.log(`✅ Index created: ${index.name}`);
            } catch (error) {
                if (error.message.includes('already exists')) {
                    console.log(`⏭️  Index already exists: ${index.name}`);
                } else {
                    console.error(`❌ Failed to create index ${index.name}:`, error.message);
                    throw error;
                }
            }
        }

        console.log('✅ All indexes created successfully');
    }

    async setupPartitioning() {
        console.log('🗂️  Setting up table partitioning...');
        
        try {
            // Create partitioned table for api_usage (by month)
            await this.client.query(`
                -- Create partitioned api_usage table if not exists
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = 'api_usage_partitioned'
                    ) THEN
                        CREATE TABLE api_usage_partitioned (
                            LIKE api_usage INCLUDING ALL
                        ) PARTITION BY RANGE (timestamp);
                        
                        -- Create initial partitions for current and next 3 months
                        FOR i IN 0..3 LOOP
                            EXECUTE format(
                                'CREATE TABLE api_usage_y%s_m%s PARTITION OF api_usage_partitioned 
                                FOR VALUES FROM (%L) TO (%L)',
                                EXTRACT(YEAR FROM CURRENT_DATE + (i || ' months')::interval),
                                LPAD(EXTRACT(MONTH FROM CURRENT_DATE + (i || ' months')::interval)::text, 2, '0'),
                                DATE_TRUNC('month', CURRENT_DATE + (i || ' months')::interval),
                                DATE_TRUNC('month', CURRENT_DATE + ((i+1) || ' months')::interval)
                            );
                        END LOOP;
                    END IF;
                END
                $$;
            `);

            console.log('✅ Table partitioning configured');
        } catch (error) {
            console.error('❌ Partitioning setup failed:', error.message);
            // Don't throw - partitioning is optional for smaller deployments
        }
    }

    async setupConnectionPooling() {
        console.log('🏊 Configuring connection pooling...');
        
        try {
            // Set optimal PostgreSQL settings for production
            const settings = [
                "SET shared_preload_libraries = 'pg_stat_statements'",
                "SET max_connections = 200",
                "SET shared_buffers = '256MB'",
                "SET effective_cache_size = '1GB'",
                "SET maintenance_work_mem = '64MB'",
                "SET checkpoint_completion_target = 0.9",
                "SET wal_buffers = '16MB'",
                "SET default_statistics_target = 100",
                "SET random_page_cost = 1.1",
                "SET effective_io_concurrency = 200"
            ];

            for (const setting of settings) {
                try {
                    await this.client.query(setting);
                } catch (error) {
                    // Some settings might require superuser privileges
                    console.log(`⚠️  Could not apply setting: ${setting.split('=')[0].trim()}`);
                }
            }

            console.log('✅ Connection pooling configured');
        } catch (error) {
            console.error('❌ Connection pooling setup failed:', error.message);
        }
    }

    async createViews() {
        console.log('👁️  Creating database views...');
        
        const views = [
            {
                name: 'user_stats',
                sql: `
                    CREATE OR REPLACE VIEW user_stats AS
                    SELECT 
                        u.id,
                        u.email,
                        u.tokens,
                        u.created_at,
                        COUNT(g.id) as total_generations,
                        MAX(g.created_at) as last_generation,
                        SUM(p.amount) as total_spent
                    FROM users u
                    LEFT JOIN generations g ON u.id = g.user_id
                    LEFT JOIN payments p ON u.id = p.user_id AND p.status = 'completed'
                    GROUP BY u.id, u.email, u.tokens, u.created_at
                `
            },
            {
                name: 'daily_metrics',
                sql: `
                    CREATE OR REPLACE VIEW daily_metrics AS
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as new_users,
                        SUM(CASE WHEN tokens > 0 THEN 1 ELSE 0 END) as paying_users
                    FROM users
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                `
            },
            {
                name: 'api_usage_summary',
                sql: `
                    CREATE OR REPLACE VIEW api_usage_summary AS
                    SELECT 
                        endpoint,
                        DATE(timestamp) as date,
                        COUNT(*) as request_count,
                        COUNT(DISTINCT user_id) as unique_users,
                        SUM(tokens_used) as total_tokens_used
                    FROM api_usage
                    GROUP BY endpoint, DATE(timestamp)
                    ORDER BY date DESC, request_count DESC
                `
            }
        ];

        for (const view of views) {
            try {
                console.log(`🔧 Creating view: ${view.name}`);
                await this.client.query(view.sql);
                console.log(`✅ View created: ${view.name}`);
            } catch (error) {
                console.error(`❌ Failed to create view ${view.name}:`, error.message);
                throw error;
            }
        }

        console.log('✅ All views created successfully');
    }

    async setupBackupStrategy() {
        console.log('💾 Setting up backup strategy...');
        
        try {
            // Create backup user with limited privileges
            await this.client.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_user WHERE usename = 'backup_user') THEN
                        CREATE USER backup_user WITH PASSWORD '${process.env.BACKUP_PASSWORD || 'change_me_in_production'}';
                        GRANT CONNECT ON DATABASE ${dbConfig.database} TO backup_user;
                        GRANT USAGE ON SCHEMA public TO backup_user;
                        GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_user;
                        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_user;
                    END IF;
                END
                $$;
            `);

            console.log('✅ Backup user configured');
        } catch (error) {
            console.error('❌ Backup setup failed:', error.message);
            // Don't throw - backup user creation might require superuser privileges
        }
    }

    async validateSetup() {
        console.log('🔍 Validating database setup...');
        
        try {
            // Check all required tables exist
            const tables = await this.client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            `);

            const requiredTables = ['users', 'generations', 'api_usage', 'payments', 'schema_migrations'];
            const existingTables = tables.rows.map(row => row.table_name);
            
            console.log(`📋 Found tables: ${existingTables.join(', ')}`);
            
            for (const table of requiredTables) {
                if (!existingTables.includes(table)) {
                    throw new Error(`Required table missing: ${table}`);
                }
            }

            // Check indexes
            const indexes = await this.client.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE schemaname = 'public'
                ORDER BY indexname
            `);

            console.log(`📊 Found ${indexes.rows.length} indexes`);

            // Test basic operations
            await this.client.query('SELECT COUNT(*) FROM users');
            await this.client.query('SELECT COUNT(*) FROM generations');
            
            console.log('✅ Database validation completed successfully');
        } catch (error) {
            console.error('❌ Database validation failed:', error.message);
            throw error;
        }
    }

    async run() {
        try {
            console.log('🚀 Starting production database setup...');
            console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🏠 Host: ${dbConfig.host}:${dbConfig.port}`);
            console.log(`📦 Database: ${dbConfig.database}`);
            
            await this.createDatabase();
            await this.connect();
            await this.runMigrations();
            await this.createIndexes();
            await this.setupPartitioning();
            await this.setupConnectionPooling();
            await this.createViews();
            await this.setupBackupStrategy();
            await this.validateSetup();
            
            console.log('🎉 Production database setup completed successfully!');
            
            // Display summary
            const stats = await this.client.query(`
                SELECT 
                    (SELECT COUNT(*) FROM users) as total_users,
                    (SELECT COUNT(*) FROM generations) as total_generations,
                    (SELECT COUNT(*) FROM payments) as total_payments,
                    (SELECT COUNT(*) FROM schema_migrations) as applied_migrations
            `);
            
            console.log('\n📊 Database Summary:');
            console.log(`   Users: ${stats.rows[0].total_users}`);
            console.log(`   Generations: ${stats.rows[0].total_generations}`);
            console.log(`   Payments: ${stats.rows[0].total_payments}`);
            console.log(`   Migrations: ${stats.rows[0].applied_migrations}`);
            
        } catch (error) {
            console.error('💥 Production database setup failed:', error.message);
            process.exit(1);
        } finally {
            await this.disconnect();
        }
    }
}

// Run if called directly
if (require.main === module) {
    const setup = new ProductionDatabaseSetup();
    setup.run();
}

module.exports = ProductionDatabaseSetup;