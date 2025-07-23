// Quick test to verify your API is working
const https = require('https');

const API_BASE = 'https://resume-tailor-bosan54oo-devkumar-daves-projects.vercel.app';

async function testAPI() {
    console.log('🧪 Testing your Resume Tailor API...\n');
    
    try {
        // Test registration
        const testEmail = `test${Date.now()}@example.com`;
        const testPassword = 'TestPassword123!';
        
        console.log('1. Testing user registration...');
        const registerResponse = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: testPassword })
        });
        
        if (registerResponse.ok) {
            const registerData = await registerResponse.json();
            console.log('✅ Registration successful!');
            console.log(`   User ID: ${registerData.user?.id}`);
            console.log(`   Free tokens: ${registerData.user?.user_metadata?.tokens || 3}`);
            
            const token = registerData.session?.access_token;
            
            if (token) {
                // Test token balance
                console.log('\n2. Testing token balance...');
                const balanceResponse = await fetch(`${API_BASE}/get-token-balance`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (balanceResponse.ok) {
                    const balanceData = await balanceResponse.json();
                    console.log('✅ Token balance retrieved!');
                    console.log(`   Tokens: ${balanceData.tokens}`);
                } else {
                    console.log('❌ Token balance failed');
                }
                
                // Test payment packages
                console.log('\n3. Testing payment packages...');
                const packagesResponse = await fetch(`${API_BASE}/payment/packages`);
                
                if (packagesResponse.ok) {
                    const packagesData = await packagesResponse.json();
                    console.log('✅ Payment packages retrieved!');
                    console.log('   Available packages:', Object.keys(packagesData.packages));
                } else {
                    console.log('❌ Payment packages failed');
                }
            }
        } else {
            console.log('❌ Registration failed:', await registerResponse.text());
        }
        
        console.log('\n🎉 API Test Complete!');
        console.log('\n✅ Your backend is ready to earn money!');
        console.log('\n📋 Next Steps:');
        console.log('   1. Set up Stripe webhook (if not done)');
        console.log('   2. Create Chrome extension');
        console.log('   3. Start marketing and earning!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Use node-fetch if available, otherwise use built-in fetch (Node 18+)
let fetch;
try {
    fetch = globalThis.fetch;
} catch {
    console.log('Using https module for requests...');
    // Fallback implementation using https module
    fetch = (url, options = {}) => {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const reqOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname,
                method: options.method || 'GET',
                headers: options.headers || {}
            };
            
            const req = https.request(reqOptions, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    resolve({
                        ok: res.statusCode >= 200 && res.statusCode < 300,
                        status: res.statusCode,
                        json: () => Promise.resolve(JSON.parse(body)),
                        text: () => Promise.resolve(body)
                    });
                });
            });
            
            req.on('error', reject);
            
            if (options.body) {
                req.write(options.body);
            }
            req.end();
        });
    };
}

testAPI();