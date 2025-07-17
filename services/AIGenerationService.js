// services/AIGenerationService.js
// Enhanced AI content generation service with Google Gemini

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../config/database');

class AIGenerationService {
    
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ 
            model: 'gemini-1.5-flash',
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 8192,
            },
            safetySettings: [
                {
                    category: 'HARM_CATEGORY_HARASSMENT',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                },
                {
                    category: 'HARM_CATEGORY_HATE_SPEECH',
                    threshold: 'BLOCK_MEDIUM_AND_ABOVE'
                }
            ]
        });
        
        // Rate limiting tracking
        this.requestCount = 0;
        this.lastResetTime = Date.now();
        this.maxRequestsPerMinute = 60; // Adjust based on your Gemini API limits
    }

    /**
     * Generate tailored resume and cover letter
     * @param {string} resumeText - Original resume text
     * @param {string} profileText - Optional profile/bio text
     * @param {string} jobDescription - Target job description
     * @returns {Promise<Object>} Generated content with tailoredResume and coverLetter
     */
    async generateTailoredContent(resumeText, profileText, jobDescription) {
        try {
            // Validate inputs
            this.validateInputs(resumeText, jobDescription);
            
            // Check rate limits
            await this.checkRateLimit();
            
            // Generate content with retry logic
            const result = await this.generateWithRetry(resumeText, profileText, jobDescription);
            
            logger.info('AI content generation completed successfully', {
                resumeLength: resumeText.length,
                jobDescriptionLength: jobDescription.length,
                hasProfile: !!profileText && profileText !== "Not provided.",
                generatedResumeLength: result.tailoredResume?.length || 0,
                generatedCoverLetterLength: result.coverLetter?.length || 0
            });
            
            return result;
            
        } catch (error) {
            logger.error('AI content generation failed', { 
                error: error.message,
                resumeLength: resumeText?.length || 0,
                jobDescriptionLength: jobDescription?.length || 0
            });
            throw error;
        }
    }

    /**
     * Generate content with retry logic
     * @param {string} resumeText - Original resume text
     * @param {string} profileText - Optional profile text
     * @param {string} jobDescription - Job description
     * @param {number} maxRetries - Maximum retry attempts
     * @returns {Promise<Object>} Generated content
     */
    async generateWithRetry(resumeText, profileText, jobDescription, maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                logger.debug(`AI generation attempt ${attempt}/${maxRetries}`);
                
                const prompt = this.buildPrompt(resumeText, profileText, jobDescription);
                const result = await this.model.generateContent(prompt);
                const response = await result.response;
                
                if (!response) {
                    throw new Error('Empty response from Gemini API');
                }
                
                const text = await response.text();
                if (!text || text.trim().length === 0) {
                    throw new Error('Empty text response from Gemini API');
                }
                
                // Parse and validate the response
                const parsedResult = this.parseAIResponse(text);
                this.validateGeneratedContent(parsedResult);
                
                // Increment request counter
                this.requestCount++;
                
                return parsedResult;
                
            } catch (error) {
                lastError = error;
                logger.warn(`AI generation attempt ${attempt} failed`, { 
                    error: error.message,
                    attempt,
                    maxRetries 
                });
                
                // Don't retry on validation errors or rate limit errors
                if (error.message.includes('Invalid JSON') || 
                    error.message.includes('rate limit') ||
                    error.message.includes('quota')) {
                    break;
                }
                
                // Wait before retry (exponential backoff)
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                    logger.debug(`Waiting ${delay}ms before retry`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw new Error(`AI generation failed after ${maxRetries} attempts: ${lastError.message}`);
    }

    /**
     * Build the prompt for AI generation
     * @param {string} resumeText - Original resume text
     * @param {string} profileText - Optional profile text
     * @param {string} jobDescription - Job description
     * @returns {string} Formatted prompt
     */
    buildPrompt(resumeText, profileText, jobDescription) {
        const hasProfile = profileText && profileText !== "Not provided.";
        
        return `You are an expert resume and cover letter writer with 10+ years of experience in career coaching and recruitment. Your task is to create a tailored resume and professional cover letter based on the provided information.

**INSTRUCTIONS:**
1. Analyze the job description to identify key requirements, skills, and qualifications
2. Tailor the resume to highlight relevant experience and skills that match the job requirements
3. Create a compelling cover letter that demonstrates genuine interest and fit for the role
4. Maintain professional tone and formatting throughout
5. Ensure all content is truthful and based on the original resume information

**ORIGINAL RESUME:**
${resumeText}

${hasProfile ? `**ADDITIONAL PROFILE INFORMATION:**
${profileText}

` : ''}**TARGET JOB DESCRIPTION:**
${jobDescription}

**OUTPUT REQUIREMENTS:**
- Respond with a valid JSON object containing exactly two keys: 'tailoredResume' and 'coverLetter'
- The tailored resume should maintain the original structure but emphasize relevant skills and experience
- The cover letter should be 3-4 paragraphs, professional, and specific to the role
- Do not include any markdown formatting, code blocks, or additional text outside the JSON object
- Ensure proper JSON escaping for quotes and special characters

**EXAMPLE FORMAT:**
{
  "tailoredResume": "Your tailored resume content here...",
  "coverLetter": "Your cover letter content here..."
}`;
    }

    /**
     * Parse AI response and handle common formatting issues
     * @param {string} text - Raw AI response text
     * @returns {Object} Parsed JSON object
     */
    parseAIResponse(text) {
        try {
            // Clean the response text
            let cleanedText = text.trim();
            
            // Remove common markdown formatting
            cleanedText = cleanedText.replace(/```json\s*/g, '');
            cleanedText = cleanedText.replace(/```\s*/g, '');
            cleanedText = cleanedText.replace(/^json\s*/g, '');
            
            // Find JSON object boundaries
            const jsonStart = cleanedText.indexOf('{');
            const jsonEnd = cleanedText.lastIndexOf('}');
            
            if (jsonStart === -1 || jsonEnd === -1 || jsonStart >= jsonEnd) {
                throw new Error('No valid JSON object found in response');
            }
            
            const jsonText = cleanedText.substring(jsonStart, jsonEnd + 1);
            const parsed = JSON.parse(jsonText);
            
            return parsed;
            
        } catch (error) {
            logger.error('Failed to parse AI response', { 
                error: error.message,
                responseLength: text?.length || 0,
                responsePreview: text?.substring(0, 200) || 'empty'
            });
            throw new Error(`Invalid JSON response from AI: ${error.message}`);
        }
    }

    /**
     * Validate generated content
     * @param {Object} content - Generated content object
     */
    validateGeneratedContent(content) {
        if (!content || typeof content !== 'object') {
            throw new Error('Generated content must be an object');
        }
        
        if (!content.tailoredResume || typeof content.tailoredResume !== 'string') {
            throw new Error('Generated content must include a valid tailoredResume string');
        }
        
        if (!content.coverLetter || typeof content.coverLetter !== 'string') {
            throw new Error('Generated content must include a valid coverLetter string');
        }
        
        // Check minimum content length
        if (content.tailoredResume.trim().length < 100) {
            throw new Error('Generated resume is too short (minimum 100 characters)');
        }
        
        if (content.coverLetter.trim().length < 200) {
            throw new Error('Generated cover letter is too short (minimum 200 characters)');
        }
        
        // Check maximum content length (prevent excessive tokens)
        if (content.tailoredResume.length > 10000) {
            logger.warn('Generated resume is very long', { length: content.tailoredResume.length });
        }
        
        if (content.coverLetter.length > 5000) {
            logger.warn('Generated cover letter is very long', { length: content.coverLetter.length });
        }
    }

    /**
     * Validate input parameters
     * @param {string} resumeText - Resume text to validate
     * @param {string} jobDescription - Job description to validate
     */
    validateInputs(resumeText, jobDescription) {
        if (!resumeText || typeof resumeText !== 'string' || resumeText.trim().length === 0) {
            throw new Error('Resume text is required and cannot be empty');
        }
        
        if (!jobDescription || typeof jobDescription !== 'string' || jobDescription.trim().length === 0) {
            throw new Error('Job description is required and cannot be empty');
        }
        
        if (resumeText.length < 50) {
            throw new Error('Resume text is too short (minimum 50 characters)');
        }
        
        if (jobDescription.length < 50) {
            throw new Error('Job description is too short (minimum 50 characters)');
        }
        
        // Check for reasonable maximum lengths
        if (resumeText.length > 20000) {
            throw new Error('Resume text is too long (maximum 20,000 characters)');
        }
        
        if (jobDescription.length > 10000) {
            throw new Error('Job description is too long (maximum 10,000 characters)');
        }
    }

    /**
     * Check rate limiting
     */
    async checkRateLimit() {
        const now = Date.now();
        const timeSinceReset = now - this.lastResetTime;
        
        // Reset counter every minute
        if (timeSinceReset >= 60000) {
            this.requestCount = 0;
            this.lastResetTime = now;
        }
        
        if (this.requestCount >= this.maxRequestsPerMinute) {
            const waitTime = 60000 - timeSinceReset;
            logger.warn('Rate limit reached, waiting', { waitTime });
            throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds.`);
        }
    }

    /**
     * Validate API configuration
     * @returns {boolean} True if configuration is valid
     */
    validateConfiguration() {
        if (!process.env.GEMINI_API_KEY) {
            logger.error('GEMINI_API_KEY environment variable is required');
            return false;
        }
        
        if (process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
            logger.error('GEMINI_API_KEY is set to placeholder value');
            return false;
        }
        
        return true;
    }

    /**
     * Get service statistics
     * @returns {Object} Service statistics
     */
    getStats() {
        return {
            requestCount: this.requestCount,
            lastResetTime: this.lastResetTime,
            maxRequestsPerMinute: this.maxRequestsPerMinute,
            model: 'gemini-1.5-flash'
        };
    }
}

module.exports = new AIGenerationService();