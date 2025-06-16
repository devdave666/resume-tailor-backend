// server.js
// Secure backend for the Resume Tailor Chrome Extension

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { OpenAI } = require('openai');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
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
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PDF_CO_API_KEY = process.env.PDF_CO_API_KEY;

// --- MIDDLEWARE ---
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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

// Initialize database
initializeDB();

// --- API ENDPOINTS ---

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
app.post('/generate', upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'profile', maxCount: 1 }]), async (req, res) => {
    console.log('Received /generate request');

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
        // For testing, we'll use placeholder text instead of actual PDF parsing
        const resumeText = "Test resume content - " + resumeFile.originalname;
        const profileText = profileFile ? "Test profile content - " + profileFile.originalname : "Not provided.";        // --- 2. Generate Content with OpenAI ---
        console.log('Generating content with AI...');
        // For testing, we'll use mock AI responses
        const aiResponse = {
            tailoredResume: `Tailored Resume (Test)\n\nBased on: ${resumeText}\nJob Description: ${jobDescription}\nProfile: ${profileText}`,
            coverLetter: `Cover Letter (Test)\n\nBased on the job description: ${jobDescription}`
        };

        // --- 3. Generate DOCX and PDF Files ---
        console.log('Generating document files...');
        const { tailoredResume, coverLetter } = aiResponse;
        const resumeDocxBuffer = await createDocx(tailoredResume);
        const coverLetterDocxBuffer = await createDocx(coverLetter);
        const resumePdfBuffer = await createPdf(tailoredResume);
        const coverLetterPdfBuffer = await createPdf(coverLetter);

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
 * Parses a document file buffer using PDF.co API.
 * @param {File} file - The file object from multer.
 * @returns {Promise<string>} The extracted text content.
 */
async function parseDocumentWithPdfCo(file) {
    try {
        // For PDF files, use PDF.co text extraction
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
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
        } else {
            // For text files, just convert buffer to string
            return file.buffer.toString('utf8');
        }
    } catch (error) {
        console.error('PDF.co API Error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to parse document.');
    }
}

/**
 * Generates content using OpenAI GPT-4o.
 * @returns {Promise<object>} An object with `tailoredResume` and `coverLetter`.
 */
async function generateContentWithOpenAI(resumeText, profileText, jobDescription) {
    const prompt = `
        You are an expert career coach and professional resume writer. Your task is to rewrite a user's resume and generate a cover letter to be perfectly tailored for a specific job description.

        Follow these instructions carefully:
        1.  **Analyze the Job Description:** Identify the key skills, qualifications, responsibilities, and keywords.
        2.  **Tailor the Resume:** Rewrite the user's resume. Do not just copy and paste. Rephrase bullet points and summaries to directly reflect the requirements of the job description. Use strong action verbs. The tone should be highly professional.
        3.  **Generate the Cover Letter:** Write a concise, compelling, and professional cover letter. It must:
            - Express clear interest in the specific role and company.
            - Briefly highlight 2-3 of the most relevant skills or experiences from the tailored resume.
            - Maintain a professional and enthusiastic tone.
            - Be addressed to "Dear Hiring Manager," unless a name is available.

        **Job Description:**
        ---
        ${jobDescription}
        ---

        **User's Current Resume:**
        ---
        ${resumeText}
        ---

        **User's LinkedIn Profile (for additional context):**
        ---
        ${profileText}
        ---

        Return your response as a single JSON object with two keys: "tailoredResume" and "coverLetter". The value for each key should be a single string containing the full text of the document.
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });
    
    return JSON.parse(response.choices[0].message.content);
}

/**
 * Creates a DOCX file buffer from text.
 * @param {string} textContent - The text to put in the document.
 * @returns {Promise<Buffer>} A buffer of the DOCX file.
 */
async function createDocx(textContent) {
    const doc = new Document({
        sections: [{
            properties: {},
            children: [
                new Paragraph({
                    children: [new TextRun(textContent)]
                })
            ]
        }],
    });
    return await Packer.toBuffer(doc);
}

/**
 * Creates a PDF file buffer from text.
 * @param {string} textContent - The text to put in the document.
 * @returns {Promise<Buffer>} A buffer of the PDF file.
 */
async function createPdf(textContent) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { height, width } = page.getSize();
    const fontSize = 12;
    
    page.drawText(textContent, {
        x: 50,
        y: height - 50,
        size: fontSize,
        color: rgb(0, 0, 0),
    });

    return await pdfDoc.save();
}

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

