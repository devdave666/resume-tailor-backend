# Database Setup Guide

This guide covers the complete database setup for the Resume Tailor Backend, including development, staging, and production environments.

## Quick Start

### Development Setup

```bash
# Install PostgreSQL locally
# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib

# macOS
brew install postgresql

# Start PostgreSQL service
sudo systemctl start postgresql  # Linux
brew services start postgresql   # macOS

# Create database and user
sudo -u postgres psql
CREATE DATABASE resume_tailor_dev;
CREATE USER resume_user WITH PASSWORD 'dev_password';
GRANT ALL PRIVILEGES ON DATABASE resume_tailor_dev TO resume_user;
\q

# Set environment variables
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=resume_tailor_dev
export DB_USER=resume_user
export DB_PASSWORD=dev_password

# Run migrations
npm run migrate
```

### Production Setup

```bash
# Set production environment variables
export NODE_ENV=production
export DB_HOST=your-rds-endpoint
export DB_NAME=resume_tailor
export DB_USER=postgres
export DB_PASSWORD=your-secure-password

# Run production database setup
node scripts/setup-production-db.js
```

## Database Architecture

### Core Tables

#### Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tokens INTEGER DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Generations Table
```sql
CREATE TABLE generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    job_description TEXT NOT NULL,
    original_filename VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### API Usage Table
```sql
CREATE TABLE api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    tokens_used INTEGER DEFAULT 1,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Payments Table
```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    stripe_session_id VARCHAR(255) UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    tokens_purchased INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes and Optimization

The production setup includes comprehensive indexing:

- **User queries**: Email lookups, token balance checks
- **Generation history**: User-specific generation lists
- **API analytics**: Usage tracking and reporting
- **Payment processing**: Transaction status and history

### Views and Analytics

#### User Statistics View
```sql
CREATE VIEW user_stats AS
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
GROUP BY u.id, u.email, u.tokens, u.created_at;
```

#### Daily Metrics View
```sql
CREATE VIEW daily_metrics AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as new_users,
    SUM(CASE WHEN tokens > 0 THEN 1 ELSE 0 END) as paying_users
FROM users
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## Migration System

### Running Migrations

```bash
# Run all pending migrations
npm run migrate

# Setup fresh database
npm run setup-db

# Production database setup
node scripts/setup-production-db.js
```

### Creating New Migrations

1. Create a new SQL file in `migrations/` directory
2. Use sequential numbering: `003_add_new_feature.sql`
3. Include both schema changes and data migrations
4. Test thoroughly in development before production

### Migration Best Practices

- **Always use transactions** for complex migrations
- **Create indexes concurrently** to avoid blocking
- **Add constraints carefully** in production
- **Test rollback procedures** when possible
- **Document breaking changes** clearly

## Production Database Features

### Connection Pooling

The production setup includes optimized connection pooling:

```javascript
const poolConfig = {
    max: 20,           // Maximum connections
    min: 2,            // Minimum connections
    idle: 10000,       // Idle timeout (10s)
    acquire: 30000,    // Acquire timeout (30s)
    evict: 1000        // Eviction interval (1s)
};
```

### Performance Optimization

#### Query Optimization
- Comprehensive indexing strategy
- Query performance monitoring
- Connection pool management
- Statement timeout configuration

#### Database Settings
```sql
-- Optimized for production workloads
SET shared_buffers = '256MB';
SET effective_cache_size = '1GB';
SET maintenance_work_mem = '64MB';
SET checkpoint_completion_target = 0.9;
SET wal_buffers = '16MB';
SET default_statistics_target = 100;
```

### Security Features

#### Access Control
- Dedicated database users with minimal privileges
- SSL/TLS encryption for connections
- Network-level security groups
- Regular security updates

#### Data Protection
- Encrypted storage at rest
- Secure backup procedures
- Audit logging enabled
- Regular security assessments

## Backup and Recovery

### Automated Backups

```bash
# Create backup
node scripts/backup-database.js

# Restore from backup
node scripts/restore-database.js
```

### Backup Strategy

#### Daily Backups
- Automated daily backups at 3 AM UTC
- Retention period: 30 days for daily backups
- Storage: Local filesystem + S3

#### Point-in-Time Recovery
- WAL archiving enabled
- 7-day point-in-time recovery window
- Automated testing of backup integrity

#### Disaster Recovery
- Cross-region backup replication
- RTO (Recovery Time Objective): 4 hours
- RPO (Recovery Point Objective): 1 hour

### Backup Configuration

```bash
# Environment variables for backup
export BACKUP_DIR=/var/backups/postgresql
export BACKUP_S3_BUCKET=your-backup-bucket
export BACKUP_RETENTION_DAYS=30
export AWS_REGION=us-east-1
```

## Monitoring and Maintenance

### Health Checks

The database includes comprehensive health monitoring:

```javascript
// Health check endpoint
GET /health
{
    "database": {
        "status": "healthy",
        "responseTime": "15ms",
        "activeConnections": 5,
        "cacheHitRatio": "98.5%"
    }
}
```

### Performance Monitoring

#### Key Metrics
- Connection pool utilization
- Query response times
- Cache hit ratios
- Lock contention
- Disk I/O patterns

#### Alerting Thresholds
- CPU usage > 80% for 5 minutes
- Memory usage > 85% for 5 minutes
- Connection pool > 90% for 2 minutes
- Slow queries > 2 seconds
- Failed connections > 5% error rate

### Maintenance Tasks

#### Weekly Maintenance
```bash
# Update table statistics
ANALYZE;

# Refresh materialized views
SELECT refresh_analytics_views();

# Check for unused indexes
SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0;
```

#### Monthly Maintenance
```bash
# Vacuum and reindex
VACUUM ANALYZE;
REINDEX DATABASE resume_tailor;

# Clean up old data
SELECT cleanup_old_data();

# Review slow query log
SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;
```

## Environment-Specific Configuration

### Development
```bash
DB_HOST=localhost
DB_PORT=5432
DB_NAME=resume_tailor_dev
DB_USER=resume_user
DB_PASSWORD=dev_password
DB_SSL=false
DB_POOL_MAX=5
```

### Staging
```bash
DB_HOST=staging-db.example.com
DB_PORT=5432
DB_NAME=resume_tailor_staging
DB_USER=app_user
DB_PASSWORD=staging_password
DB_SSL=true
DB_POOL_MAX=10
```

### Production
```bash
DB_HOST=prod-db.example.com
DB_PORT=5432
DB_NAME=resume_tailor
DB_USER=app_user
DB_PASSWORD=secure_production_password
DB_SSL=true
DB_POOL_MAX=20
DB_POOL_MIN=5
```

## Troubleshooting

### Common Issues

#### Connection Problems
```bash
# Check database status
sudo systemctl status postgresql

# Check connections
SELECT * FROM pg_stat_activity;

# Check configuration
SHOW all;
```

#### Performance Issues
```bash
# Check slow queries
SELECT query, total_time, calls, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

# Check index usage
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE schemaname = 'public';
```

#### Lock Contention
```bash
# Check for locks
SELECT * FROM pg_locks 
WHERE NOT granted;

# Check blocking queries
SELECT blocked_locks.pid AS blocked_pid,
       blocked_activity.usename AS blocked_user,
       blocking_locks.pid AS blocking_pid,
       blocking_activity.usename AS blocking_user,
       blocked_activity.query AS blocked_statement,
       blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted AND blocking_locks.granted;
```

### Recovery Procedures

#### Database Corruption
1. Stop application servers
2. Assess corruption extent
3. Restore from latest backup
4. Apply WAL files for point-in-time recovery
5. Verify data integrity
6. Restart application servers

#### Connection Pool Exhaustion
1. Identify long-running queries
2. Kill problematic connections
3. Restart connection pool
4. Monitor for recurring issues
5. Adjust pool configuration if needed

## Best Practices

### Development
- Use database transactions for data consistency
- Test migrations on production-like data
- Monitor query performance during development
- Use database constraints for data integrity
- Regular backup testing

### Production
- Monitor database metrics continuously
- Implement automated failover procedures
- Regular security updates and patches
- Capacity planning based on growth trends
- Document all operational procedures

### Security
- Use strong, unique passwords
- Enable SSL/TLS for all connections
- Regular security audits
- Principle of least privilege
- Encrypt sensitive data at application level

This database setup provides a robust, scalable, and secure foundation for the Resume Tailor Backend application.