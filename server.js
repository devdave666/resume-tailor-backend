// server.js
// Secure backend for the Resume Tailor Chrome Extension

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const pdfParse = require('pdf-parse');
require('dotenv').config(); // To manage environment variables



// --- INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// --- PERSISTENT USER DATABASE & TOKEN MANAGEMENT ---
const path = require('path');
const DB_FILE = path.join(__dirname, 'db.json');

// Initialize database file if it doesn't exist
function initializeDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: {
                'user123': { id: 'user123', email: 'user@example.com', tokens: 5, stripeCustomerId: 'cus_xxxxxxxxxxxxxx' }
            }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}

function readDB() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading database:', error);
        return { users: {} };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing database:', error);
    }
}

const getUserIdFromRequest = (req) => {
    // In a real app, you would get the user ID from a decoded JWT in the Authorization header.
    // For this example, we'll use a static user ID.
    return 'user123';
};

// --- API CLIENTS SETUP ---
// IMPORTANT: API keys are loaded from a .env file for security.
// --- Google Gemini Client Setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PDF_CO_API_KEY = process.env.PDF_CO_API_KEY;

// --- MIDDLEWARE ---
app.use(cors({
    origin: [
        'chrome-extension://*',
        ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'])
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

// Add CSP headers
app.use((req, res, next) => {    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' https://api.openai.com https://api.stripe.com;"
    );
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({ storage: multer.memoryStorage() }); // Use memory storage for file uploads

// Rate limiting
const generateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: { error: 'Too many generation requests, please try again later.' }
});

// Initialize database
initializeDB();

// --- API ENDPOINTS ---

/**
 * Endpoint: /extract-job-posting
 * Method: POST
 * Description: Extract job description from webpage HTML for Chrome extension.
 */
app.post('/extract-job-posting', async (req, res) => {
    try {
        const { url, htmlContent } = req.body;
        
        if (!htmlContent) {
            return res.status(400).json({ error: 'HTML content is required' });
        }
        
        const jobDescription = extractJobFromHTML(htmlContent);
        res.json({ jobDescription, url });
    } catch (error) {
        console.error('Error extracting job posting:', error);
        res.status(500).json({ error: 'Failed to extract job description' });
    }
});

/**
 * Endpoint: /quick-generate
 * Method: POST
 * Description: Simplified generation for extension popup.
 */
app.post('/quick-generate', 
    generateLimiter,
    upload.single('resume'), 
    async (req, res) => {
    try {
        const userId = getUserIdFromRequest(req);
        const db = readDB();
        const user = db.users[userId];

        if (!user || user.tokens <= 0) {
            return res.status(402).json({ error: 'Insufficient tokens' });
        }

        const { jobDescription } = req.body;
        const resumeFile = req.files ? req.files[0] : null;

        if (!jobDescription || !resumeFile) {
            return res.status(400).json({ error: 'Resume and job description required' });
        }

        const resumeText = await parseDocumentWithPdfCo(resumeFile);
        const aiResponse = await generateContentWithGemini(resumeText, "Not provided.", jobDescription);
        
        // Deduct token
        user.tokens -= 1;
        writeDB(db);

        res.json({
            tailoredResume: aiResponse.tailoredResume,
            coverLetter: aiResponse.coverLetter,
            newTokenBalance: user.tokens
        });
    } catch (error) {
        console.error('Error in quick generate:', error);
        res.status(500).json({ error: 'Generation failed' });
    }
});

/**
 * Endpoint: /get-token-balance
 * Method: GET
 * Description: Retrieves the token balance for the authenticated user.
 */
app.get('/get-token-balance', (req, res) => {
    console.log('GET /get-token-balance - Checking token balance');
    try {
        const userId = getUserIdFromRequest(req);
        console.log('User ID:', userId);
        const db = readDB();
        console.log('Database read successfully');
        const user = db.users[userId];
        if (!user) {
            console.log('User not found:', userId);
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('Token balance for user:', user.tokens);
        res.json({ tokens: user.tokens });
    } catch (error) {
        console.error('Error getting token balance:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


/**
 * Endpoint: /generate
 * Method: POST
 * Description: A single endpoint to handle parsing, AI generation, and file creation.
 * This is more efficient than multiple round-trips from the client.
 */
app.post('/generate', 
    generateLimiter,
    upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'profile', maxCount: 1 }]),
    [
        body('jobDescription').notEmpty().withMessage('Job description is required')
    ],
    async (req, res) => {
    console.log('Received /generate request');

    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const userId = getUserIdFromRequest(req);
    const db = readDB();
    const user = db.users[userId];

    if (!user || user.tokens <= 0) {
        return res.status(402).json({ error: 'Insufficient tokens. Please purchase more.' });
    }
    
    try {
        const { jobDescription } = req.body;
        const resumeFile = req.files['resume'] ? req.files['resume'][0] : null;
        const profileFile = req.files['profile'] ? req.files['profile'][0] : null;

        if (!jobDescription || !resumeFile) {
            return res.status(400).json({ error: 'Job description and resume file are required.' });
        }        // --- 1. Parse Documents ---
        console.log('Parsing documents...');
        const resumeText = await parseDocumentWithPdfCo(resumeFile);
        const profileText = profileFile ? await parseDocumentWithPdfCo(profileFile) : "Not provided.";        // --- 2. Generate Content with OpenAI ---
        console.log('Generating content with AI...');
        const aiResponse = await generateContentWithGemini(resumeText, profileText, jobDescription);

        // --- 3. Generate DOCX and PDF Files ---
        console.log('Generating document files...');
        const { tailoredResume, coverLetter } = aiResponse;
        const resumeSections = parseResumeContent(tailoredResume);
        const coverLetterSections = parseResumeContent(coverLetter);
        const resumeDocxBuffer = await createDocx(resumeSections);
        const coverLetterDocxBuffer = await createDocx(coverLetterSections);
        const resumePdfBuffer = await createPdf(resumeSections);
        const coverLetterPdfBuffer = await createPdf(coverLetterSections);

        // --- 4. Deduct Token ---
        user.tokens -= 1;
        writeDB(db);
        console.log(`Token deducted for user ${userId}. New balance: ${user.tokens}`);

        // --- 5. Send Files Back to Client ---
        console.log('Sending files to client...');
        res.status(200).json({
            resumeDocx: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${resumeDocxBuffer.toString('base64')}`,
            resumePdf: `data:application/pdf;base64,${resumePdfBuffer.toString('base64')}`,
            coverLetterDocx: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${coverLetterDocxBuffer.toString('base64')}`,
            coverLetterPdf: `data:application/pdf;base64,${coverLetterPdfBuffer.toString('base64')}`,
            newTokenBalance: user.tokens
        });

    } catch (error) {
        console.error('Error in /generate endpoint:', error.message);
        res.status(500).json({ error: 'An error occurred during the generation process.' });
    }
});

/**
 * Endpoint: /create-payment-session
 * Method: POST
 * Description: Creates a Stripe Checkout session for purchasing tokens.
 */
app.post('/create-payment-session', async (req, res) => {
    try {
        const userId = getUserIdFromRequest(req);
        const db = readDB();
        const user = db.users[userId];

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: '5 Resume Tokens',
                            description: 'Tokens for Resume Tailor Extension',
                        },
                        unit_amount: 500, // $5.00 in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL}/success.html`, // URL to redirect after successful payment
            cancel_url: `${process.env.CLIENT_URL}/cancel.html`,   // URL to redirect after canceled payment
            client_reference_id: userId, // Pass the user ID to the webhook
        });

        res.json({ id: session.id });
    } catch (error) {
        console.error('Stripe session error:', error);
        res.status(500).json({ error: 'Failed to create payment session.' });
    }
});

/**
 * Endpoint: /webhook-payment-success
 * Method: POST
 * Description: Stripe webhook to handle successful payment events.
 */
app.post('/webhook-payment-success', express.raw({type: 'application/json'}), (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const db = readDB();
        const user = db.users[userId];

        if (user) {
            // Update the database with new token balance
            user.tokens += 5; // Add 5 tokens for this purchase
            writeDB(db);
            console.log(`Payment successful for user ${userId}. New token balance: ${user.tokens}`);
        } else {
            console.error(`Webhook received for unknown user ID: ${userId}`);
        }
    }

    res.json({received: true});
});


// --- HELPER FUNCTIONS ---

/**
 * Parses a document file buffer using PDF.co API with fallback.
 * @param {File} file - The file object from multer.
 * @returns {Promise<string>} The extracted text content.
 */
async function parseDocumentWithPdfCo(file) {
    try {
        // For PDF files, use PDF.co text extraction
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
            try {
                const FormData = require('form-data');
                const formData = new FormData();
                formData.append('file', file.buffer, {
                    filename: file.originalname,
                    contentType: file.mimetype
                });

                const response = await axios.post('https://api.pdf.co/v1/pdf/convert/to/text', formData, {
                    headers: {
                        'x-api-key': PDF_CO_API_KEY,
                        ...formData.getHeaders()
                    }
                });

                if (response.data && response.data.body) {
                    return response.data.body;
                } else {
                    throw new Error('No text content returned from PDF.co API');
                }
            } catch (pdfCoError) {
                console.error('PDF.co failed, trying fallback:', pdfCoError.message);
                // Fallback to pdf-parse
                const data = await pdfParse(file.buffer);
                return data.text;
            }
        } else {
            // For text files, just convert buffer to string
            return file.buffer.toString('utf8');
        }
    } catch (error) {
        console.error('Document parsing error:', error.message);
        throw new Error('Failed to parse document: ' + error.message);
    }
}

/**
 * Generates content using OpenAI GPT-4o.
 * @returns {Promise<object>} An object with `tailoredResume` and `coverLetter`.
 */
async function generateContentWithGemini(resumeText, profileText, jobDescription) {
    const prompt = `You are an expert resume and cover letter writer. Your task is to tailor the provided resume and generate a cover letter based on the job description. Profile text is optional but can provide more context.\n\nResume Text:\n${resumeText}\n\nProfile Text:\n${profileText}\n\nJob Description:\n${jobDescription}\n\nBased on the above, generate a tailored resume and a cover letter.\n\nRespond with a JSON object containing two keys: 'tailoredResume' and 'coverLetter'. Do not include any other text or formatting in your response.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();

    // Clean the response to ensure it's valid JSON
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedText);
}

/**
 * Creates a DOCX file buffer from text with proper formatting.
 * @param {string} textContent - The text to put in the document.
 * @returns {Promise<Buffer>} A buffer of the DOCX file.
 */
async function createDocx(sections) {
    const doc = new Document({
        sections: [{
            properties: {},
            children: sections.map(section => 
                new Paragraph({
                    children: [new TextRun({
                        text: section.text,
                        bold: section.isHeader,
                        size: section.isHeader ? 28 : 24
                    })]
                })
            )
        }],
    });
    return await Packer.toBuffer(doc);
}

/**
 * Parse resume content into structured sections.
 * @param {string} textContent - The raw text content.
 * @returns {Array} Array of formatted sections.
 */
function parseResumeContent(textContent) {
    const lines = textContent.split('\n');
    const sections = [];
    
    lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            // Detect headers (simple heuristic)
            const isHeader = trimmedLine.length < 50 && 
                            (trimmedLine.toUpperCase() === trimmedLine || 
                             trimmedLine.endsWith(':'));
            
            sections.push({
                text: trimmedLine,
                isHeader: isHeader
            });
        }
    });
    
    return sections;
}

/**
 * Creates a PDF file buffer from text.
 * @param {string} textContent - The text to put in the document.
 * @returns {Promise<Buffer>} A buffer of the PDF file.
 */
async function createPdf(sections) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { height } = page.getSize();
    const fontSize = 12;
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.Helvetica-Bold);

    let y = height - 50;
    sections.forEach(section => {
        page.drawText(section.text, {
            x: 50,
            y: y,
            size: fontSize,
            font: section.isHeader ? helveticaBold : helvetica,
            color: rgb(0, 0, 0),
        });
        y -= (fontSize + 6); // Move to the next line
    });

    return await pdfDoc.save();
}

/**
 * Extract job description from HTML content.
 * @param {string} htmlContent - The HTML content of the job posting page.
 * @returns {string} Extracted job description.
 */
function extractJobFromHTML(htmlContent) {
    // Simple text extraction - remove HTML tags and clean up
    const textContent = htmlContent
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Try to find job-specific sections
    const jobKeywords = ['responsibilities', 'requirements', 'qualifications', 'skills', 'experience'];
    const lines = textContent.split('\n');
    const relevantLines = [];
    
    let foundJobSection = false;
    for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (jobKeywords.some(keyword => lowerLine.includes(keyword))) {
            foundJobSection = true;
        }
        if (foundJobSection && line.trim().length > 20) {
            relevantLines.push(line.trim());
        }
        if (relevantLines.length > 50) break; // Limit length
    }
    
    return relevantLines.length > 0 ? relevantLines.join('\n') : textContent.substring(0, 2000);
}

// --- DEVELOPMENT TEST ENDPOINTS ---
if (process.env.NODE_ENV === 'development') {
    app.get('/test/health', (req, res) => {
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    });
    
    app.post('/test/generate-mock', (req, res) => {
        res.json({
            resumeText: 'Mock resume content',
            aiResponse: {
                tailoredResume: 'Mock tailored resume',
                coverLetter: 'Mock cover letter'
            },
            message: 'This is a test endpoint with mock data'
        });
    });
}

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
