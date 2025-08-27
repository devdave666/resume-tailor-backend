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
        try {
            // Only add button on job detail pages
            if (!this.isJobDetailPage()) {
                console.log('Resume Tailor: Not a job detail page, skipping button insertion');
                return;
            }

            // Remove existing button if present
            const existingButton = document.getElementById('resume-tailor-btn');
            if (existingButton) {
                console.log('Resume Tailor: Removing existing button');
                existingButton.remove();
            }

            // Create the button
            const button = this.createResumeButton();
            
            // Find the best place to insert the button
            const insertLocation = this.findInsertLocation();
            if (insertLocation) {
                insertLocation.appendChild(button);
                console.log('Resume Tailor: Button successfully added to page');
                
                // Add success animation
                setTimeout(() => {
                    button.classList.add('rt-inserted');
                }, 100);
            } else {
                console.warn('Resume Tailor: Could not find suitable location for button');
                // Retry after a delay in case content is still loading
                setTimeout(() => this.retryButtonInsertion(), 2000);
            }
        } catch (error) {
            console.error('Resume Tailor: Error adding button:', error);
            // Retry on error
            setTimeout(() => this.retryButtonInsertion(), 1000);
        }
    }

    retryButtonInsertion(attempt = 1) {
        const maxAttempts = 3;
        
        if (attempt > maxAttempts) {
            console.warn('Resume Tailor: Max retry attempts reached, giving up');
            return;
        }

        console.log(`Resume Tailor: Retry attempt ${attempt}/${maxAttempts}`);
        
        try {
            if (this.isJobDetailPage() && !document.getElementById('resume-tailor-btn')) {
                const button = this.createResumeButton();
                const insertLocation = this.findInsertLocation();
                
                if (insertLocation) {
                    insertLocation.appendChild(button);
                    console.log('Resume Tailor: Button successfully added on retry');
                    
                    setTimeout(() => {
                        button.classList.add('rt-inserted');
                    }, 100);
                } else {
                    // Try again with exponential backoff
                    setTimeout(() => this.retryButtonInsertion(attempt + 1), 1000 * attempt);
                }
            }
        } catch (error) {
            console.error(`Resume Tailor: Retry attempt ${attempt} failed:`, error);
            setTimeout(() => this.retryButtonInsertion(attempt + 1), 1000 * attempt);
        }
    }

    createResumeButton() {
        const button = document.createElement('div');
        button.id = 'resume-tailor-btn';
        button.className = 'resume-tailor-button';
        button.setAttribute('role', 'button');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', 'Tailor your resume with AI for this job posting');
        
        button.innerHTML = `
            <div class="rt-button-content">
                <span class="rt-icon">📄</span>
                <span class="rt-text">Tailor Resume with AI</span>
                <span class="rt-badge">NEW</span>
            </div>
            <div class="rt-tooltip">
                <div class="rt-tooltip-content">
                    <strong>AI Resume Tailoring</strong>
                    <p>Automatically extract job details and customize your resume to match this position</p>
                    <div class="rt-tooltip-features">
                        <span>✓ Job analysis</span>
                        <span>✓ Keyword optimization</span>
                        <span>✓ Cover letter generation</span>
                    </div>
                </div>
            </div>
        `;

        // Add click handler
        button.addEventListener('click', () => {
            this.openResumeExtension();
        });

        // Add keyboard support
        button.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.openResumeExtension();
            }
        });

        // Add hover effects for tooltip
        let tooltipTimeout;
        button.addEventListener('mouseenter', () => {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = setTimeout(() => {
                button.classList.add('rt-show-tooltip');
            }, 500);
        });

        button.addEventListener('mouseleave', () => {
            clearTimeout(tooltipTimeout);
            button.classList.remove('rt-show-tooltip');
        });

        return button;
    }

    findInsertLocation() {
        const hostname = window.location.hostname;
        let selectors = [];

        // Site-specific selectors with priority order
        if (hostname.includes('linkedin.com')) {
            selectors = [
                '.jobs-apply-button',
                '.jobs-s-apply', 
                '.job-details-jobs-unified-top-card__content',
                '.jobs-unified-top-card__content',
                '.jobs-details__main-content .jobs-box__group',
                '.job-details-jobs-unified-top-card'
            ];
        } else if (hostname.includes('indeed.com')) {
            selectors = [
                '.jobsearch-IndeedApplyButton',
                '.jobsearch-ApplyButtonContainer',
                '.jobsearch-JobInfoHeader-title-container',
                '.jobsearch-JobComponent-header',
                '[data-jk] .jobsearch-JobComponent'
            ];
        } else if (hostname.includes('glassdoor.com')) {
            selectors = [
                '.apply-btn',
                '.job-apply-button',
                '.job-title-container',
                '[data-test="job-title"]',
                '.job-details-header'
            ];
        } else {
            // Generic fallbacks for other job sites
            selectors = [
                '[class*="apply"]',
                '[class*="job-title"]',
                '[class*="job-header"]',
                '[class*="job-details"]',
                'h1[class*="job"]',
                '.job-description'
            ];
        }

        // Try each selector in priority order
        for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            
            for (const element of elements) {
                if (this.isElementVisible(element) && this.isGoodInsertLocation(element)) {
                    return this.createButtonContainer(element);
                }
            }
        }

        // Smart fallback: find the best location based on page structure
        return this.findSmartFallbackLocation();
    }

    isElementVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        
        return rect.width > 0 && 
               rect.height > 0 && 
               style.display !== 'none' && 
               style.visibility !== 'hidden' &&
               style.opacity !== '0';
    }

    isGoodInsertLocation(element) {
        // Avoid inserting in hidden containers, overlays, or navigation
        const badParents = ['nav', 'header', 'footer', '.modal', '.overlay', '.dropdown'];
        
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
            const tagName = parent.tagName.toLowerCase();
            const className = parent.className.toLowerCase();
            
            if (badParents.some(bad => tagName === bad || className.includes(bad))) {
                return false;
            }
            parent = parent.parentElement;
        }
        
        return true;
    }

    createButtonContainer(referenceElement) {
        // Check if container already exists
        let existingContainer = referenceElement.parentElement.querySelector('.rt-button-container');
        if (existingContainer) {
            return existingContainer;
        }

        const container = document.createElement('div');
        container.className = 'rt-button-container';
        
        // Insert after the reference element with proper spacing
        if (referenceElement.nextSibling) {
            referenceElement.parentElement.insertBefore(container, referenceElement.nextSibling);
        } else {
            referenceElement.parentElement.appendChild(container);
        }
        
        return container;
    }

    findSmartFallbackLocation() {
        // Look for job-related content areas
        const contentSelectors = [
            '[class*="job"][class*="content"]',
            '[class*="job"][class*="details"]',
            '[class*="job"][class*="info"]',
            'main',
            '.content',
            '#content'
        ];

        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element && this.isElementVisible(element)) {
                const container = document.createElement('div');
                container.className = 'rt-button-container rt-fallback';
                element.insertBefore(container, element.firstChild);
                return container;
            }
        }

        // Last resort: floating button
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
        let currentUrl = window.location.href;
        let debounceTimer;
        
        // Enhanced mutation observer for SPA navigation
        const observer = new MutationObserver((mutations) => {
            // Check for URL changes
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                this.handlePageChange();
                return;
            }

            // Check for significant DOM changes that might indicate new job content
            const significantChange = mutations.some(mutation => {
                if (mutation.type === 'childList') {
                    // Look for job-related content changes
                    const addedNodes = Array.from(mutation.addedNodes);
                    return addedNodes.some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const element = node;
                            const className = element.className || '';
                            const id = element.id || '';
                            
                            // Check if job-related content was added
                            return className.includes('job') || 
                                   id.includes('job') ||
                                   element.querySelector('[class*="job"], [id*="job"]');
                        }
                        return false;
                    });
                }
                return false;
            });

            if (significantChange) {
                this.handlePageChange();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false // Reduce noise from attribute changes
        });

        // Listen for navigation events
        window.addEventListener('popstate', () => {
            this.handlePageChange();
        });

        // Listen for pushstate/replacestate (for SPAs)
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function(...args) {
            originalPushState.apply(history, args);
            setTimeout(() => this.handlePageChange(), 100);
        }.bind(this);

        history.replaceState = function(...args) {
            originalReplaceState.apply(history, args);
            setTimeout(() => this.handlePageChange(), 100);
        }.bind(this);
    }

    handlePageChange() {
        // Debounce rapid page changes
        clearTimeout(this.pageChangeTimer);
        this.pageChangeTimer = setTimeout(() => {
            console.log('Resume Tailor: Page changed, checking for job content...');
            this.addResumeButton();
        }, 500);
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