// repositories/GenerationRepository.js
// Generation tracking data access layer

const { query, logger } = require('../config/database');

class GenerationRepository {
    
    // Record a new generation
    async createGeneration(userId, jobDescription, originalFilename, status = 'completed') {
        try {
            const result = await query(
                'INSERT INTO generations (user_id, job_description, original_filename, status) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
                [userId, jobDescription, originalFilename, status]
            );
            
            logger.info('Generation recorded', { 
                generationId: result.rows[0].id, 
                userId, 
                filename: originalFilename 
            });
            
            return result.rows[0];
        } catch (error) {
            logger.error('Error recording generation', { 
                userId, 
                filename: originalFilename, 
                error: error.message 
            });
            throw error;
        }
    }

    // Get user's generation history
    async getUserGenerations(userId, limit = 50, offset = 0) {
        try {
            const result = await query(
                'SELECT id, job_description, original_filename, status, created_at FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
                [userId, limit, offset]
            );
            
            return result.rows;
        } catch (error) {
            logger.error('Error fetching user generations', { userId, error: error.message });
            throw error;
        }
    }

    // Get generation statistics
    async getGenerationStats(userId) {
        try {
            const result = await query(
                `SELECT 
                    COUNT(*) as total_generations,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_generations,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_generations,
                    MAX(created_at) as last_generation
                FROM generations 
                WHERE user_id = $1`,
                [userId]
            );
            
            return result.rows[0];
        } catch (error) {
            logger.error('Error fetching generation stats', { userId, error: error.message });
            throw error;
        }
    }

    // Update generation status
    async updateGenerationStatus(generationId, status) {
        try {
            const result = await query(
                'UPDATE generations SET status = $1 WHERE id = $2 RETURNING id, status',
                [status, generationId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Generation not found');
            }
            
            logger.info('Generation status updated', { generationId, status });
            return result.rows[0];
        } catch (error) {
            logger.error('Error updating generation status', { generationId, status, error: error.message });
            throw error;
        }
    }

    // Record API usage
    async recordApiUsage(userId, endpoint, tokensUsed = 1) {
        try {
            const result = await query(
                'INSERT INTO api_usage (user_id, endpoint, tokens_used) VALUES ($1, $2, $3) RETURNING id, created_at',
                [userId, endpoint, tokensUsed]
            );
            
            logger.debug('API usage recorded', { 
                userId, 
                endpoint, 
                tokensUsed,
                usageId: result.rows[0].id 
            });
            
            return result.rows[0];
        } catch (error) {
            logger.error('Error recording API usage', { userId, endpoint, tokensUsed, error: error.message });
            throw error;
        }
    }

    // Get API usage statistics
    async getApiUsageStats(userId, days = 30) {
        try {
            const result = await query(
                `SELECT 
                    endpoint,
                    COUNT(*) as usage_count,
                    SUM(tokens_used) as total_tokens_used,
                    MAX(created_at) as last_used
                FROM api_usage 
                WHERE user_id = $1 
                AND created_at >= NOW() - INTERVAL '${days} days'
                GROUP BY endpoint
                ORDER BY usage_count DESC`,
                [userId]
            );
            
            return result.rows;
        } catch (error) {
            logger.error('Error fetching API usage stats', { userId, days, error: error.message });
            throw error;
        }
    }
}

module.exports = new GenerationRepository();