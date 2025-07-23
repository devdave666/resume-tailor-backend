// Test endpoint for Vercel serverless function

export default function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Test response
    res.status(200).json({
        message: 'Resume Tailor API is working!',
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.url
    });
}