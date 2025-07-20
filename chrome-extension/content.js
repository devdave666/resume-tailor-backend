// Content Script for Resume Tailor Chrome Extension
// Runs on job sites to detect and extract job descriptions

class JobExtractor {
    constructor() {
        this.init();
    }

    init() {
        this.addExtractButton();
        this.observePageChanges();
    }

    addExtractButton() {
        // Only add button on supported job sites
        if (!this.isSupportedSite()) return;

        // Remove existing button if present
        const existingBtn = document.getElementById('resume-tailor-extract-btn');
        if (existingBtn) existingBtn.remove();

        // Create floating extract button
        const button = document.createElement('div');
        button.id = 'resume-tailor-extract-btn';
        button.innerHTML = `
            <div class="rt-extract-btn">
                <img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="Resume Tailor">
                <span>Extract Job</span>
            </div>
        `;

        // Add click handler
        button.addEventListener('click', () => {
            this.extractAndSendJobDescription();
        });

        // Add to page
        document.body.appendChild(button);
    }

    isSupportedSite() {
        const hostname = window.location.hostname.toLowerCase();
        const supportedSites = [
            'linkedin.com',
            'indeed.com',
            'glassdoor.com',
            'monster.com',
            'ziprecruiter.com',
            'careerbuilder.com'
        ];

        return supportedSites.some(site => hostname.includes(site));
    }

    extractJobDescription() {
        const hostname = window.location.hostname.toLowerCase();
        
        // Site-specific selectors
        const siteSelectors = {
            'linkedin.com': [
                '.jobs-description-content__text',
                '.jobs-box__html-content',
                '.description__text',
                '.jobs-description__content',
                '[data-job-id] .jobs-description-content'
            ],
            'indeed.com': [
                '.jobsearch-jobDescriptionText',
                '.jobsearch-JobComponent-description',
                '#jobDescriptionText',
                '.jobsearch-SerpJobCard-description',
                '.jobsearch-JobInfoHeader-subtitle'
            ],
            'glassdoor.com': [
                '.jobDescriptionContent',
                '.desc',
                '.jobDescriptionWrapper',
                '[data-test="jobDescription"]'
            ],
            'monster.com': [
                '.job-description',
                '.job-summary',
                '.job-details'
            ],
            'ziprecruiter.com': [
                '.job_description',
                '.jobDescriptionSection',
                '.job-description-container'
            ],
            'careerbuilder.com': [
                '.job-description',
                '.jdp-job-description-details'
            ]
        };

        // Get selectors for current site
        const selectors = Object.keys(siteSelectors).find(site => hostname.includes(site));
        const siteSpecificSelectors = selectors ? siteSelectors[selectors] : [];

        // Generic selectors as fallback
        const genericSelectors = [
            '[class*="job-description"]',
            '[class*="description"]',
            '[id*="job-description"]',
            '[id*="description"]',
            '[data-testid*="description"]',
            '.job-content',
            '.posting-description',
            '.job-summary'
        ];

        const allSelectors = [...siteSpecificSelectors, ...genericSelectors];

        // Try each selector
        for (const selector of allSelectors) {
            const elements = document.querySelectorAll(selector);
            
            for (const element of elements) {
                if (!element) continue;
                
                let text = this.cleanText(element.innerText || element.textContent);
                
                // Validate extracted text
                if (this.isValidJobDescription(text)) {
                    return text;
                }
            }
        }

        // Last resort: extract from page title and meta description
        const title = document.title;
        const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
        
        if (title && metaDesc) {
            return `Job Title: ${title}\n\nDescription: ${metaDesc}`;
        }

        return null;
    }

    cleanText(text) {
        if (!text) return '';
        
        return text
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .replace(/\n\s*\n/g, '\n') // Remove empty lines
            .trim();
    }

    isValidJobDescription(text) {
        if (!text || text.length < 100) return false;
        
        // Check for job-related keywords
        const jobKeywords = [
            'responsibilities', 'requirements', 'qualifications', 'skills',
            'experience', 'education', 'job', 'position', 'role',
            'candidate', 'apply', 'salary', 'benefits', 'company'
        ];
        
        const lowerText = text.toLowerCase();
        const keywordCount = jobKeywords.filter(keyword => lowerText.includes(keyword)).length;
        
        return keywordCount >= 3; // Must contain at least 3 job-related keywords
    }

    extractAndSendJobDescription() {
        const jobDescription = this.extractJobDescription();
        
        if (jobDescription) {
            // Store in Chrome storage for popup to access
            chrome.storage.local.set({ 
                extractedJob: jobDescription,
                extractedFrom: window.location.href,
                extractedAt: Date.now()
            });
            
            this.showNotification('Job description extracted! Open Resume Tailor to use it.', 'success');
        } else {
            this.showNotification('Could not find job description on this page.', 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Remove existing notification
        const existing = document.getElementById('resume-tailor-notification');
        if (existing) existing.remove();

        // Create notification
        const notification = document.createElement('div');
        notification.id = 'resume-tailor-notification';
        notification.className = `rt-notification rt-${type}`;
        notification.innerHTML = `
            <div class="rt-notification-content">
                <img src="${chrome.runtime.getURL('icons/icon32.png')}" alt="Resume Tailor">
                <span>${message}</span>
                <button class="rt-notification-close">×</button>
            </div>
        `;

        // Add close handler
        notification.querySelector('.rt-notification-close').addEventListener('click', () => {
            notification.remove();
        });

        // Add to page
        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    observePageChanges() {
        // Re-add button when page content changes (for SPAs)
        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    shouldUpdate = true;
                }
            });
            
            if (shouldUpdate) {
                // Debounce the update
                clearTimeout(this.updateTimeout);
                this.updateTimeout = setTimeout(() => {
                    this.addExtractButton();
                }, 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new JobExtractor();
    });
} else {
    new JobExtractor();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractJob') {
        const extractor = new JobExtractor();
        const jobDescription = extractor.extractJobDescription();
        sendResponse({ jobDescription });
    }
});