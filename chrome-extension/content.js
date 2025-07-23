// Resume Tailor Content Script - Runs on job sites

class JobSiteDetector {
    constructor() {
        this.init();
    }

    init() {
        this.addResumeButton();
        this.observePageChanges();
    }

    addResumeButton() {
        // Only add button on job detail pages
        if (!this.isJobDetailPage()) return;

        // Remove existing button if present
        const existingButton = document.getElementById('resume-tailor-btn');
        if (existingButton) existingButton.remove();

        // Create the button
        const button = this.createResumeButton();
        
        // Find the best place to insert the button
        const insertLocation = this.findInsertLocation();
        if (insertLocation) {
            insertLocation.appendChild(button);
        }
    }

    createResumeButton() {
        const button = document.createElement('div');
        button.id = 'resume-tailor-btn';
        button.className = 'resume-tailor-button';
        button.innerHTML = `
            <div class="rt-button-content">
                <span class="rt-icon">📄</span>
                <span class="rt-text">Tailor Resume with AI</span>
                <span class="rt-badge">NEW</span>
            </div>
        `;

        button.addEventListener('click', () => {
            this.openResumeExtension();
        });

        return button;
    }

    findInsertLocation() {
        const selectors = [
            // LinkedIn
            '.jobs-apply-button, .jobs-s-apply, .job-details-jobs-unified-top-card__content',
            // Indeed
            '.jobsearch-IndeedApplyButton, .jobsearch-ApplyButtonContainer, .jobsearch-JobInfoHeader-title-container',
            // Glassdoor
            '.apply-btn, .job-apply-button, .job-title-container',
            // Generic fallbacks
            '[class*="apply"], [class*="job-title"], [class*="job-header"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
                // Create a container if needed
                let container = element.parentElement;
                if (!container.classList.contains('rt-button-container')) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'rt-button-container';
                    container.insertBefore(wrapper, element.nextSibling);
                    container = wrapper;
                }
                return container;
            }
        }

        // Fallback: add to body
        const fallbackContainer = document.createElement('div');
        fallbackContainer.className = 'rt-button-container rt-floating';
        document.body.appendChild(fallbackContainer);
        return fallbackContainer;
    }

    isJobDetailPage() {
        const url = window.location.href;
        const hostname = window.location.hostname;

        // Check for job detail page patterns
        const jobPatterns = [
            /linkedin\.com\/jobs\/view/,
            /indeed\.com\/viewjob/,
            /glassdoor\.com\/job-listing/,
            /monster\.com\/job-openings/,
            /ziprecruiter\.com\/jobs/
        ];

        return jobPatterns.some(pattern => pattern.test(url)) || 
               this.hasJobDetailElements();
    }

    hasJobDetailElements() {
        const jobDetailSelectors = [
            '.job-details, .jobsearch-JobComponent, .job-view',
            '[class*="job-description"], [class*="job-details"]',
            'h1[class*="job"], h1[class*="title"]'
        ];

        return jobDetailSelectors.some(selector => document.querySelector(selector));
    }

    observePageChanges() {
        // Handle single-page applications
        let currentUrl = window.location.href;
        
        const observer = new MutationObserver(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                setTimeout(() => this.addResumeButton(), 1000);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also listen for navigation events
        window.addEventListener('popstate', () => {
            setTimeout(() => this.addResumeButton(), 1000);
        });
    }

    async openResumeExtension() {
        const button = document.getElementById('resume-tailor-btn');
        
        try {
            // Add loading state to button
            button.classList.add('rt-loading');
            button.innerHTML = `
                <div class="rt-button-content">
                    <span class="rt-spinner">⟳</span>
                    <span class="rt-text">Extracting Job Data...</span>
                </div>
            `;

            // Extract job data
            const jobData = this.extractJobData();
            console.log('Extracted job data:', jobData);

            // Send message to background script to store data
            await chrome.runtime.sendMessage({
                action: 'openPopup',
                jobData: jobData
            });

            // Show success state
            button.classList.remove('rt-loading');
            button.classList.add('rt-success');
            button.innerHTML = `
                <div class="rt-button-content">
                    <span class="rt-icon">✓</span>
                    <span class="rt-text">Job Data Captured!</span>
                    <span class="rt-instruction">Click Extension Icon</span>
                </div>
            `;

            // Show notification
            this.showNotification('Job details captured! Click the Resume Tailor extension icon to continue.');

            // Reset button after 3 seconds
            setTimeout(() => {
                button.classList.remove('rt-success');
                button.innerHTML = `
                    <div class="rt-button-content">
                        <span class="rt-icon">📄</span>
                        <span class="rt-text">Tailor Resume with AI</span>
                        <span class="rt-badge">NEW</span>
                    </div>
                `;
            }, 3000);

        } catch (error) {
            console.error('Error extracting job data:', error);
            
            // Show error state
            button.classList.remove('rt-loading');
            button.classList.add('rt-error');
            button.innerHTML = `
                <div class="rt-button-content">
                    <span class="rt-icon">⚠</span>
                    <span class="rt-text">Extraction Failed</span>
                    <span class="rt-instruction">Click Extension Icon</span>
                </div>
            `;

            this.showNotification('Could not extract job details automatically. Click the extension icon to enter manually.', 'error');

            // Reset button after 3 seconds
            setTimeout(() => {
                button.classList.remove('rt-error');
                button.innerHTML = `
                    <div class="rt-button-content">
                        <span class="rt-icon">📄</span>
                        <span class="rt-text">Tailor Resume with AI</span>
                        <span class="rt-badge">NEW</span>
                    </div>
                `;
            }, 3000);
        }
    }

    showNotification(message, type = 'success') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `rt-notification rt-notification--${type}`;
        notification.innerHTML = `
            <div class="rt-notification__content">
                <span class="rt-notification__icon">${type === 'success' ? '✓' : '⚠'}</span>
                <span class="rt-notification__message">${message}</span>
                <button class="rt-notification__close">×</button>
            </div>
        `;

        // Add to page
        document.body.appendChild(notification);

        // Add click handler for close button
        notification.querySelector('.rt-notification__close').addEventListener('click', () => {
            notification.remove();
        });

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);

        // Animate in
        setTimeout(() => {
            notification.classList.add('rt-notification--show');
        }, 100);
    }

    extractJobData() {
        const hostname = window.location.hostname;
        let selectors = {};

        if (hostname.includes('linkedin.com')) {
            // Updated LinkedIn selectors for current layout
            selectors = {
                title: [
                    '.job-details-jobs-unified-top-card__job-title',
                    '.jobs-unified-top-card__job-title',
                    '.top-card-layout__title',
                    'h1[class*="job-title"]',
                    '.jobs-details__main-content h1'
                ],
                company: [
                    '.job-details-jobs-unified-top-card__company-name',
                    '.jobs-unified-top-card__company-name',
                    '.top-card-layout__card .topcard__flavor--black-link',
                    '[class*="company-name"]',
                    '.jobs-details__main-content [class*="company"]'
                ],
                description: [
                    '.jobs-description-content__text',
                    '.jobs-box__html-content',
                    '.description__text',
                    '[class*="job-description"]',
                    '.jobs-description'
                ]
            };
        } else if (hostname.includes('indeed.com')) {
            selectors = {
                title: ['[data-jk] h1', '.jobsearch-JobInfoHeader-title', 'h1[class*="job"]'],
                company: ['[data-jk] .company', '.jobsearch-CompanyInfoContainer', '[class*="company"]'],
                description: ['.jobsearch-jobDescriptionText', '#jobDescriptionText', '[class*="description"]']
            };
        } else if (hostname.includes('glassdoor.com')) {
            selectors = {
                title: ['.job-title', '[data-test="job-title"]', 'h1[class*="job"]'],
                company: ['.employer-name', '[data-test="employer-name"]', '[class*="company"]'],
                description: ['.job-description', '[data-test="job-description"]', '[class*="description"]']
            };
        }

        const getTextContent = (selectorArray) => {
            if (!Array.isArray(selectorArray)) {
                selectorArray = [selectorArray];
            }
            
            for (const selector of selectorArray) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            return '';
        };

        const jobData = {
            title: getTextContent(selectors.title),
            company: getTextContent(selectors.company),
            description: getTextContent(selectors.description),
            url: window.location.href,
            site: hostname,
            timestamp: Date.now()
        };

        // Clean up description - remove excessive whitespace
        if (jobData.description) {
            jobData.description = jobData.description
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n')
                .trim();
        }

        return jobData;
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new JobSiteDetector());
} else {
    new JobSiteDetector();
}