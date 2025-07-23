// Resume Tailor Background Script

// Simple background script without classes to avoid issues
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'openPopup':
            handleOpenPopup(request.jobData);
            break;
        case 'extractJobData':
            handleExtractJobData(sender.tab.id, sendResponse);
            return true; // Keep message channel open for async response
        case 'checkTokenBalance':
            handleCheckTokenBalance(sendResponse);
            return true;
        default:
            console.log('Unknown message action:', request.action);
    }
});

// Setup install handler
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        handleFirstInstall();
    } else if (details.reason === 'update') {
        handleUpdate(details.previousVersion);
    }
});

// Handle popup opening
async function handleOpenPopup(jobData) {
        try {
            // Store job data for popup to access
            if (jobData) {
                await chrome.storage.local.set({ currentJobData: jobData });
            }
            
            // Open popup (this will happen automatically when user clicks extension icon)
            // We can't programmatically open popup, but we can prepare data for it
            console.log('Job data prepared for popup:', jobData);
        } catch (error) {
            console.error('Error handling popup open:', error);
        }
}

// Handle job data extraction
async function handleExtractJobData(tabId, sendResponse) {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            function: extractJobInfoFromPage
        });

        const jobData = results[0]?.result;
        sendResponse({ success: true, data: jobData });
    } catch (error) {
        console.error('Error extracting job data:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle token balance check
async function handleCheckTokenBalance(sendResponse) {
    try {
        const userData = await getStoredUserData();
        if (userData && userData.session) {
            const response = await fetch('https://resume-tailor-i4ho57hr2-devkumar-daves-projects.vercel.app/get-token-balance', {
                headers: { 'Authorization': `Bearer ${userData.session.access_token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                sendResponse({ success: true, tokens: data.tokens });
            } else {
                throw new Error('Failed to fetch token balance');
            }
        } else {
            sendResponse({ success: false, error: 'Not authenticated' });
        }
    } catch (error) {
        console.error('Error checking token balance:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// Handle first install
function handleFirstInstall() {
    console.log('Resume Tailor installed successfully!');
}

// Handle updates
function handleUpdate(previousVersion) {
    console.log(`Updated from version ${previousVersion}`);
}

// Function that runs in the context of the job site page
function extractJobInfoFromPage() {
        const selectors = {
            linkedin: {
                title: '.top-card-layout__title, .job-details-jobs-unified-top-card__job-title, h1[class*="job"]',
                company: '.top-card-layout__card .topcard__flavor--black-link, .job-details-jobs-unified-top-card__company-name, [class*="company"]',
                description: '.description__text, .jobs-description-content__text, [class*="description"]'
            },
            indeed: {
                title: '[data-jk] h1, .jobsearch-JobInfoHeader-title, h1[class*="job"]',
                company: '[data-jk] .company, .jobsearch-CompanyInfoContainer, [class*="company"]',
                description: '.jobsearch-jobDescriptionText, #jobDescriptionText, [class*="description"]'
            },
            glassdoor: {
                title: '.job-title, [data-test="job-title"], h1[class*="job"]',
                company: '.employer-name, [data-test="employer-name"], [class*="company"]',
                description: '.job-description, [data-test="job-description"], [class*="description"]'
            }
        };

        const hostname = window.location.hostname;
        let siteSelectors = null;

        if (hostname.includes('linkedin.com')) siteSelectors = selectors.linkedin;
        else if (hostname.includes('indeed.com')) siteSelectors = selectors.indeed;
        else if (hostname.includes('glassdoor.com')) siteSelectors = selectors.glassdoor;

        // Fallback to generic selectors
        if (!siteSelectors) {
            siteSelectors = {
                title: 'h1, [class*="title"], [class*="job"]',
                company: '[class*="company"], [class*="employer"]',
                description: '[class*="description"], [class*="content"], main'
            };
        }

        const getTextContent = (selectors) => {
            if (typeof selectors === 'string') {
                selectors = [selectors];
            } else {
                selectors = selectors.split(', ');
            }
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }
            return '';
        };

        const jobData = {
            title: getTextContent(siteSelectors.title),
            company: getTextContent(siteSelectors.company),
            description: getTextContent(siteSelectors.description),
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

// Get stored user data
async function getStoredUserData() {
    const result = await chrome.storage.local.get(['userData']);
    return result.userData;
}