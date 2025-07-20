// Main API entry point for Vercel serverless deployment
// Minimal MVP backend for Resume Tailor Chrome Extension

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();

// Middleware
app.use(cors({
  origin: ['chrome-extension://*', 'https://*.vercel.app', 'http://localhost:*'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Helper function to parse documents
async function parseDocument(file) {
  try {
    if (file.mimetype === 'application/pdf') {
      const pdfData = await pdfParse(file.buffer);
      return pdfData.text;
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value;
    } else if (file.mimetype === 'text/plain') {
      return file.buffer.toString('utf-8');
    } else {
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    throw new Error(`Document parsing failed: ${error.message}`);
  }
}

// Helper function to generate tailored resume
async function generateTailoredResume(resumeText, jobDescription) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `
You are a professional resume writer. Given the following resume and job description, create a tailored version of the resume that highlights relevant skills and experiences for this specific job.

ORIGINAL RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Please provide a tailored resume that:
1. Emphasizes relevant skills and experiences
2. Uses keywords from the job description
3. Maintains the original structure and format
4. Keeps all factual information accurate
5. Optimizes for ATS (Applicant Tracking Systems)

Return only the tailored resume text without any additional commentary.
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    throw new Error(`AI generation failed: ${error.message}`);
  }
}

// Authentication middleware
async function authenticateUser(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// User registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          tokens: 3 // Free tokens for new users
        }
      }
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ 
      message: 'Registration successful',
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ 
      message: 'Login successful',
      user: data.user,
      session: data.session
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile and token balance
app.get('/api/user/profile', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('tokens')
      .eq('id', req.user.id)
      .single();

    if (error) {
      // If profile doesn't exist, create it with default tokens
      const { data: newProfile, error: createError } = await supabase
        .from('profiles')
        .insert([{ id: req.user.id, tokens: 3 }])
        .select()
        .single();

      if (createError) {
        return res.status(500).json({ error: 'Failed to create profile' });
      }

      return res.json({
        user: req.user,
        tokens: newProfile.tokens
      });
    }

    res.json({
      user: req.user,
      tokens: data.tokens
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Generate tailored resume
app.post('/api/generate', authenticateUser, upload.single('resume'), async (req, res) => {
  try {
    const { jobDescription } = req.body;
    const resumeFile = req.file;

    if (!resumeFile || !jobDescription) {
      return res.status(400).json({ error: 'Resume file and job description are required' });
    }

    // Check user token balance
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tokens')
      .eq('id', req.user.id)
      .single();

    if (profileError || !profile || profile.tokens <= 0) {
      return res.status(402).json({ error: 'Insufficient tokens' });
    }

    // Parse resume
    const resumeText = await parseDocument(resumeFile);

    // Generate tailored resume
    const tailoredResume = await generateTailoredResume(resumeText, jobDescription);

    // Deduct token
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ tokens: profile.tokens - 1 })
      .eq('id', req.user.id);

    if (updateError) {
      throw new Error('Failed to update token balance');
    }

    // Save generation record
    await supabase
      .from('generations')
      .insert([{
        user_id: req.user.id,
        job_description: jobDescription.substring(0, 1000), // Truncate for storage
        generated_resume: tailoredResume.substring(0, 5000) // Truncate for storage
      }]);

    res.json({
      tailoredResume,
      newTokenBalance: profile.tokens - 1
    });

  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: error.message || 'Generation failed' });
  }
});

// Create payment session
app.post('/api/payment/create-session', authenticateUser, async (req, res) => {
  try {
    const { packageType = 'starter' } = req.body;

    const packages = {
      starter: { tokens: 10, price: 500, name: 'Starter Package' }, // $5.00
      popular: { tokens: 35, price: 1500, name: 'Popular Package' }, // $15.00
      pro: { tokens: 60, price: 2500, name: 'Pro Package' } // $25.00
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
      success_url: `${process.env.CLIENT_URL || 'chrome-extension://your-extension-id'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL || 'chrome-extension://your-extension-id'}/cancel`,
      metadata: {
        user_id: req.user.id,
        tokens: selectedPackage.tokens.toString(),
        package_type: packageType
      }
    });

    // Save payment record
    await supabase
      .from('payments')
      .insert([{
        user_id: req.user.id,
        stripe_session_id: session.id,
        tokens_purchased: selectedPackage.tokens,
        amount: selectedPackage.price / 100,
        status: 'pending'
      }]);

    res.json({
      sessionId: session.id,
      url: session.url
    });

  } catch (error) {
    console.error('Payment session error:', error);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// Stripe webhook
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { user_id, tokens } = session.metadata;

      // Update payment status
      await supabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('stripe_session_id', session.id);

      // Add tokens to user account
      const { data: profile } = await supabase
        .from('profiles')
        .select('tokens')
        .eq('id', user_id)
        .single();

      const currentTokens = profile?.tokens || 0;
      await supabase
        .from('profiles')
        .upsert({
          id: user_id,
          tokens: currentTokens + parseInt(tokens)
        });

      console.log(`Added ${tokens} tokens to user ${user_id}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook failed' });
  }
});

// Get available packages
app.get('/api/payment/packages', (req, res) => {
  const packages = {
    starter: { tokens: 10, price: 5.00, name: 'Starter Package', popular: false },
    popular: { tokens: 35, price: 15.00, name: 'Popular Package', popular: true },
    pro: { tokens: 60, price: 25.00, name: 'Pro Package', popular: false }
  };

  res.json({ packages });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('API Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

module.exports = app;