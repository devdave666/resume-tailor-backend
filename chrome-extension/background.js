// Background Service Worker for Resume Tailor Chrome Extension
// Handles extension lifecycle, storage, and communication

class BackgroundService {
    constructor() {
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupContextMenus();
        this.handleInstallation();
    }

    setupEventListeners() {
        // Extension installation/update
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });

        // Tab updates (for detecting job sites)
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });

        // Message handling
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        // Storage changes
        chrome.storage.onChanged.addListener((changes, namespace) => {
            this.handleStorageChange(changes, namespace);
        });

        // Alarm handling (for periodic tasks)
        chrome.alarms.onAlarm.addListener((alarm) => {
            this.handleAlarm(alarm);
        });
    }

    setupContextMenus() {
        // Remove existing context menus
        chrome.contextMenus.removeAll(() => {
            // Add context menu for extracting job descriptions
            chrome.contextMenus.create({
                id: 'extract-job-description',
                title: 'Extract Job Description',
                contexts: ['page', 'selection'],
                documentUrlPatterns: [
                    '*://*.linkedin.com/*',
                    '*://*.indeed.com/*',
                    '*://*.glassdoor.com/*',
                    '*://*.monster.com/*',
                    '*://*.ziprecruiter.com/*',
                    '*://*.careerbuilder.com/*'
                ]
            });

            // Add context menu for opening Resume Tailor
            chrome.contextMenus.create({
                id: 'open-resume-tailor',
                title: 'Open Resume Tailor',
                contexts: ['page']
            });
        });

        // Handle context menu clicks
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            this.handleContextMenuClick(info, tab);
        });
    }

    handleInstallation(details) {
        if (details && details.reason === 'install') {
            // First installation
            this.setDefaultSettings();
            this.showWelcomeNotification();
            
            // Open welcome page
            chrome.tabs.create({
                url: chrome.runtime.getURL('welcome.html')
            });
        } else if (details && details.reason === 'update') {
            // Extension update
            this.handleUpdate(details);
        }

        // Set up periodic tasks
        this.setupPeriodicTasks();
    }

    async setDefaultSettings() {
        const defaultSettings = {
            autoExtract: true,
            showNotifications: true,
            extractButtonPosition: 'top-right',
            theme: 'light',
            lastUsed: Date.now()
        };

        await chrome.storage.local.set({ settings: defaultSettings });
    }

    showWelcomeNotification() {
        chrome.notifications.create('welcome', {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Welcome to Resume Tailor!',
            message: 'Click the extension icon to get started. Visit any job site to extract job descriptions automatically.'
        });
    }

    handleUpdate(details) {
        const previousVersion = details.previousVersion;
        const currentVersion = chrome.runtime.getManifest().version;
        
        console.log(`Updated from ${previousVersion} to ${currentVersion}`);
        
        // Handle version-specific updates
        this.migrateSettings(previousVersion, currentVersion);
    }

    async migrateSettings(fromVersion, toVersion) {
        // Handle settings migration between versions
        try {
            const { settings } = await chrome.storage.local.get('settings');
            if (settings) {
                // Add any new default settings
                const updatedSettings = {
                    ...settings,
                    lastUpdated: Date.now(),
                    version: toVersion
                };
                
                await chrome.storage.local.set({ settings: updatedSettings });
            }
        } catch (error) {
            console.error('Settings migration failed:', error);
        }
    }

    handleTabUpdate(tabId, changeInfo, tab) {
        // Only process complete page loads
        if (changeInfo.status !== 'complete' || !tab.url) return;

        // Check if it's a supported job site
        if (this.isSupportedJobSite(tab.url)) {
            this.handleJobSiteVisit(tabId, tab);
        }
    }

    isSupportedJobSite(url) {
        const supportedSites = [
            'linkedin.com',
            'indeed.com',
            'glassdoor.com',
            'monster.com',
            'ziprecruiter.com',
            'careerbuilder.com'
        ];

        return supportedSites.some(site => url.includes(site));
    }

    async handleJobSiteVisit(tabId, tab) {
        try {
            // Update badge to indicate job site
            chrome.action.setBadgeText({
                text: 'JOB',
                tabId: tabId
            });

            chrome.action.setBadgeBackgroundColor({
                color: '#28a745',
                tabId: tabId
            });

            // Store current job site info
            await chrome.storage.local.set({
                currentJobSite: {
                    url: tab.url,
                    title: tab.title,
                    tabId: tabId,
                    timestamp: Date.now()
                }
            });

        } catch (error) {
            console.error('Failed to handle job site visit:', error);
        }
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'extractJob':
                    await this.extractJobFromTab(sender.tab.id, sendResponse);
                    break;

                case 'openPopup':
                    chrome.action.openPopup();
                    sendResponse({ success: true });
                    break;

                case 'getSettings':
                    const { settings } = await chrome.storage.local.get('settings');
                    sendResponse({ settings });
                    break;

                case 'updateSettings':
                    await chrome.storage.local.set({ settings: request.settings });
                    sendResponse({ success: true });
                    break;

                case 'clearData':
                    await this.clearUserData();
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Message handling failed:', error);
            sendResponse({ error: error.message });
        }
    }

    async extractJobFromTab(tabId, sendResponse) {
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                function: () => {
                    // This function runs in the content script context
                    if (window.jobExtractor) {
                        return window.jobExtractor.extractJobDescription();
                    }
                    return null;
                }
            });

            const jobDescription = results[0]?.result;
            sendResponse({ jobDescription });

        } catch (error) {
            console.error('Job extraction failed:', error);
            sendResponse({ error: error.message });
        }
    }

    handleContextMenuClick(info, tab) {
        switch (info.menuItemId) {
            case 'extract-job-description':
                this.extractJobFromContextMenu(tab);
                break;

            case 'open-resume-tailor':
                chrome.action.openPopup();
                break;
        }
    }

    async extractJobFromContextMenu(tab) {
        try {
            // Send message to content script to extract job
            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'extractJob'
            });

            if (response && response.jobDescription) {
                // Store extracted job description
                await chrome.storage.local.set({
                    extractedJob: response.jobDescription,
                    extractedFrom: tab.url,
                    extractedAt: Date.now()
                });

                // Show notification
                chrome.notifications.create('job-extracted', {
                    type: 'basic',
                    iconUrl: 'icons/icon128.png',
                    title: 'Job Description Extracted!',
                    message: 'Open Resume Tailor to use the extracted job description.'
                });
            }
        } catch (error) {
            console.error('Context menu extraction failed:', error);
        }
    }

    handleStorageChange(changes, namespace) {
        // Handle storage changes (e.g., sync settings across tabs)
        if (changes.session && changes.session.newValue) {
            // User logged in
            this.updateBadgeForAuth(true);
        } else if (changes.session && !changes.session.newValue) {
            // User logged out
            this.updateBadgeForAuth(false);
        }
    }

    updateBadgeForAuth(isAuthenticated) {
        if (isAuthenticated) {
            chrome.action.setBadgeText({ text: '✓' });
            chrome.action.setBadgeBackgroundColor({ color: '#28a745' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }

    setupPeriodicTasks() {
        // Clean up old data every day
        chrome.alarms.create('cleanup', {
            delayInMinutes: 1440, // 24 hours
            periodInMinutes: 1440
        });

        // Check for updates every week
        chrome.alarms.create('updateCheck', {
            delayInMinutes: 10080, // 1 week
            periodInMinutes: 10080
        });
    }

    async handleAlarm(alarm) {
        switch (alarm.name) {
            case 'cleanup':
                await this.cleanupOldData();
                break;

            case 'updateCheck':
                await this.checkForUpdates();
                break;
        }
    }

    async cleanupOldData() {
        try {
            const { extractedJob, extractedAt } = await chrome.storage.local.get(['extractedJob', 'extractedAt']);
            
            // Remove extracted job data older than 7 days
            if (extractedAt && Date.now() - extractedAt > 7 * 24 * 60 * 60 * 1000) {
                await chrome.storage.local.remove(['extractedJob', 'extractedFrom', 'extractedAt']);
            }

            console.log('Cleanup completed');
        } catch (error) {
            console.error('Cleanup failed:', error);
        }
    }

    async checkForUpdates() {
        try {
            // Check if there are any important updates or announcements
            // This could fetch from your API to notify users of new features
            console.log('Update check completed');
        } catch (error) {
            console.error('Update check failed:', error);
        }
    }

    async clearUserData() {
        try {
            // Clear all user data except settings
            const { settings } = await chrome.storage.local.get('settings');
            await chrome.storage.local.clear();
            if (settings) {
                await chrome.storage.local.set({ settings });
            }
            
            console.log('User data cleared');
        } catch (error) {
            console.error('Failed to clear user data:', error);
            throw error;
        }
    }
}

// Initialize background service
new BackgroundService();