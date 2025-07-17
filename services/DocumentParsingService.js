// services/DocumentParsingService.js
// Enhanced document parsing service with multiple fallback options

const { PDFExtract } = require('pdf.js-extract');
const mammoth = require('mammoth');
const axios = require('axios');
const FormData = require('form-data');
const { logger } = require('../config/database');

class DocumentParsingService {

    constructor() {
        this.pdfExtract = new PDFExtract();
        this.pdfCoApiKey = process.env.PDF_CO_API_KEY;
    }

    /**
     * Main document parsing method with multiple fallback options
     * @param {Object} file - Multer file object
     * @returns {Promise<string>} Extracted text content
     */
    async parseDocument(file) {
        const fileBuffer = file.buffer;
        const fileType = file.mimetype;
        const filename = file.originalname;

        logger.info('Starting document parsing', {
            filename,
            type: fileType,
            size: fileBuffer.length
        });

        try {
            // Validate file size (max 10MB)
            if (fileBuffer.length > 10 * 1024 * 1024) {
                throw new Error('File size exceeds 10MB limit');
            }

            let extractedText = '';

            switch (fileType) {
                case 'application/pdf':
                    extractedText = await this.parsePDF(fileBuffer, filename);
                    break;

                case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                case 'application/msword':
                    extractedText = await this.parseDOCX(fileBuffer, filename);
                    break;

                case 'text/plain':
                    extractedText = await this.parseTextFile(fileBuffer);
                    break;

                default:
                    throw new Error(`Unsupported file type: ${fileType}`);
            }

            // Validate extracted text
            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error('No text content could be extracted from the document');
            }

            // Clean and normalize text
            const cleanedText = this.cleanExtractedText(extractedText);

            logger.info('Document parsing completed successfully', {
                filename,
                originalLength: extractedText.length,
                cleanedLength: cleanedText.length
            });

            return cleanedText;

        } catch (error) {
            logger.error('Document parsing failed', {
                filename,
                type: fileType,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Parse PDF files with multiple fallback methods
     * @param {Buffer} fileBuffer - PDF file buffer
     * @param {string} filename - Original filename
     * @returns {Promise<string>} Extracted text
     */
    async parsePDF(fileBuffer, filename) {
        // Method 1: Try pdf.js-extract (primary)
        try {
            logger.debug('Attempting PDF parsing with pdf.js-extract', { filename });

            const data = await this.pdfExtract.extractBuffer(fileBuffer, {
                firstPage: 1,
                lastPage: 10, // Limit to first 10 pages for performance
                password: '', // Add password support if needed
                verbosity: -1, // Reduce verbosity
                normalizeWhitespace: true,
                disableCombineTextItems: false
            });

            if (!data.pages || data.pages.length === 0) {
                throw new Error('No pages found in PDF');
            }

            const text = data.pages
                .map(page => {
                    if (!page.content || page.content.length === 0) {
                        return '';
                    }
                    return page.content
                        .map(item => item.str || '')
                        .filter(str => str.trim().length > 0)
                        .join(' ');
                })
                .filter(pageText => pageText.trim().length > 0)
                .join('\n\n');

            if (text.trim().length === 0) {
                throw new Error('No text content found in PDF pages');
            }

            logger.info('PDF parsed successfully with pdf.js-extract', {
                filename,
                pages: data.pages.length,
                textLength: text.length
            });

            return text;

        } catch (primaryError) {
            logger.warn('pdf.js-extract failed, trying fallback methods', {
                filename,
                error: primaryError.message
            });

            // Method 2: Try PDF.co API (fallback)
            if (this.pdfCoApiKey && this.pdfCoApiKey !== 'test-placeholder-key-for-testing') {
                try {
                    return await this.parsePDFWithPdfCo(fileBuffer, filename);
                } catch (fallbackError) {
                    logger.warn('PDF.co API also failed', {
                        filename,
                        error: fallbackError.message
                    });
                }
            }

            // If all methods fail, throw the original error
            throw new Error(`Failed to parse PDF: ${primaryError.message}`);
        }
    }

    /**
     * Parse PDF using PDF.co API
     * @param {Buffer} fileBuffer - PDF file buffer
     * @param {string} filename - Original filename
     * @returns {Promise<string>} Extracted text
     */
    async parsePDFWithPdfCo(fileBuffer, filename) {
        logger.debug('Attempting PDF parsing with PDF.co API', { filename });

        const formData = new FormData();
        formData.append('file', fileBuffer, filename);

        const response = await axios.post(
            'https://api.pdf.co/v1/pdf/convert/to/text-simple',
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'x-api-key': this.pdfCoApiKey
                },
                timeout: 30000 // 30 second timeout
            }
        );

        if (!response.data || !response.data.body) {
            throw new Error('PDF.co API returned empty response');
        }

        logger.info('PDF parsed successfully with PDF.co API', {
            filename,
            textLength: response.data.body.length
        });

        return response.data.body;
    }

    /**
     * Parse DOCX files using mammoth
     * @param {Buffer} fileBuffer - DOCX file buffer
     * @param {string} filename - Original filename
     * @returns {Promise<string>} Extracted text
     */
    async parseDOCX(fileBuffer, filename) {
        try {
            logger.debug('Attempting DOCX parsing with mammoth', { filename });

            const result = await mammoth.extractRawText({ buffer: fileBuffer });

            if (!result.value || result.value.trim().length === 0) {
                throw new Error('No text content found in DOCX file');
            }

            // Log any warnings from mammoth
            if (result.messages && result.messages.length > 0) {
                logger.debug('DOCX parsing warnings', {
                    filename,
                    warnings: result.messages.map(msg => msg.message)
                });
            }

            logger.info('DOCX parsed successfully', {
                filename,
                textLength: result.value.length
            });

            return result.value;

        } catch (error) {
            logger.error('DOCX parsing failed', { filename, error: error.message });
            throw new Error(`Failed to parse DOCX file: ${error.message}`);
        }
    }

    /**
     * Parse plain text files
     * @param {Buffer} fileBuffer - Text file buffer
     * @returns {Promise<string>} File content as string
     */
    async parseTextFile(fileBuffer) {
        try {
            const text = fileBuffer.toString('utf-8');

            if (text.trim().length === 0) {
                throw new Error('Text file is empty');
            }

            logger.info('Text file parsed successfully', { textLength: text.length });
            return text;

        } catch (error) {
            logger.error('Text file parsing failed', { error: error.message });
            throw new Error(`Failed to parse text file: ${error.message}`);
        }
    }

    /**
     * Clean and normalize extracted text
     * @param {string} text - Raw extracted text
     * @returns {string} Cleaned text
     */
    cleanExtractedText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        return text
            // Remove excessive whitespace
            .replace(/\s+/g, ' ')
            // Remove multiple consecutive newlines
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            // Remove leading/trailing whitespace
            .trim()
            // Remove control characters except newlines and tabs
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            // Normalize quotes
            .replace(/[""]/g, '"')
            .replace(/['']/g, "'")
            // Remove excessive spaces around punctuation
            .replace(/\s+([,.!?;:])/g, '$1')
            .replace(/([,.!?;:])\s+/g, '$1 ');
    }

    /**
     * Validate file before parsing
     * @param {Object} file - Multer file object
     * @returns {boolean} True if file is valid
     */
    validateFile(file) {
        if (!file || !file.buffer) {
            throw new Error('No file provided');
        }

        if (!file.originalname) {
            throw new Error('File must have a name');
        }

        if (!file.mimetype) {
            throw new Error('File must have a valid MIME type');
        }

        const supportedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
            'text/plain'
        ];

        if (!supportedTypes.includes(file.mimetype)) {
            throw new Error(`Unsupported file type: ${file.mimetype}. Supported types: PDF, DOCX, DOC, TXT`);
        }

        return true;
    }

    /**
     * Get file type information
     * @param {string} mimetype - File MIME type
     * @returns {Object} File type information
     */
    getFileTypeInfo(mimetype) {
        const typeMap = {
            'application/pdf': { name: 'PDF', extension: '.pdf' },
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { name: 'DOCX', extension: '.docx' },
            'application/msword': { name: 'DOC', extension: '.doc' },
            'text/plain': { name: 'Text', extension: '.txt' }
        };

        return typeMap[mimetype] || { name: 'Unknown', extension: '' };
    }
}

module.exports = new DocumentParsingService();