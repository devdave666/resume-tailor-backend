// Resume Tailor Chrome Extension - Popup Script

const API_BASE = 'https://resume-tailor-kgrrlzdqk-devkumar-daves-projects.vercel.app';
const TEST_MODE = true; // Set to false when API is working
const ADMIN_EMAIL = 'devdave666@gmail.com'; // Free access for admin

class ResumeTailorApp {
    constructor() {
        this.currentUser = null;
        this.currentJob = null;
        this.uploadedFile = null;
        this.isAuthMode = 'login';

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkAuthStatus();
        await this.loadStoredJobData();
        this.detectJobOnCurrentPage();

        // Show test mode badge if in test mode
        if (TEST_MODE) {
            document.getElementById('test-mode-badge').classList.remove('hidden');
        }
    }

    async loadStoredJobData() {
        try {
            const result = await chrome.storage.local.get(['currentJobData']);
            if (result.currentJobData) {
                console.log('Found stored job data:', result.currentJobData);
                this.currentJob = result.currentJobData;
                this.showJobDetected();
                
                // Pre-fill job description if available
                if (this.currentJob.description) {
                    document.getElementById('manual-job').value = this.currentJob.description;
                    this.updateGenerateButton();
                }
                
                // Clear the stored data after using it
                await chrome.storage.local.remove(['currentJobData']);
                
                // Show success notification
                this.showNotification('Job details loaded from LinkedIn!', 'success');
            }
        } catch (error) {
            console.error('Error loading stored job data:', error);
        }
    }

    setupEventListeners() {
        // Auth tabs
        document.getElementById('login-tab').addEventListener('click', () => this.switchAuthMode('login'));
        document.getElementById('register-tab').addEventListener('click', () => this.switchAuthMode('register'));

        // Auth form
        document.getElementById('auth-form').addEventListener('submit', (e) => this.handleAuth(e));

        // File upload
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('resume-file');

        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        uploadArea.addEventListener('drop', (e) => this.handleFileDrop(e));
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        document.getElementById('remove-file').addEventListener('click', () => this.removeFile());

        // Job extraction
        document.getElementById('extract-job').addEventListener('click', () => this.extractJobFromPage());

        // Generate button
        document.getElementById('generate-btn').addEventListener('click', () => {
            const hasTokens = parseInt(document.getElementById('token-count').textContent) > 0;
            if (hasTokens) {
                this.generateResume();
            } else {
                this.buyTokens();
            }
        });

        // Result tabs
        document.getElementById('resume-tab').addEventListener('click', () => this.showResultTab('resume'));
        document.getElementById('cover-tab').addEventListener('click', () => this.showResultTab('cover'));

        // Result actions
        document.getElementById('copy-result').addEventListener('click', () => this.copyResult());
        document.getElementById('download-result').addEventListener('click', () => this.downloadResult());

        // Buy tokens
        document.getElementById('buy-tokens').addEventListener('click', () => this.buyTokens());

        // Logout
        document.getElementById('logout').addEventListener('click', () => this.logout());
    }

    switchAuthMode(mode) {
        this.isAuthMode = mode;
        const loginTab = document.getElementById('login-tab');
        const registerTab = document.getElementById('register-tab');
        const submitBtn = document.getElementById('auth-submit');

        if (mode === 'login') {
            loginTab.classList.add('active');
            registerTab.classList.remove('active');
            submitBtn.textContent = 'Login';
        } else {
            loginTab.classList.remove('active');
            registerTab.classList.add('active');
            submitBtn.textContent = 'Sign Up';
        }
    }

    async checkAuthStatus() {
        try {
            const userData = await this.getStoredUserData();
            if (userData && userData.session) {
                this.currentUser = userData;
                await this.loadUserTokens();
                this.showMainSection();
            } else {
                this.showAuthSection();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.showAuthSection();
        }
    }

    async handleAuth(e) {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const submitBtn = document.getElementById('auth-submit');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        try {
            // TEST MODE: Simulate successful authentication
            if (TEST_MODE) {
                console.log('TEST MODE: Simulating authentication');

                // Give admin email unlimited tokens
                const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
                const tokens = isAdmin ? 999 : 0;

                // Create mock user data
                const mockUser = {
                    user: {
                        id: 'test-user-' + Date.now(),
                        email: email,
                        user_metadata: { tokens: tokens, isAdmin: isAdmin }
                    },
                    session: {
                        access_token: 'test-token-' + Date.now()
                    }
                };

                this.currentUser = mockUser;
                await this.storeUserData(mockUser);
                await this.loadUserTokens();
                this.showMainSection();
                this.showNotification(`${this.isAuthMode === 'login' ? 'Login' : 'Registration'} successful! ${isAdmin ? '(Admin Access)' : '(Test Mode)'}`, 'success');
                return;
            }

            const endpoint = this.isAuthMode === 'login' ? '/auth/login' : '/auth/register';

            console.log('Attempting to connect to:', `${API_BASE}${endpoint}`);

            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ email, password }),
                mode: 'cors'
            });

            console.log('Response status:', response.status);

            if (!response.ok) {
                // Try to get error message from response
                let errorMessage = 'Authentication failed';
                try {
                    const errorData = await response.text();
                    console.log('Error response:', errorData);

                    // Check if it's HTML (Vercel auth page)
                    if (errorData.includes('Authentication Required') || errorData.includes('Vercel Authentication')) {
                        errorMessage = 'API is currently being set up. Please try the test mode for now.';
                    } else {
                        // Try to parse as JSON
                        const jsonError = JSON.parse(errorData);
                        errorMessage = jsonError.error || errorMessage;
                    }
                } catch (parseError) {
                    console.log('Could not parse error response');
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();

            if (data) {
                this.currentUser = data;
                await this.storeUserData(data);
                await this.loadUserTokens();
                this.showMainSection();
                this.showNotification(`${this.isAuthMode === 'login' ? 'Login' : 'Registration'} successful!`, 'success');
            } else {
                throw new Error('Invalid response from server');
            }
        } catch (error) {
            console.error('Auth error:', error);
            this.showNotification(error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = this.isAuthMode === 'login' ? 'Login' : 'Sign Up';
        }
    }

    async loadUserTokens() {
        try {
            if (TEST_MODE) {
                // In test mode, use tokens from user metadata
                const tokens = this.currentUser.user.user_metadata?.tokens || 0;
                const isAdmin = this.currentUser.user.user_metadata?.isAdmin || false;

                // Show infinity symbol for admin
                document.getElementById('token-count').textContent = isAdmin ? '∞' : tokens;
                this.updateGenerateButton();
                return;
            }

            const response = await fetch(`${API_BASE}/get-token-balance`, {
                headers: { 'Authorization': `Bearer ${this.currentUser.session.access_token}` }
            });

            if (response.ok) {
                const data = await response.json();
                document.getElementById('token-count').textContent = data.tokens;
                this.updateGenerateButton();
            }
        } catch (error) {
            console.error('Failed to load tokens:', error);
            // Fallback to stored tokens
            const tokens = this.currentUser.user.user_metadata?.tokens || 0;
            document.getElementById('token-count').textContent = tokens;
            this.updateGenerateButton();
        }
    }

    async detectJobOnCurrentPage() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (this.isJobSite(tab.url)) {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: this.extractJobInfo
                });

                if (results[0]?.result) {
                    this.currentJob = results[0].result;
                    this.showJobDetected();
                }
            }
        } catch (error) {
            console.error('Job detection failed:', error);
        }
    }

    isJobSite(url) {
        const jobSites = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com', 'ziprecruiter.com'];
        return jobSites.some(site => url.includes(site));
    }

    extractJobInfo() {
        // This function runs in the context of the job site page
        const selectors = {
            linkedin: {
                title: '.top-card-layout__title, .job-details-jobs-unified-top-card__job-title',
                company: '.top-card-layout__card .topcard__flavor--black-link, .job-details-jobs-unified-top-card__company-name',
                description: '.description__text, .jobs-description-content__text'
            },
            indeed: {
                title: '[data-jk] h1, .jobsearch-JobInfoHeader-title',
                company: '[data-jk] .company, .jobsearch-CompanyInfoContainer',
                description: '.jobsearch-jobDescriptionText, #jobDescriptionText'
            },
            glassdoor: {
                title: '.job-title, [data-test="job-title"]',
                company: '.employer-name, [data-test="employer-name"]',
                description: '.job-description, [data-test="job-description"]'
            }
        };

        const hostname = window.location.hostname;
        let siteSelectors = null;

        if (hostname.includes('linkedin.com')) siteSelectors = selectors.linkedin;
        else if (hostname.includes('indeed.com')) siteSelectors = selectors.indeed;
        else if (hostname.includes('glassdoor.com')) siteSelectors = selectors.glassdoor;

        if (!siteSelectors) return null;

        const getTextContent = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : '';
        };

        return {
            title: getTextContent(siteSelectors.title),
            company: getTextContent(siteSelectors.company),
            description: getTextContent(siteSelectors.description),
            url: window.location.href
        };
    }

    showJobDetected() {
        if (this.currentJob && this.currentJob.title) {
            document.getElementById('job-title').textContent = this.currentJob.title;
            document.getElementById('job-company').textContent = this.currentJob.company;
            document.getElementById('job-detected').classList.remove('hidden');
            document.getElementById('no-job').classList.add('hidden');
        }
    }

    async extractJobFromPage() {
        if (this.currentJob && this.currentJob.description) {
            document.getElementById('manual-job').value = this.currentJob.description;
            this.updateGenerateButton();
            this.showNotification('Job description extracted!', 'success');
        }
    }

    handleDragOver(e) {
        e.preventDefault();
        document.getElementById('upload-area').classList.add('dragover');
    }

    handleFileDrop(e) {
        e.preventDefault();
        document.getElementById('upload-area').classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];

        if (!allowedTypes.includes(file.type)) {
            this.showNotification('Please upload a PDF, DOC, DOCX, or TXT file', 'error');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showNotification('File size must be less than 10MB', 'error');
            return;
        }

        this.uploadedFile = file;
        document.getElementById('file-name').textContent = file.name;
        document.getElementById('file-info').classList.remove('hidden');
        this.updateGenerateButton();
    }

    removeFile() {
        this.uploadedFile = null;
        document.getElementById('file-info').classList.add('hidden');
        document.getElementById('resume-file').value = '';
        this.updateGenerateButton();
    }

    updateGenerateButton() {
        const generateBtn = document.getElementById('generate-btn');
        const hasFile = !!this.uploadedFile;
        const hasJob = document.getElementById('manual-job').value.trim().length > 0;
        const tokenText = document.getElementById('token-count').textContent;
        const hasTokens = parseInt(tokenText) > 0 || tokenText === '∞';
        const isAdmin = this.currentUser?.user?.user_metadata?.isAdmin || false;

        generateBtn.disabled = !(hasFile && hasJob && hasTokens);

        // Update button text based on token availability
        const btnText = generateBtn.querySelector('.btn-text');
        const btnCost = generateBtn.querySelector('.btn-cost');

        if (!hasTokens && hasFile && hasJob) {
            btnText.textContent = '💳 Buy Tokens to Generate';
            if (btnCost) btnCost.style.display = 'none';
        } else {
            btnText.textContent = '🚀 Generate Tailored Resume';
            if (btnCost) {
                btnCost.textContent = isAdmin ? '(Free for Admin)' : '(1 token)';
                btnCost.style.display = 'block';
            }
        }
    }

    async generateResume() {
        const jobDescription = document.getElementById('manual-job').value.trim();

        if (!this.uploadedFile || !jobDescription) {
            this.showNotification('Please upload a resume and enter job description', 'error');
            return;
        }

        this.showLoading(true);

        try {
            if (TEST_MODE) {
                const isAdmin = this.currentUser.user.user_metadata?.isAdmin || false;
                console.log('User metadata:', this.currentUser.user.user_metadata);
                console.log('Is admin?', isAdmin);
                console.log('User email:', this.currentUser.user.email);

                if (isAdmin) {
                    // Use real AI for admin user - call Gemini directly from extension
                    console.log('Admin user - using direct Gemini API call');

                    try {
                        // Read the resume file as text
                        const resumeText = await this.readFileAsText(this.uploadedFile);

                        // Call Gemini API directly
                        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-goog-api-key': 'AIzaSyBONTvnCVVCQrGK4ok8IfC18BL-RXbcsNQ'
                            },
                            body: JSON.stringify({
                                contents: [{
                                    parts: [{
                                        text: `You are an expert resume writer. Analyze the original resume and job description to create a tailored version.

ORIGINAL RESUME:
${resumeText}

TARGET JOB DESCRIPTION:
${jobDescription}

INSTRUCTIONS:
1. Keep the original person's name, contact info, and real experience
2. Reorganize and emphasize skills/experience that match the job requirements
3. Use keywords from the job description naturally
4. Maintain professional formatting with clear sections
5. Create a compelling cover letter that connects the person's background to this specific role

Respond with valid JSON containing exactly two keys: 'tailoredResume' and 'coverLetter'. Use proper line breaks (\n) for formatting.

{
  "tailoredResume": "FULL NAME\nPhone | Email | Location\n\nPROFESSIONAL SUMMARY\n[Tailored summary here]\n\nEXPERIENCE\n[Job titles and descriptions]\n\nSKILLS\n[Relevant skills]\n\nEDUCATION\n[Education details]",
  "coverLetter": "Dear Hiring Manager,\n\n[Personalized cover letter content]\n\nSincerely,\n[Name]"
}`
                                    }]
                                }]
                            })
                        });

                        if (geminiResponse.ok) {
                            const geminiData = await geminiResponse.json();
                            console.log('Gemini API response:', geminiData);
                            
                            const aiText = geminiData.candidates[0].content.parts[0].text;
                            console.log('AI generated text:', aiText);

                            // Parse the JSON response
                            let parsedData;
                            const jsonStart = aiText.indexOf('{');
                            const jsonEnd = aiText.lastIndexOf('}');
                            
                            if (jsonStart !== -1 && jsonEnd !== -1) {
                                const jsonText = aiText.substring(jsonStart, jsonEnd + 1);
                                parsedData = JSON.parse(jsonText);
                            } else {
                                // If no JSON found, treat the whole response as the resume
                                console.log('No JSON found, using raw response as resume');
                                parsedData = {
                                    tailoredResume: aiText,
                                    coverLetter: "Cover letter will be generated separately. Please use the tailored resume above."
                                };
                            }

                            // Format the resume properly
                            if (parsedData.tailoredResume) {
                                parsedData.tailoredResume = this.formatResumeText(parsedData.tailoredResume);
                            }

                            this.showResults(parsedData);
                            this.showNotification('Resume generated successfully! (Real Gemini AI)', 'success');
                            return;
                        } else {
                            const errorText = await geminiResponse.text();
                            console.log('Gemini API failed:', errorText);
                            throw new Error('Gemini API request failed');
                        }
                    } catch (apiError) {
                        console.error('Direct Gemini API error:', apiError);
                        this.showNotification('AI API failed, using fallback. Error: ' + apiError.message, 'error');
                        // Don't return here - let it fall through to mock for debugging
                    }
                }

                // Simulate generation in test mode (or fallback for admin)
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay

                // Check if user has tokens (skip for admin)
                const currentTokens = this.currentUser.user.user_metadata?.tokens || 0;
                if (!isAdmin && currentTokens < 1) {
                    throw new Error('Insufficient tokens. Please buy tokens first.');
                }

                // Deduct token (but not for admin)
                if (!isAdmin) {
                    this.currentUser.user.user_metadata.tokens = currentTokens - 1;
                    await this.storeUserData(this.currentUser);
                }

                // Generate mock content
                const mockData = {
                    tailoredResume: `TAILORED RESUME (TEST MODE)

PROFESSIONAL SUMMARY
Experienced professional with skills specifically aligned to the requirements mentioned in the job posting: ${jobDescription.substring(0, 100)}...

EXPERIENCE
• Previous Role - Demonstrated expertise in key areas mentioned in job description
• Achieved results relevant to the position requirements
• Led projects similar to those described in the posting

SKILLS
• Technical skills matching job requirements
• Soft skills emphasized in the job posting
• Industry-specific knowledge relevant to the role

EDUCATION
• Relevant educational background
• Certifications aligned with job requirements

This resume has been tailored to highlight your most relevant qualifications for this specific position.`,

                    coverLetter: `Dear Hiring Manager,

I am writing to express my strong interest in the position described in your job posting. After reviewing the requirements, I am confident that my background and skills make me an ideal candidate.

Key qualifications that align with your needs:
• Experience in areas specifically mentioned in your job description
• Proven track record of success in similar roles
• Skills that directly match your requirements

I am particularly excited about this opportunity because it aligns perfectly with my career goals and expertise. The role's focus on ${jobDescription.split(' ').slice(0, 10).join(' ')}... resonates with my professional experience.

I would welcome the opportunity to discuss how my background and enthusiasm can contribute to your team's success.

Best regards,
[Your Name]

(Generated in TEST MODE)`,
                    newTokenBalance: this.currentUser.user.user_metadata.tokens
                };

                this.showResults(mockData);
                document.getElementById('token-count').textContent = mockData.newTokenBalance;
                this.updateGenerateButton();
                this.showNotification('Resume generated successfully! (Test Mode)', 'success');
                return;
            }

            const formData = new FormData();
            formData.append('resume', this.uploadedFile);
            formData.append('jobDescription', jobDescription);

            const response = await fetch(`${API_BASE}/quick-generate`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.currentUser.session.access_token}` },
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                this.showResults(data);
                document.getElementById('token-count').textContent = data.newTokenBalance;
                this.updateGenerateButton();
                this.showNotification('Resume generated successfully!', 'success');
            } else {
                throw new Error(data.error || 'Generation failed');
            }
        } catch (error) {
            console.error('Generation error:', error);
            this.showNotification(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    showResults(data) {
        document.getElementById('resume-content').textContent = data.tailoredResume;
        document.getElementById('cover-content').textContent = data.coverLetter;
        document.getElementById('results-section').classList.remove('hidden');
        this.currentResults = data;
    }

    showResultTab(tab) {
        const resumeTab = document.getElementById('resume-tab');
        const coverTab = document.getElementById('cover-tab');
        const resumeContent = document.getElementById('resume-content');
        const coverContent = document.getElementById('cover-content');

        if (tab === 'resume') {
            resumeTab.classList.add('active');
            coverTab.classList.remove('active');
            resumeContent.classList.remove('hidden');
            coverContent.classList.add('hidden');
        } else {
            resumeTab.classList.remove('active');
            coverTab.classList.add('active');
            resumeContent.classList.add('hidden');
            coverContent.classList.remove('hidden');
        }
    }

    async copyResult() {
        const activeTab = document.querySelector('.result-tab.active');
        const isResume = activeTab.id === 'resume-tab';
        const content = isResume ? this.currentResults.tailoredResume : this.currentResults.coverLetter;

        try {
            await navigator.clipboard.writeText(content);
            this.showNotification('Copied to clipboard!', 'success');
        } catch (error) {
            console.error('Copy failed:', error);
            this.showNotification('Failed to copy', 'error');
        }
    }

    downloadResult() {
        const activeTab = document.querySelector('.result-tab.active');
        const isResume = activeTab.id === 'resume-tab';
        const content = isResume ? this.currentResults.tailoredResume : this.currentResults.coverLetter;
        
        // Offer multiple format options
        const format = prompt('Choose download format:\n1. TXT (text file)\n2. DOC (Word document)\n3. HTML (formatted)\n\nEnter 1, 2, or 3:', '1');
        
        let filename, mimeType, formattedContent;
        
        switch(format) {
            case '2':
                // Create a simple DOC format (RTF)
                filename = isResume ? 'tailored-resume.doc' : 'cover-letter.doc';
                mimeType = 'application/msword';
                formattedContent = this.createRTFDocument(content);
                break;
            case '3':
                // Create HTML format
                filename = isResume ? 'tailored-resume.html' : 'cover-letter.html';
                mimeType = 'text/html';
                formattedContent = this.createHTMLDocument(content, isResume ? 'Tailored Resume' : 'Cover Letter');
                break;
            default:
                // Default to TXT
                filename = isResume ? 'tailored-resume.txt' : 'cover-letter.txt';
                mimeType = 'text/plain';
                formattedContent = content;
        }

        const blob = new Blob([formattedContent], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    async buyTokens() {
        try {
            if (TEST_MODE) {
                // In test mode, simulate buying tokens
                const confirmed = confirm('TEST MODE: Simulate buying 10 tokens for $5?');
                if (confirmed) {
                    // Add tokens to user
                    this.currentUser.user.user_metadata.tokens = (this.currentUser.user.user_metadata.tokens || 0) + 10;
                    await this.storeUserData(this.currentUser);
                    document.getElementById('token-count').textContent = this.currentUser.user.user_metadata.tokens;
                    this.updateGenerateButton();
                    this.showNotification('Test purchase successful! Added 10 tokens.', 'success');
                }
                return;
            }

            const response = await fetch(`${API_BASE}/create-payment-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentUser.session.access_token}`
                },
                body: JSON.stringify({ packageType: 'starter' })
            });

            const data = await response.json();

            if (response.ok) {
                chrome.tabs.create({ url: data.url });
            } else {
                throw new Error(data.error || 'Payment session creation failed');
            }
        } catch (error) {
            console.error('Payment error:', error);
            this.showNotification(error.message, 'error');
        }
    }

    showLoading(show) {
        document.getElementById('loading').classList.toggle('hidden', !show);
        document.getElementById('main-section').classList.toggle('hidden', show);
    }

    showAuthSection() {
        document.getElementById('auth-section').classList.remove('hidden');
        document.getElementById('main-section').classList.add('hidden');
        document.getElementById('logout').classList.add('hidden');
    }

    showMainSection() {
        document.getElementById('auth-section').classList.add('hidden');
        document.getElementById('main-section').classList.remove('hidden');
        document.getElementById('logout').classList.remove('hidden');
    }

    async logout() {
        await chrome.storage.local.clear();
        this.currentUser = null;
        this.showAuthSection();
        this.showNotification('Logged out successfully', 'success');
    }

    async storeUserData(userData) {
        await chrome.storage.local.set({ userData });
    }

    async getStoredUserData() {
        const result = await chrome.storage.local.get(['userData']);
        return result.userData;
    }

    async readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    formatResumeText(text) {
        // Add proper line breaks and formatting
        return text
            .replace(/\*\*(.*?)\*\*/g, '$1') // Remove markdown bold
            .replace(/\* /g, '• ') // Convert * to bullet points
            .replace(/([A-Z][a-z]+ [A-Z][a-z]+)\s*\|/g, '\n$1 |') // Add line breaks before job titles
            .replace(/\|\s*([A-Z][a-z]+ \d{4})/g, '| $1') // Format dates
            .replace(/([a-z])\s*\*\s*([A-Z])/g, '$1\n• $2') // Add line breaks before bullet points
            .replace(/\n\s*\n/g, '\n\n') // Clean up multiple line breaks
            .trim();
    }

    createRTFDocument(content) {
        // Create a simple RTF document that Word can open
        const rtfHeader = '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}';
        const rtfContent = content
            .replace(/\n/g, '\\par ')
            .replace(/•/g, '\\bullet ')
            .replace(/([A-Z][A-Z\s]+)/g, '{\\b $1}'); // Bold uppercase sections
        return rtfHeader + rtfContent + '}';
    }

    createHTMLDocument(content, title) {
        const htmlContent = content
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/•/g, '&bull;')
            .replace(/([A-Z][A-Z\s]+)/g, '<strong>$1</strong>'); // Bold uppercase sections

        return `<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 40px; }
        p { margin-bottom: 15px; }
        strong { font-weight: bold; }
    </style>
</head>
<body>
    <p>${htmlContent}</p>
</body>
</html>`;
    }

    showNotification(message, type = 'info') {
        // Simple notification - you could enhance this with a proper notification system
        console.log(`${type.toUpperCase()}: ${message}`);

        // Create a simple toast notification
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 12px 16px;
            background: ${type === 'success' ? '#48bb78' : type === 'error' ? '#e53e3e' : '#667eea'};
            color: white;
            border-radius: 4px;
            font-size: 13px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
}

// Initialize the app when the popup loads
document.addEventListener('DOMContentLoaded', () => {
    new ResumeTailorApp();
});

// Listen for job description changes
document.addEventListener('input', (e) => {
    if (e.target.id === 'manual-job') {
        // Update generate button state when job description changes
        setTimeout(() => {
            const event = new CustomEvent('updateGenerateButton');
            document.dispatchEvent(event);
        }, 100);
    }
});

document.addEventListener('updateGenerateButton', () => {
    if (window.resumeTailorApp) {
        window.resumeTailorApp.updateGenerateButton();
    }
});