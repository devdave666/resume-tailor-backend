// repositories/UserRepository.js
// User data access layer

const { query, getClient, logger } = require('../config/database');
const bcrypt = require('bcryptjs');

class UserRepository {
    
    // Create a new user
    async createUser(email, password) {
        try {
            const passwordHash = await bcrypt.hash(password, 12);
            const result = await query(
                'INSERT INTO users (email, password_hash, tokens) VALUES ($1, $2, $3) RETURNING id, email, tokens, created_at',
                [email, passwordHash, 5]
            );
            
            logger.info('User created successfully', { userId: result.rows[0].id, email });
            return result.rows[0];
        } catch (error) {
            if (error.code === '23505') { // Unique violation
                throw new Error('Email already exists');
            }
            logger.error('Error creating user', { email, error: error.message });
            throw error;
        }
    }

    // Find user by email
    async findByEmail(email) {
        try {
            const result = await query(
                'SELECT id, email, password_hash, tokens, stripe_customer_id, created_at, updated_at FROM users WHERE email = $1',
                [email]
            );
            
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error finding user by email', { email, error: error.message });
            throw error;
        }
    }

    // Find user by ID
    async findById(userId) {
        try {
            const result = await query(
                'SELECT id, email, tokens, stripe_customer_id, created_at, updated_at FROM users WHERE id = $1',
                [userId]
            );
            
            return result.rows[0] || null;
        } catch (error) {
            logger.error('Error finding user by ID', { userId, error: error.message });
            throw error;
        }
    }

    // Verify user password
    async verifyPassword(email, password) {
        try {
            const user = await this.findByEmail(email);
            if (!user) {
                return null;
            }

            const isValid = await bcrypt.compare(password, user.password_hash);
            if (!isValid) {
                return null;
            }

            // Return user without password hash
            const { password_hash, ...userWithoutPassword } = user;
            return userWithoutPassword;
        } catch (error) {
            logger.error('Error verifying password', { email, error: error.message });
            throw error;
        }
    }

    // Update user token balance
    async updateTokenBalance(userId, newBalance) {
        try {
            const result = await query(
                'UPDATE users SET tokens = $1, updated_at = NOW() WHERE id = $2 RETURNING tokens',
                [newBalance, userId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('User not found');
            }
            
            logger.info('Token balance updated', { userId, newBalance });
            return result.rows[0].tokens;
        } catch (error) {
            logger.error('Error updating token balance', { userId, newBalance, error: error.message });
            throw error;
        }
    }

    // Deduct tokens atomically
    async deductTokens(userId, tokensToDeduct = 1) {
        const client = await getClient();
        
        try {
            await client.query('BEGIN');
            
            // Get current balance with row lock
            const balanceResult = await client.query(
                'SELECT tokens FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            
            if (balanceResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const currentBalance = balanceResult.rows[0].tokens;
            
            if (currentBalance < tokensToDeduct) {
                throw new Error('Insufficient tokens');
            }
            
            const newBalance = currentBalance - tokensToDeduct;
            
            // Update balance
            await client.query(
                'UPDATE users SET tokens = $1, updated_at = NOW() WHERE id = $2',
                [newBalance, userId]
            );
            
            await client.query('COMMIT');
            
            logger.info('Tokens deducted successfully', { userId, tokensDeducted: tokensToDeduct, newBalance });
            return newBalance;
            
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error deducting tokens', { userId, tokensToDeduct, error: error.message });
            throw error;
        } finally {
            client.release();
        }
    }

    // Add tokens (for payments)
    async addTokens(userId, tokensToAdd) {
        const client = await getClient();
        
        try {
            await client.query('BEGIN');
            
            // Get current balance with row lock
            const balanceResult = await client.query(
                'SELECT tokens FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            
            if (balanceResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const currentBalance = balanceResult.rows[0].tokens;
            const newBalance = currentBalance + tokensToAdd;
            
            // Update balance
            await client.query(
                'UPDATE users SET tokens = $1, updated_at = NOW() WHERE id = $2',
                [newBalance, userId]
            );
            
            await client.query('COMMIT');
            
            logger.info('Tokens added successfully', { userId, tokensAdded: tokensToAdd, newBalance });
            return newBalance;
            
        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error adding tokens', { userId, tokensToAdd, error: error.message });
            throw error;
        } finally {
            client.release();
        }
    }

    // Update Stripe customer ID
    async updateStripeCustomerId(userId, stripeCustomerId) {
        try {
            const result = await query(
                'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2 RETURNING stripe_customer_id',
                [stripeCustomerId, userId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('User not found');
            }
            
            logger.info('Stripe customer ID updated', { userId, stripeCustomerId });
            return result.rows[0].stripe_customer_id;
        } catch (error) {
            logger.error('Error updating Stripe customer ID', { userId, stripeCustomerId, error: error.message });
            throw error;
        }
    }
}

module.exports = new UserRepository();