// services/SupabaseService.js
// Simplified Supabase service for MVP deployment

const { createClient } = require('@supabase/supabase-js');

class SupabaseService {
    constructor() {
        this.supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        this.publicSupabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_ANON_KEY
        );
    }

    // Initialize database tables
    async initializeTables() {
        try {
            // Create users table (extends Supabase auth.users)
            await this.supabase.rpc('create_users_table');
            
            // Create generations table
            await this.supabase.rpc('create_generations_table');
            
            // Create payments table
            await this.supabase.rpc('create_payments_table');
            
            console.log('✅ Database tables initialized');
            return true;
        } catch (error) {
            console.log('Database tables may already exist:', error.message);
            return true; // Continue even if tables exist
        }
    }

    // User management
    async createUser(email, password) {
        const { data, error } = await this.supabase.auth.admin.createUser({
            email,
            password,
            user_metadata: { tokens: 3 } // Free tokens for new users
        });
        
        if (error) throw error;
        return data.user;
    }

    async getUserById(userId) {
        const { data, error } = await this.supabase
            .from('auth.users')
            .select('*')
            .eq('id', userId)
            .single();
            
        if (error) throw error;
        return data;
    }

    async updateUserTokens(userId, tokens) {
        const { data, error } = await this.supabase.auth.admin.updateUserById(
            userId,
            { user_metadata: { tokens } }
        );
        
        if (error) throw error;
        return data.user;
    }

    async deductTokens(userId, amount = 1) {
        // Get current user
        const { data: user, error: userError } = await this.supabase.auth.admin.getUserById(userId);
        if (userError) throw userError;
        
        const currentTokens = user.user_metadata?.tokens || 0;
        if (currentTokens < amount) {
            throw new Error('Insufficient tokens');
        }
        
        const newTokens = currentTokens - amount;
        
        // Update tokens
        const { data, error } = await this.supabase.auth.admin.updateUserById(
            userId,
            { user_metadata: { ...user.user_metadata, tokens: newTokens } }
        );
        
        if (error) throw error;
        return newTokens;
    }

    // Generation tracking
    async createGeneration(userId, jobDescription, resumeFilename) {
        const { data, error } = await this.supabase
            .from('generations')
            .insert({
                user_id: userId,
                job_description: jobDescription.substring(0, 1000), // Limit length
                resume_filename: resumeFilename,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        return data;
    }

    // Payment tracking
    async createPayment(userId, stripeSessionId, tokensAmount, priceAmount) {
        const { data, error } = await this.supabase
            .from('payments')
            .insert({
                user_id: userId,
                stripe_session_id: stripeSessionId,
                tokens_purchased: tokensAmount,
                amount: priceAmount,
                status: 'pending',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        return data;
    }

    async updatePaymentStatus(stripeSessionId, status, tokensToAdd = 0) {
        // Update payment status
        const { data: payment, error: paymentError } = await this.supabase
            .from('payments')
            .update({ status })
            .eq('stripe_session_id', stripeSessionId)
            .select()
            .single();
            
        if (paymentError) throw paymentError;
        
        // If successful, add tokens to user
        if (status === 'completed' && tokensToAdd > 0) {
            const { data: user, error: userError } = await this.supabase.auth.admin.getUserById(payment.user_id);
            if (userError) throw userError;
            
            const currentTokens = user.user_metadata?.tokens || 0;
            const newTokens = currentTokens + tokensToAdd;
            
            await this.supabase.auth.admin.updateUserById(
                payment.user_id,
                { user_metadata: { ...user.user_metadata, tokens: newTokens } }
            );
        }
        
        return payment;
    }

    // Authentication helpers
    async signIn(email, password) {
        const { data, error } = await this.publicSupabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        return data;
    }

    async signUp(email, password) {
        const { data, error } = await this.publicSupabase.auth.signUp({
            email,
            password,
            options: {
                data: { tokens: 3 } // Free tokens for new users
            }
        });
        
        if (error) throw error;
        return data;
    }

    async verifyToken(token) {
        const { data, error } = await this.supabase.auth.getUser(token);
        if (error) throw error;
        return data.user;
    }

    // Health check
    async healthCheck() {
        try {
            const { data, error } = await this.supabase
                .from('generations')
                .select('count')
                .limit(1);
                
            return !error;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new SupabaseService();