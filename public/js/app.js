// Check token balance
async function checkBalance() {
    console.log('Checking token balance...');
    const balanceDiv = document.getElementById('tokenBalance');
    try {
        console.log('Making request to /get-token-balance');
        const response = await fetch('/get-token-balance');
        console.log('Response status:', response.status);
        const data = await response.json();
        console.log('Response data:', data);
        
        balanceDiv.className = 'status success';
        balanceDiv.textContent = `Available tokens: ${data.tokens}`;
    } catch (error) {
        console.error('Error checking balance:', error);
        balanceDiv.className = 'status error';
        balanceDiv.textContent = `Error: ${error.message}`;
    }
}

// Generate tailored resume
async function generateResume() {
    console.log('Generate resume function called');
    const generateBtn = document.getElementById('generateBtn');
    const statusDiv = document.getElementById('generateStatus');
    const downloadDiv = document.getElementById('downloadLinks');
    const downloadsDiv = document.getElementById('downloads');

    generateBtn.disabled = true;
    statusDiv.style.display = 'block';
    statusDiv.className = 'status';
    statusDiv.textContent = 'Generating documents...';
    downloadDiv.style.display = 'none';

    try {
        const formData = new FormData();
        const resumeFile = document.getElementById('resume').files[0];
        const profileFile = document.getElementById('profile').files[0];
        const jobDescription = document.getElementById('jobDescription').value;

        console.log('Form data:', {
            resumeFile: resumeFile ? resumeFile.name : 'No resume file',
            profileFile: profileFile ? profileFile.name : 'No profile file',
            jobDescription: jobDescription ? 'Present' : 'Missing'
        });

        if (!resumeFile || !jobDescription) {
            throw new Error('Resume and job description are required');
        }

        formData.append('resume', resumeFile);
        if (profileFile) {
            formData.append('profile', profileFile);
        }
        formData.append('jobDescription', jobDescription);

        console.log('Sending request to /generate endpoint');
        const response = await fetch('/generate', {
            method: 'POST',
            body: formData
        });
        console.log('Response status:', response.status);

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Generation failed');
        }

        const data = await response.json();
        
        // Update token balance
        const balanceDiv = document.getElementById('tokenBalance');
        balanceDiv.className = 'status success';
        balanceDiv.textContent = `Available tokens: ${data.newTokenBalance}`;

        // Create download links
        statusDiv.className = 'status success';
        statusDiv.textContent = 'Documents generated successfully!';
        downloadDiv.style.display = 'block';
        downloadsDiv.innerHTML = `
            <a href="${data.resumeDocx}" download="tailored-resume.docx" class="download-link">Download Resume (DOCX)</a>
            <a href="${data.resumePdf}" download="tailored-resume.pdf" class="download-link">Download Resume (PDF)</a>
            <a href="${data.coverLetterDocx}" download="cover-letter.docx" class="download-link">Download Cover Letter (DOCX)</a>
            <a href="${data.coverLetterPdf}" download="cover-letter.pdf" class="download-link">Download Cover Letter (PDF)</a>
        `;
    } catch (error) {
        statusDiv.className = 'status error';
        statusDiv.textContent = `Error: ${error.message}`;
    } finally {
        generateBtn.disabled = false;
    }
}

// Initialize when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initial token balance check
    checkBalance();

    // Add event listeners
    document.getElementById('checkBalanceBtn').addEventListener('click', checkBalance);
    document.getElementById('generateBtn').addEventListener('click', generateResume);
});
