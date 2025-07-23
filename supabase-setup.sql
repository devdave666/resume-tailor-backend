-- Supabase Database Setup for Resume Tailor
-- Run this in your Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create generations table
CREATE TABLE IF NOT EXISTS public.generations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    job_description TEXT,
    resume_filename TEXT,
    generated_resume TEXT,
    cover_letter TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payments table
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_session_id TEXT UNIQUE,
    tokens_purchased INTEGER NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create API usage tracking table
CREATE TABLE IF NOT EXISTS public.api_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for generations
CREATE POLICY "Users can view their own generations" ON public.generations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own generations" ON public.generations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for payments
CREATE POLICY "Users can view their own payments" ON public.payments
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage payments" ON public.payments
    FOR ALL USING (auth.role() = 'service_role');

-- Create RLS policies for API usage
CREATE POLICY "Users can view their own API usage" ON public.api_usage
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage API usage" ON public.api_usage
    FOR ALL USING (auth.role() = 'service_role');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_created_at ON public.generations(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON public.payments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON public.api_usage(user_id);

-- Create function to get user token balance
CREATE OR REPLACE FUNCTION get_user_tokens(user_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    token_count INTEGER;
BEGIN
    SELECT COALESCE((raw_user_meta_data->>'tokens')::INTEGER, 0)
    INTO token_count
    FROM auth.users
    WHERE id = user_uuid;
    
    RETURN COALESCE(token_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to update user tokens
CREATE OR REPLACE FUNCTION update_user_tokens(user_uuid UUID, new_token_count INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('tokens', new_token_count)
    WHERE id = user_uuid;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to deduct tokens atomically
CREATE OR REPLACE FUNCTION deduct_user_tokens(user_uuid UUID, tokens_to_deduct INTEGER DEFAULT 1)
RETURNS INTEGER AS $$
DECLARE
    current_tokens INTEGER;
    new_tokens INTEGER;
BEGIN
    -- Get current tokens with row lock
    SELECT COALESCE((raw_user_meta_data->>'tokens')::INTEGER, 0)
    INTO current_tokens
    FROM auth.users
    WHERE id = user_uuid
    FOR UPDATE;
    
    -- Check if user has enough tokens
    IF current_tokens < tokens_to_deduct THEN
        RAISE EXCEPTION 'Insufficient tokens. Current: %, Required: %', current_tokens, tokens_to_deduct;
    END IF;
    
    -- Calculate new token count
    new_tokens := current_tokens - tokens_to_deduct;
    
    -- Update tokens
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('tokens', new_tokens)
    WHERE id = user_uuid;
    
    RETURN new_tokens;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to add tokens (for payments)
CREATE OR REPLACE FUNCTION add_user_tokens(user_uuid UUID, tokens_to_add INTEGER)
RETURNS INTEGER AS $$
DECLARE
    current_tokens INTEGER;
    new_tokens INTEGER;
BEGIN
    -- Get current tokens
    SELECT COALESCE((raw_user_meta_data->>'tokens')::INTEGER, 0)
    INTO current_tokens
    FROM auth.users
    WHERE id = user_uuid;
    
    -- Calculate new token count
    new_tokens := current_tokens + tokens_to_add;
    
    -- Update tokens
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('tokens', new_tokens)
    WHERE id = user_uuid;
    
    RETURN new_tokens;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert default token packages (for reference)
CREATE TABLE IF NOT EXISTS public.token_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tokens INTEGER NOT NULL,
    price_cents INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.token_packages (id, name, tokens, price_cents, description) VALUES
('starter', 'Starter Pack', 10, 500, '10 resume generations for $5'),
('standard', 'Standard Pack', 35, 1500, '35 resume generations for $15 (14% savings)'),
('premium', 'Premium Pack', 60, 2500, '60 resume generations for $25 (16% savings)')
ON CONFLICT (id) DO NOTHING;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Success message
SELECT 'Database setup completed successfully!' as message;