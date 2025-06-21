
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function testAPI() {
    const baseURL = 'http://localhost:3000';
    
    console.log('🧪 Testing Resume Tailor API...\n');
    
    // Test 1: Check token balance
    console.log('1. Testing token balance...');
    try {
        const response = await axios.get(`${baseURL}/get-token-balance`);
        console.log('✅ Token balance:', response.data.tokens);
    } catch (error) {
        console.error('❌ Token balance failed:', error.response?.data || error.message);
        return;
    }
    
    // Test 2: Test AI generation with mock data
    console.log('\n2. Testing AI generation...');
    try {
        // Create a simple test PDF content
        const testResumeContent = Buffer.from(`
John Doe
Software Engineer
Email: john@example.com
Phone: (555) 123-4567

EXPERIENCE
Software Developer at Tech Corp (2020-2023)
- Developed web applications using JavaScript and React
- Collaborated with cross-functional teams
- Implemented automated testing procedures

EDUCATION
Bachelor of Science in Computer Science
University of Technology (2016-2020)

SKILLS
- JavaScript, React, Node.js
- Python, SQL
- Git, Docker
        `);
        
        const formData = new FormData();
        formData.append('resume', testResumeContent, {
            filename: 'test-resume.txt',
            contentType: 'text/plain'
        });
        formData.append('jobDescription', `
We are looking for a Senior Frontend Developer to join our team.

Requirements:
- 3+ years of experience with React
- Strong JavaScript skills
- Experience with modern web technologies
- Bachelor's degree in Computer Science or related field

Responsibilities:
- Build responsive web applications
- Collaborate with design and backend teams
- Write clean, maintainable code
- Participate in code reviews
        `);
        
        const response = await axios.post(`${baseURL}/generate`, formData, {
            headers: formData.getHeaders(),
            timeout: 60000 // 1 minute timeout for AI generation
        });
        
        console.log('✅ AI generation successful!');
        console.log('✅ Generated files:', Object.keys(response.data));
        console.log('✅ New token balance:', response.data.newTokenBalance);
        
        // Check if all expected files are present
        const expectedFiles = ['resumeDocx', 'resumePdf', 'coverLetterDocx', 'coverLetterPdf'];
        const missingFiles = expectedFiles.filter(file => !response.data[file]);
        
        if (missingFiles.length === 0) {
            console.log('✅ All document formats generated successfully');
        } else {
            console.log('⚠️ Missing files:', missingFiles);
        }
        
    } catch (error) {
        console.error('❌ AI generation failed:', error.response?.data || error.message);
        
        if (error.code === 'ECONNABORTED') {
            console.log('💡 This might be due to API timeout. Check your OpenAI API key and rate limits.');
        }
        
        return;
    }
    
    console.log('\n🎉 All tests completed successfully! Your API integration is working.');
}

// Run the test
testAPI().catch(console.error);
