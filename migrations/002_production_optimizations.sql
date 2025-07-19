-- Production Database Optimizations
-- This migration adds production-specific optimizations, indexes, and constraints

-- Add missing constraints and indexes for better performance
BEGIN;

-- Add check constraints for data integrity
ALTER TABLE users 
ADD CONSTRAINT check_email_format 
CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

ALTER TABLE users 
ADD CONSTRAINT check_tokens_non_negative 
CHECK (tokens >= 0);

-- Add indexes for better query performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_tokens ON users(tokens) WHERE tokens > 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at_desc ON users(created_at DESC);

-- Generations table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_user_created ON generations(user_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_job_description_hash ON generations(MD5(job_description));

-- API usage table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_user_endpoint ON api_usage(user_id, endpoint);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_timestamp_desc ON api_usage(timestamp DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_tokens_used ON api_usage(tokens_used) WHERE tokens_used > 0;

-- Payments table optimizations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user_status ON payments(user_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_created_at_desc ON payments(created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_stripe_session_unique ON payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- Add partial indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_recent 
ON users(created_at DESC) 
WHERE created_at > CURRENT_DATE - INTERVAL '30 days';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_recent 
ON generations(created_at DESC) 
WHERE created_at > CURRENT_DATE - INTERVAL '7 days';

-- Add composite indexes for dashboard queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_usage_daily_stats 
ON api_usage(DATE(timestamp), endpoint, user_id);

-- Create materialized view for analytics (refreshed periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_user_stats AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as new_users,
    COUNT(*) FILTER (WHERE tokens > 0) as users_with_tokens,
    AVG(tokens) as avg_tokens
FROM users 
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Create unique index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_user_stats_date ON daily_user_stats(date);

-- Create function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_user_stats;
END;
$$ LANGUAGE plpgsql;

-- Add table statistics for better query planning
ANALYZE users;
ANALYZE generations;
ANALYZE api_usage;
ANALYZE payments;

-- Add comments for documentation
COMMENT ON TABLE users IS 'User accounts with authentication and token balance';
COMMENT ON TABLE generations IS 'Resume generation history and job descriptions';
COMMENT ON TABLE api_usage IS 'API endpoint usage tracking for analytics';
COMMENT ON TABLE payments IS 'Payment transactions and Stripe integration';

COMMENT ON COLUMN users.tokens IS 'Available tokens for API usage';
COMMENT ON COLUMN users.created_at IS 'Account creation timestamp';
COMMENT ON COLUMN generations.job_description IS 'Job posting content used for tailoring';
COMMENT ON COLUMN api_usage.tokens_used IS 'Number of tokens consumed by request';
COMMENT ON COLUMN payments.stripe_session_id IS 'Stripe checkout session identifier';

-- Create function for user token management
CREATE OR REPLACE FUNCTION deduct_user_tokens(user_id_param UUID, tokens_to_deduct INTEGER)
RETURNS INTEGER AS $$
DECLARE
    current_tokens INTEGER;
    new_balance INTEGER;
BEGIN
    -- Lock the user row to prevent race conditions
    SELECT tokens INTO current_tokens 
    FROM users 
    WHERE id = user_id_param 
    FOR UPDATE;
    
    -- Check if user exists
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', user_id_param;
    END IF;
    
    -- Check if user has enough tokens
    IF current_tokens < tokens_to_deduct THEN
        RAISE EXCEPTION 'Insufficient tokens. Current: %, Required: %', current_tokens, tokens_to_deduct;
    END IF;
    
    -- Deduct tokens
    new_balance := current_tokens - tokens_to_deduct;
    
    UPDATE users 
    SET tokens = new_balance, 
        updated_at = CURRENT_TIMESTAMP 
    WHERE id = user_id_param;
    
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Create function for adding tokens (payments)
CREATE OR REPLACE FUNCTION add_user_tokens(user_id_param UUID, tokens_to_add INTEGER)
RETURNS INTEGER AS $$
DECLARE
    new_balance INTEGER;
BEGIN
    UPDATE users 
    SET tokens = tokens + tokens_to_add,
        updated_at = CURRENT_TIMESTAMP 
    WHERE id = user_id_param
    RETURNING tokens INTO new_balance;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found: %', user_id_param;
    END IF;
    
    RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to tables with updated_at columns
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to clean up old data
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS void AS $$
BEGIN
    -- Delete API usage data older than 1 year
    DELETE FROM api_usage 
    WHERE timestamp < CURRENT_DATE - INTERVAL '1 year';
    
    -- Delete generations older than 2 years for users with no recent activity
    DELETE FROM generations 
    WHERE created_at < CURRENT_DATE - INTERVAL '2 years'
    AND user_id IN (
        SELECT id FROM users 
        WHERE created_at < CURRENT_DATE - INTERVAL '1 year'
        AND id NOT IN (
            SELECT DISTINCT user_id FROM api_usage 
            WHERE timestamp > CURRENT_DATE - INTERVAL '6 months'
        )
    );
    
    -- Log cleanup activity
    RAISE NOTICE 'Cleanup completed at %', CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- Create extension for better text search (if not exists)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add text search index for job descriptions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_generations_job_description_gin 
ON generations USING gin(job_description gin_trgm_ops);

-- Add database-level settings for better performance
ALTER DATABASE resume_tailor SET shared_preload_libraries = 'pg_stat_statements';
ALTER DATABASE resume_tailor SET log_statement = 'mod';
ALTER DATABASE resume_tailor SET log_min_duration_statement = 1000;

COMMIT;