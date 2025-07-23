// api/index.js
// Vercel serverless function entry point for Resume Tailor Backend

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

// Initialize Express app
const app = express();

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const publicSupabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || 
            origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer for file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Rate limiting
const globalLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window
    message: { error: 'Too many requests, please try again later.' }
});

const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many auth attempts, please try again later.' }
});

const generateLimit = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    message: { error: 'Generation rate limit exceeded.' }
});

app.use(globalLimit);

// Helper Functions
async function parseDocument(file) {
    try {
        if (file.mimetype === 'application/pdf') {
            const data = await pdfParse(file.buffer);
            return data.text;
        } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            return result.value;
        } else if (file.mimetype === 'text/plain') {
            return file.buffer.toString('utf-8');
        } else {
            throw new Error('Unsupported file type');
        }
    } catch (error) {
        throw new Error(`Failed to parse document: ${error.message}`);
    }
}

async function generateWithAI(resumeText, jobDescription, profileText = "Not provided.") {
    const prompt = `You are an expert resume writer. Create a tailored resume and cover letter based on the provided information.

ORIGINAL RESUME:
${resumeText}

${profileText !== "Not provided." ? `PROFILE INFO:\n${profileText}\n\n` : ''}JOB DESCRIPTION:
${jobDescription}

Respond with valid JSON containing exactly two keys: 'tailoredResume' and 'coverLetter'. No markdown formatting.

{
  "tailoredResume": "Your tailored resume content here...",
  "coverLetter": "Your cover letter content here..."
}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    
    // Clean and parse JSON
    let cleanedText = text.trim();
    cleanedText = cleanedText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    
    const jsonStart = cleanedText.indexOf('{');
    const jsonEnd = cleanedText.lastIndexOf('}');
    
    if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('Invalid AI response format');
    }
    
    const jsonText = cleanedText.substring(jsonStart, jsonEnd + 1);
    return JSON.parse(jsonText);
}

async function verifyToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        
        const token = authHeader.substring(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token verification failed' });
    }
}

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: 'resume-tailor-backend'
    });
});

// Auth endpoints
app.post('/auth/register', authLimit, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const { data, error } = await publicSupabase.auth.signUp({
            email,
            password,
            options: {
                data: { tokens: 0 } // No free tokens - users must purchase
            }
        });
        
        if (error) throw error;
        
        res.json({ 
            message: 'Registration successful',
            user: data.user,
            session: data.session
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/auth/login', authLimit, async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await publicSupabase.auth.signInWithPassword({
            email,
            password
        });
        
        if (error) throw error;
        
        res.json({
            message: 'Login successful',
            user: data.user,
            session: data.session
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get token balance
app.get('/get-token-balance', verifyToken, async (req, res) => {
    try {
        const tokens = req.user.user_metadata?.tokens || 0;
        res.json({ tokens });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate resume
app.post('/generate', verifyToken, generateLimit, upload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'profile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { jobDescription } = req.body;
        const resumeFile = req.files['resume']?.[0];
        const profileFile = req.files['profile']?.[0];
        
        if (!resumeFile) {
            return res.status(400).json({ error: 'Resume file is required' });
        }
        
        if (!jobDescription) {
            return res.status(400).json({ error: 'Job description is required' });
        }
        
        // Check token balance
        const currentTokens = req.user.user_metadata?.tokens || 0;
        if (currentTokens < 1) {
            return res.status(402).json({ error: 'Insufficient tokens' });
        }
        
        // Parse documents
        const resumeText = await parseDocument(resumeFile);
        const profileText = profileFile ? await parseDocument(profileFile) : "Not provided.";
        
        // Generate with AI
        const aiResponse = await generateWithAI(resumeText, jobDescription, profileText);
        
        // Deduct token
        const { error: updateError } = await supabase.auth.admin.updateUserById(
            req.user.id,
            { 
                user_metadata: { 
                    ...req.user.user_metadata, 
                    tokens: currentTokens - 1 
                }
            }
        );
        
        if (updateError) throw updateError;
        
        // Save generation record
        await supabase.from('generations').insert({
            user_id: req.user.id,
            job_description: jobDescription.substring(0, 1000),
            resume_filename: resumeFile.originalname,
            generated_resume: aiResponse.tailoredResume.substring(0, 5000),
            cover_letter: aiResponse.coverLetter.substring(0, 3000)
        });
        
        res.json({
            tailoredResume: aiResponse.tailoredResume,
            coverLetter: aiResponse.coverLetter,
            newTokenBalance: currentTokens - 1
        });
        
    } catch (error) {
        console.error('Generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Quick generate (simplified for Chrome extension)
app.post('/quick-generate', verifyToken, generateLimit, upload.single('resume'), async (req, res) => {
    try {
        const { jobDescription } = req.body;
        const resumeFile = req.file;
        
        if (!resumeFile || !jobDescription) {
            return res.status(400).json({ error: 'Resume file and job description required' });
        }
        
        // Check tokens
        const currentTokens = req.user.user_metadata?.tokens || 0;
        if (currentTokens < 1) {
            return res.status(402).json({ error: 'Insufficient tokens' });
        }
        
        // Parse and generate
        const resumeText = await parseDocument(resumeFile);
        const aiResponse = await generateWithAI(resumeText, jobDescription);
        
        // Deduct token
        await supabase.auth.admin.updateUserById(
            req.user.id,
            { 
                user_metadata: { 
                    ...req.user.user_metadata, 
                    tokens: currentTokens - 1 
                }
            }
        );
        
        res.json({
            tailoredResume: aiResponse.tailoredResume,
            coverLetter: aiResponse.coverLetter,
            newTokenBalance: currentTokens - 1
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Payment endpoints
app.post('/create-payment-session', verifyToken, async (req, res) => {
    try {
        const { packageType = 'starter' } = req.body;
        
        const packages = {
            starter: { tokens: 10, price: 500, name: 'Starter Pack' },
            standard: { tokens: 35, price: 1500, name: 'Standard Pack' },
            premium: { tokens: 60, price: 2500, name: 'Premium Pack' }
        };
        
        const selectedPackage = packages[packageType];
        if (!selectedPackage) {
            return res.status(400).json({ error: 'Invalid package type' });
        }
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: selectedPackage.name,
                        description: `${selectedPackage.tokens} resume generation tokens`
                    },
                    unit_amount: selectedPackage.price
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL}/cancel`,
            metadata: {
                userId: req.user.id,
                tokens: selectedPackage.tokens.toString(),
                packageType
            }
        });
        
        // Save payment record
        await supabase.from('payments').insert({
            user_id: req.user.id,
            stripe_session_id: session.id,
            tokens_purchased: selectedPackage.tokens,
            amount: selectedPackage.price / 100,
            status: 'pending'
        });
        
        res.json({ sessionId: session.id, url: session.url });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Stripe webhook
app.post('/webhook-payment-success', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const sig = req.headers['stripe-signature'];
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const { userId, tokens } = session.metadata;
            
            // Update payment status
            await supabase.from('payments')
                .update({ status: 'completed' })
                .eq('stripe_session_id', session.id);
            
            // Add tokens to user
            const { data: user } = await supabase.auth.admin.getUserById(userId);
            const currentTokens = user.user_metadata?.tokens || 0;
            const newTokens = currentTokens + parseInt(tokens);
            
            await supabase.auth.admin.updateUserById(userId, {
                user_metadata: { ...user.user_metadata, tokens: newTokens }
            });
            
            console.log(`Added ${tokens} tokens to user ${userId}`);
        }
        
        res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Get available packages
app.get('/payment/packages', (req, res) => {
    res.json({
        packages: {
            starter: { tokens: 10, price: 5.00, name: 'Starter Pack' },
            standard: { tokens: 35, price: 15.00, name: 'Standard Pack' },
            premium: { tokens: 60, price: 25.00, name: 'Premium Pack' }
        }
    });
});

// Export for Vercel
module.exports = app;