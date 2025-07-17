// services/DocumentGenerationService.js
// Enhanced document generation service with professional formatting

const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require('docx');
const { PDFDocument, rgb, StandardFonts, PageSizes } = require('pdf-lib');
const { logger } = require('../config/database');

class DocumentGenerationService {
    
    constructor() {
        // Document styling constants
        this.styles = {
            fonts: {
                header: { size: 16, bold: true },
                subheader: { size: 14, bold: true },
                body: { size: 11, bold: false },
                small: { size: 10, bold: false }
            },
            colors: {
                primary: { r: 0.2, g: 0.2, b: 0.2 },
                secondary: { r: 0.4, g: 0.4, b: 0.4 },
                accent: { r: 0.0, g: 0.3, b: 0.6 }
            },
            spacing: {
                paragraph: 200,
                section: 400,
                line: 240
            }
        };
    }

    /**
     * Generate both DOCX and PDF documents
     * @param {string} content - Text content to format
     * @param {string} type - Document type ('resume' or 'coverLetter')
     * @returns {Promise<Object>} Object with docx and pdf buffers
     */
    async generateDocuments(content, type = 'resume') {
        try {
            logger.info('Starting document generation', { type, contentLength: content.length });
            
            // Parse content into structured sections
            const sections = this.parseContent(content, type);
            
            // Generate DOCX
            const docxBuffer = await this.createDocx(sections, type);
            
            // Generate PDF
            const pdfBuffer = await this.createPdf(sections, type);
            
            logger.info('Document generation completed', { 
                type, 
                sectionsCount: sections.length,
                docxSize: docxBuffer.length,
                pdfSize: pdfBuffer.length
            });
            
            return {
                docx: docxBuffer,
                pdf: pdfBuffer,
                sections: sections.length
            };
            
        } catch (error) {
            logger.error('Document generation failed', { type, error: error.message });
            throw error;
        }
    }

    /**
     * Parse content into structured sections with intelligent formatting
     * @param {string} content - Raw text content
     * @param {string} type - Document type
     * @returns {Array} Array of formatted sections
     */
    parseContent(content, type) {
        if (!content || typeof content !== 'string') {
            throw new Error('Content must be a non-empty string');
        }

        const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        const sections = [];
        
        if (type === 'coverLetter') {
            return this.parseCoverLetter(lines);
        } else {
            return this.parseResume(lines);
        }
    }

    /**
     * Parse resume content with section detection
     * @param {Array} lines - Array of text lines
     * @returns {Array} Formatted sections
     */
    parseResume(lines) {
        const sections = [];
        const resumeSectionKeywords = [
            'summary', 'objective', 'profile', 'about',
            'experience', 'employment', 'work history', 'career',
            'education', 'academic', 'qualifications',
            'skills', 'competencies', 'expertise', 'abilities',
            'projects', 'portfolio', 'achievements',
            'certifications', 'licenses', 'awards',
            'references', 'contact', 'personal'
        ];

        let currentSection = null;
        let isFirstLine = true;

        lines.forEach((line, index) => {
            const lowerLine = line.toLowerCase();
            
            // Detect name (usually first line and all caps or title case)
            if (isFirstLine && (line === line.toUpperCase() || this.isTitleCase(line))) {
                sections.push({
                    text: line,
                    type: 'name',
                    isHeader: true,
                    level: 1
                });
                isFirstLine = false;
                return;
            }
            
            // Detect contact info (email, phone, address patterns)
            if (this.isContactInfo(line)) {
                sections.push({
                    text: line,
                    type: 'contact',
                    isHeader: false,
                    level: 0
                });
                return;
            }
            
            // Detect section headers
            const isSection = resumeSectionKeywords.some(keyword => 
                lowerLine.includes(keyword) && 
                (line.length < 50 || line.endsWith(':') || line === line.toUpperCase())
            );
            
            if (isSection) {
                currentSection = lowerLine;
                sections.push({
                    text: line.replace(':', ''),
                    type: 'section',
                    isHeader: true,
                    level: 2
                });
            } else if (this.isSubHeader(line, currentSection)) {
                sections.push({
                    text: line,
                    type: 'subheader',
                    isHeader: true,
                    level: 3
                });
            } else if (this.isBulletPoint(line)) {
                sections.push({
                    text: line.replace(/^[-•*]\s*/, ''),
                    type: 'bullet',
                    isHeader: false,
                    level: 0,
                    isBullet: true
                });
            } else {
                sections.push({
                    text: line,
                    type: 'body',
                    isHeader: false,
                    level: 0
                });
            }
        });

        return sections;
    }

    /**
     * Parse cover letter content
     * @param {Array} lines - Array of text lines
     * @returns {Array} Formatted sections
     */
    parseCoverLetter(lines) {
        const sections = [];
        let paragraphCount = 0;

        lines.forEach((line, index) => {
            // First line might be a header/title
            if (index === 0 && (line.toLowerCase().includes('cover letter') || line.length < 50)) {
                sections.push({
                    text: line,
                    type: 'title',
                    isHeader: true,
                    level: 1
                });
                return;
            }
            
            // Detect date
            if (this.isDate(line)) {
                sections.push({
                    text: line,
                    type: 'date',
                    isHeader: false,
                    level: 0
                });
                return;
            }
            
            // Detect address/contact info
            if (this.isContactInfo(line)) {
                sections.push({
                    text: line,
                    type: 'contact',
                    isHeader: false,
                    level: 0
                });
                return;
            }
            
            // Detect salutation
            if (line.toLowerCase().startsWith('dear ') || line.toLowerCase().includes('hiring manager')) {
                sections.push({
                    text: line,
                    type: 'salutation',
                    isHeader: false,
                    level: 0
                });
                return;
            }
            
            // Detect closing
            if (this.isClosing(line)) {
                sections.push({
                    text: line,
                    type: 'closing',
                    isHeader: false,
                    level: 0
                });
                return;
            }
            
            // Regular paragraph
            sections.push({
                text: line,
                type: 'paragraph',
                isHeader: false,
                level: 0
            });
        });

        return sections;
    }

    /**
     * Create professionally formatted DOCX document
     * @param {Array} sections - Formatted sections
     * @param {string} type - Document type
     * @returns {Promise<Buffer>} DOCX buffer
     */
    async createDocx(sections, type) {
        try {
            const children = [];

            sections.forEach((section, index) => {
                let paragraph;

                switch (section.type) {
                    case 'name':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                bold: true,
                                size: 32,
                                color: "1f4e79"
                            })],
                            alignment: AlignmentType.CENTER,
                            spacing: { after: 200 }
                        });
                        break;

                    case 'contact':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                size: 22,
                                color: "595959"
                            })],
                            alignment: AlignmentType.CENTER,
                            spacing: { after: 100 }
                        });
                        break;

                    case 'section':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text.toUpperCase(),
                                bold: true,
                                size: 26,
                                color: "1f4e79"
                            })],
                            spacing: { before: 400, after: 200 },
                            border: {
                                bottom: {
                                    color: "1f4e79",
                                    space: 1,
                                    style: BorderStyle.SINGLE,
                                    size: 6
                                }
                            }
                        });
                        break;

                    case 'subheader':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                bold: true,
                                size: 24,
                                color: "2e2e2e"
                            })],
                            spacing: { before: 200, after: 100 }
                        });
                        break;

                    case 'bullet':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: `• ${section.text}`,
                                size: 22
                            })],
                            spacing: { after: 100 },
                            indent: { left: 360 }
                        });
                        break;

                    case 'title':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                bold: true,
                                size: 28,
                                color: "1f4e79"
                            })],
                            alignment: AlignmentType.CENTER,
                            spacing: { after: 400 }
                        });
                        break;

                    case 'date':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                size: 22
                            })],
                            alignment: AlignmentType.RIGHT,
                            spacing: { after: 200 }
                        });
                        break;

                    case 'salutation':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                size: 22
                            })],
                            spacing: { before: 200, after: 200 }
                        });
                        break;

                    case 'closing':
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                size: 22
                            })],
                            spacing: { before: 200, after: 100 }
                        });
                        break;

                    default:
                        paragraph = new Paragraph({
                            children: [new TextRun({
                                text: section.text,
                                size: 22
                            })],
                            spacing: { after: 150 }
                        });
                }

                children.push(paragraph);
            });

            const doc = new Document({
                sections: [{
                    properties: {
                        page: {
                            margin: {
                                top: 720,
                                right: 720,
                                bottom: 720,
                                left: 720
                            }
                        }
                    },
                    children: children
                }]
            });

            return await Packer.toBuffer(doc);

        } catch (error) {
            logger.error('DOCX creation failed', { error: error.message });
            throw new Error(`Failed to create DOCX: ${error.message}`);
        }
    }

    /**
     * Create professionally formatted PDF document
     * @param {Array} sections - Formatted sections
     * @param {string} type - Document type
     * @returns {Promise<Buffer>} PDF buffer
     */
    async createPdf(sections, type) {
        try {
            const pdfDoc = await PDFDocument.create();
            let page = pdfDoc.addPage(PageSizes.A4);
            const { width, height } = page.getSize();
            
            // Load fonts
            const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const helveticaBold = await pdfDoc.embedFont(StandardFonts.Helvetica-Bold);
            
            let y = height - 50;
            const margin = 50;
            const lineHeight = 20;
            
            for (const section of sections) {
                // Check if we need a new page
                if (y < 100) {
                    page = pdfDoc.addPage(PageSizes.A4);
                    y = height - 50;
                }
                
                let fontSize = 11;
                let font = helvetica;
                let color = this.styles.colors.primary;
                let alignment = 'left';
                let indent = 0;
                
                switch (section.type) {
                    case 'name':
                        fontSize = 18;
                        font = helveticaBold;
                        color = this.styles.colors.accent;
                        alignment = 'center';
                        y -= 10;
                        break;
                        
                    case 'contact':
                        fontSize = 10;
                        color = this.styles.colors.secondary;
                        alignment = 'center';
                        break;
                        
                    case 'section':
                        fontSize = 14;
                        font = helveticaBold;
                        color = this.styles.colors.accent;
                        y -= 15;
                        // Draw underline
                        page.drawLine({
                            start: { x: margin, y: y - 5 },
                            end: { x: width - margin, y: y - 5 },
                            thickness: 1,
                            color: rgb(0.0, 0.3, 0.6)
                        });
                        break;
                        
                    case 'subheader':
                        fontSize = 12;
                        font = helveticaBold;
                        y -= 5;
                        break;
                        
                    case 'bullet':
                        fontSize = 10;
                        indent = 20;
                        break;
                        
                    case 'title':
                        fontSize = 16;
                        font = helveticaBold;
                        color = this.styles.colors.accent;
                        alignment = 'center';
                        y -= 10;
                        break;
                        
                    case 'date':
                        fontSize = 10;
                        alignment = 'right';
                        break;
                        
                    default:
                        fontSize = 11;
                }
                
                // Calculate text position
                let x = margin + indent;
                if (alignment === 'center') {
                    const textWidth = font.widthOfTextAtSize(section.text, fontSize);
                    x = (width - textWidth) / 2;
                } else if (alignment === 'right') {
                    const textWidth = font.widthOfTextAtSize(section.text, fontSize);
                    x = width - margin - textWidth;
                }
                
                // Handle long text wrapping
                const maxWidth = width - (2 * margin) - indent;
                const words = section.text.split(' ');
                let line = '';
                
                for (const word of words) {
                    const testLine = line + (line ? ' ' : '') + word;
                    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                    
                    if (testWidth > maxWidth && line) {
                        // Draw current line
                        page.drawText(line, {
                            x: x,
                            y: y,
                            size: fontSize,
                            font: font,
                            color: rgb(color.r, color.g, color.b)
                        });
                        
                        y -= lineHeight;
                        line = word;
                        
                        // Check for new page
                        if (y < 100) {
                            page = pdfDoc.addPage(PageSizes.A4);
                            y = height - 50;
                        }
                    } else {
                        line = testLine;
                    }
                }
                
                // Draw remaining text
                if (line) {
                    page.drawText(line, {
                        x: x,
                        y: y,
                        size: fontSize,
                        font: font,
                        color: rgb(color.r, color.g, color.b)
                    });
                }
                
                y -= lineHeight + (section.type === 'section' ? 10 : 0);
            }
            
            return await pdfDoc.save();
            
        } catch (error) {
            logger.error('PDF creation failed', { error: error.message });
            throw new Error(`Failed to create PDF: ${error.message}`);
        }
    }

    // Helper methods for content detection
    isTitleCase(text) {
        return text.split(' ').every(word => 
            word.charAt(0) === word.charAt(0).toUpperCase() && 
            word.slice(1) === word.slice(1).toLowerCase()
        );
    }

    isContactInfo(line) {
        const contactPatterns = [
            /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
            /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // Phone
            /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/i, // Address
            /linkedin\.com|github\.com|portfolio/i // Social links
        ];
        
        return contactPatterns.some(pattern => pattern.test(line));
    }

    isSubHeader(line, currentSection) {
        if (!currentSection) return false;
        
        // Job titles, company names, dates
        const subHeaderPatterns = [
            /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
            /\b\d{4}\s*[-–]\s*(\d{4}|present)\b/i,
            /\b(inc|llc|corp|company|university|college|school)\b/i
        ];
        
        return subHeaderPatterns.some(pattern => pattern.test(line)) || 
               (line.length < 60 && line.includes(','));
    }

    isBulletPoint(line) {
        return /^[-•*]\s/.test(line);
    }

    isDate(line) {
        const datePatterns = [
            /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i,
            /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
            /\b\d{4}-\d{2}-\d{2}\b/
        ];
        
        return datePatterns.some(pattern => pattern.test(line));
    }

    isClosing(line) {
        const closings = [
            'sincerely', 'best regards', 'regards', 'thank you', 'yours truly',
            'respectfully', 'cordially', 'best', 'warmly'
        ];
        
        return closings.some(closing => 
            line.toLowerCase().includes(closing) && line.length < 30
        );
    }
}

module.exports = new DocumentGenerationService();