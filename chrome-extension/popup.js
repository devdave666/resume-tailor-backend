// Popup JavaScript for Resume Tailor Chrome Extension
// Handles UI interactions, API calls, and user authentication

class ResumeTrailerApp {
    constructor() {
        this.apiUrl = 'https://your-vercel-app.vercel.app/api'; // Replace with your Vercel URL
        this.currentUser = null;
        this.currentSession = null;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkAuthStatus();
        this.setupFileUpload();
    }

    setupEventListeners() {
        // Auth tabs
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Auth forms
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('registerForm').addEventListener('submit', (e) => this.handleRegister(e));

        // Main app actions
        document.getElementById('extractBtn').addEventListener('click', () => this.extractJobDescription());
        document.getElementById('generateBtn').addEventListener('click', () => this.generateResume());
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());

        // File upload
        document.getElementById('uploadArea').addEventListener('click', () => {
            document.getElementById('resumeFile').click();
        });
        document.getElementById('removeFile').addEventListener('click', () => this.removeFile());

        // Result actions
        document.getElementById('copyBtn').addEventListener('click', () => this.copyResult());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadResult());

        // Token packages
        document.querySelectorAll('.package').forEach(pkg => {
            pkg.addEventListener('click', (e) => this.purchaseTokens(e.currentTarget.dataset.package));
        });

        // Toast close
        document.getElementById('toastClose').addEventListener('click', () => this.hideToast());

        // Support button
        document.getElementById('supportBtn').addEventListener('click', () => {
            chrome.tabs.create({ url: 'mailto:support@resumetailor.com' });
        });
    }

    setupFileUpload() {
        const fileInput = document.getElementById('resumeFile');
        const uploadArea = document.getElementById('uploadArea');

        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) this.handleFileSelect(file);
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}Tab`);
        });
    }

    async checkAuthStatus() {
        try {
            const stored = await chrome.storage.local.get(['session', 'user']);
            if (stored.session && stored.user) {
                this.currentSession = stored.session;
                this.currentUser = stored.user;
                await this.loadUserProfile();
                this.showApp();
            } else {
                this.showAuth();
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            this.showAuth();
        }
    }

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login failed');
            }

            this.currentSession = data.session;
            this.currentUser = data.user;

            await chrome.storage.local.set({
                session: data.session,
                user: data.user
            });

            await this.loadUserProfile();
            this.showApp();
            this.showToast('Welcome back!', 'success');

        } catch (error) {
            this.showToast(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;

        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters', 'error');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            this.currentSession = data.session;
            this.currentUser = data.user;

            await chrome.storage.local.set({
                session: data.session,
                user: data.user
            });

            await this.loadUserProfile();
            this.showApp();
            this.showToast('Account created! You have 3 free tokens.', 'success');

        } catch (error) {
            this.showToast(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async loadUserProfile() {
        try {
            const response = await fetch(`${this.apiUrl}/user/profile`, {
                headers: {
                    'Authorization': `Bearer ${this.currentSession.access_token}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                this.updateTokenDisplay(data.tokens);
                this.updateGenerateButton(data.tokens > 0);
            }
        } catch (error) {
            console.error('Failed to load profile:', error);
        }
    }

    async extractJobDescription() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: this.extractJobFromPage
            });

            const jobText = results[0].result;
            
            if (jobText && jobText.trim()) {
                document.getElementById('jobDescription').value = jobText;
                this.showToast('Job description extracted!', 'success');
                this.checkGenerateReady();
            } else {
                this.showToast('No job description found on this page', 'error');
            }
        } catch (error) {
            console.error('Extraction failed:', error);
            this.showToast('Failed to extract job description', 'error');
        }
    }

    extractJobFromPage() {
        // Job extraction logic for different sites
        const selectors = [
            // LinkedIn
            '.jobs-description-content__text',
            '.jobs-box__html-content',
            '.description__text',
            
            // Indeed
            '.jobsearch-jobDescriptionText',
            '.jobsearch-JobComponent-description',
            '#jobDescriptionText',
            
            // Glassdoor
            '.jobDescriptionContent',
            '.desc',
            
            // Generic
            '[class*="job-description"]',
            '[class*="description"]',
            '[id*="job-description"]',
            '[id*="description"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                let text = element.innerText || element.textContent;
                text = text.trim();
                if (text.length > 100) { // Ensure it's substantial content
                    return text;
                }
            }
        }

        // Fallback: look for any substantial text content
        const bodyText = document.body.innerText;
        const words = bodyText.split(/\s+/);
        if (words.length > 50) {
            return words.slice(0, 500).join(' '); // First 500 words
        }

        return '';
    }

    handleFileSelect(file) {
        if (!file) return;

        // Validate file type
        const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
        if (!allowedTypes.includes(file.type)) {
            this.showToast('Please upload a PDF, DOCX, or TXT file', 'error');
            return;
        }

        // Validate file size (5MB)
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('File size must be less than 5MB', 'error');
            return;
        }

        // Show file info
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('uploadArea').classList.add('hidden');
        document.getElementById('fileInfo').classList.remove('hidden');

        // Store file for later use
        this.selectedFile = file;
        this.checkGenerateReady();
    }

    removeFile() {
        this.selectedFile = null;
        document.getElementById('uploadArea').classList.remove('hidden');
        document.getElementById('fileInfo').classList.add('hidden');
        document.getElementById('resumeFile').value = '';
        this.checkGenerateReady();
    }

    checkGenerateReady() {
        const hasJob = document.getElementById('jobDescription').value.trim().length > 0;
        const hasFile = !!this.selectedFile;
        const generateBtn = document.getElementById('generateBtn');
        
        generateBtn.disabled = !(hasJob && hasFile);
    }

    async generateResume() {
        if (!this.selectedFile) {
            this.showToast('Please upload your resume', 'error');
            return;
        }

        const jobDescription = document.getElementById('jobDescription').value.trim();
        if (!jobDescription) {
            this.showToast('Please enter a job description', 'error');
            return;
        }

        this.showLoading(true);
        this.toggleGenerateButton(true);

        try {
            const formData = new FormData();
            formData.append('resume', this.selectedFile);
            formData.append('jobDescription', jobDescription);

            const response = await fetch(`${this.apiUrl}/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.currentSession.access_token}`
                },
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Generation failed');
            }

            // Show results
            document.getElementById('resultText').value = data.tailoredResume;
            document.getElementById('resultsSection').classList.remove('hidden');
            
            // Update token balance
            this.updateTokenDisplay(data.newTokenBalance);
            this.updateGenerateButton(data.newTokenBalance > 0);

            this.showToast('Resume tailored successfully!', 'success');

            // Scroll to results
            document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });

        } catch (error) {
            this.showToast(error.message, 'error');
        } finally {
            this.showLoading(false);
            this.toggleGenerateButton(false);
        }
    }

    async purchaseTokens(packageType) {
        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiUrl}/payment/create-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.currentSession.access_token}`
                },
                body: JSON.stringify({ packageType })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Payment failed');
            }

            // Open Stripe checkout
            chrome.tabs.create({ url: data.url });
            this.showToast('Redirecting to payment...', 'success');

        } catch (error) {
            this.showToast(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    copyResult() {
        const resultText = document.getElementById('resultText');
        resultText.select();
        document.execCommand('copy');
        this.showToast('Resume copied to clipboard!', 'success');
    }

    downloadResult() {
        const content = document.getElementById('resultText').value;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tailored-resume.txt';
        a.click();
        
        URL.revokeObjectURL(url);
        this.showToast('Resume downloaded!', 'success');
    }

    async logout() {
        await chrome.storage.local.clear();
        this.currentUser = null;
        this.currentSession = null;
        this.showAuth();
        this.showToast('Logged out successfully', 'success');
    }

    // UI Helper Methods
    showAuth() {
        document.getElementById('authSection').classList.remove('hidden');
        document.getElementById('appSection').classList.add('hidden');
    }

    showApp() {
        document.getElementById('authSection').classList.add('hidden');
        document.getElementById('appSection').classList.remove('hidden');
    }

    showLoading(show) {
        document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
    }

    toggleGenerateButton(loading) {
        const btn = document.getElementById('generateBtn');
        const btnText = btn.querySelector('.btn-text');
        const btnLoader = btn.querySelector('.btn-loader');
        
        btnText.classList.toggle('hidden', loading);
        btnLoader.classList.toggle('hidden', !loading);
        btn.disabled = loading;
    }

    updateTokenDisplay(tokens) {
        document.getElementById('tokenCount').textContent = tokens;
    }

    updateGenerateButton(hasTokens) {
        const btn = document.getElementById('generateBtn');
        if (!hasTokens) {
            btn.querySelector('.btn-text').textContent = 'Need tokens to generate';
            btn.disabled = true;
        } else {
            btn.querySelector('.btn-text').textContent = 'Tailor Resume (1 token)';
            this.checkGenerateReady();
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('toast');
        const toastMessage = document.getElementById('toastMessage');
        
        toastMessage.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.remove('hidden');
        
        setTimeout(() => this.hideToast(), 5000);
    }

    hideToast() {
        document.getElementById('toast').classList.add('hidden');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ResumeTrailerApp();
});

// Listen for job description changes
document.addEventListener('DOMContentLoaded', () => {
    const jobTextarea = document.getElementById('jobDescription');
    if (jobTextarea) {
        jobTextarea.addEventListener('input', () => {
            if (window.app) {
                window.app.checkGenerateReady();
            }
        });
    }
});