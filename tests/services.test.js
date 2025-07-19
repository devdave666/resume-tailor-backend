// tests/services.test.js
// Services unit tests

describe('Services', () => {
  
  describe('DocumentParsingService', () => {
    let DocumentParsingService;
    
    beforeEach(() => {
      // Reset mocks and require fresh instance
      jest.resetModules();
      DocumentParsingService = require('../services/DocumentParsingService');
    });
    
    describe('validateFile', () => {
      it('should validate valid file', () => {
        const validFile = {
          buffer: Buffer.from('test content'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 100
        };
        
        expect(() => DocumentParsingService.validateFile(validFile)).not.toThrow();
      });
      
      it('should reject file without buffer', () => {
        const invalidFile = {
          originalname: 'test.txt',
          mimetype: 'text/plain'
        };
        
        expect(() => DocumentParsingService.validateFile(invalidFile))
          .toThrow('No file provided');
      });
      
      it('should reject unsupported file type', () => {
        const invalidFile = {
          buffer: Buffer.from('test'),
          originalname: 'test.exe',
          mimetype: 'application/x-executable'
        };
        
        expect(() => DocumentParsingService.validateFile(invalidFile))
          .toThrow('Unsupported file type');
      });
    });
    
    describe('getFileTypeInfo', () => {
      it('should return correct info for PDF', () => {
        const info = DocumentParsingService.getFileTypeInfo('application/pdf');
        expect(info.name).toBe('PDF');
        expect(info.extension).toBe('.pdf');
      });
      
      it('should return correct info for DOCX', () => {
        const info = DocumentParsingService.getFileTypeInfo(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
        expect(info.name).toBe('DOCX');
        expect(info.extension).toBe('.docx');
      });
      
      it('should handle unknown types', () => {
        const info = DocumentParsingService.getFileTypeInfo('unknown/type');
        expect(info.name).toBe('Unknown');
        expect(info.extension).toBe('');
      });
    });
  });
  
  describe('AIGenerationService', () => {
    let AIGenerationService;
    
    beforeEach(() => {
      jest.resetModules();
      // Don't mock for unit tests
      jest.unmock('../services/AIGenerationService');
      AIGenerationService = require('../services/AIGenerationService');
    });
    
    describe('validateInputs', () => {
      it('should validate correct inputs', () => {
        const resumeText = 'A'.repeat(100); // 100 characters
        const jobDescription = 'B'.repeat(100); // 100 characters
        
        expect(() => AIGenerationService.validateInputs(resumeText, jobDescription))
          .not.toThrow();
      });
      
      it('should reject empty resume text', () => {
        expect(() => AIGenerationService.validateInputs('', 'job description'))
          .toThrow('Resume text is required');
      });
      
      it('should reject short resume text', () => {
        expect(() => AIGenerationService.validateInputs('short', 'job description'))
          .toThrow('Resume text is too short');
      });
      
      it('should reject empty job description', () => {
        expect(() => AIGenerationService.validateInputs('resume text', ''))
          .toThrow('Job description is required');
      });
      
      it('should reject very long inputs', () => {
        const veryLongText = 'A'.repeat(25000);
        expect(() => AIGenerationService.validateInputs(veryLongText, 'job description'))
          .toThrow('Resume text is too long');
      });
    });
    
    describe('parseAIResponse', () => {
      it('should parse valid JSON response', () => {
        const validResponse = JSON.stringify({
          tailoredResume: 'Tailored resume content',
          coverLetter: 'Cover letter content'
        });
        
        const result = AIGenerationService.parseAIResponse(validResponse);
        expect(result.tailoredResume).toBe('Tailored resume content');
        expect(result.coverLetter).toBe('Cover letter content');
      });
      
      it('should handle response with markdown formatting', () => {
        const responseWithMarkdown = `\`\`\`json
        {
          "tailoredResume": "Resume content",
          "coverLetter": "Cover letter content"
        }
        \`\`\``;
        
        const result = AIGenerationService.parseAIResponse(responseWithMarkdown);
        expect(result.tailoredResume).toBe('Resume content');
        expect(result.coverLetter).toBe('Cover letter content');
      });
      
      it('should throw error for invalid JSON', () => {
        const invalidResponse = 'This is not JSON';
        
        expect(() => AIGenerationService.parseAIResponse(invalidResponse))
          .toThrow('Invalid JSON response from AI');
      });
    });
    
    describe('validateGeneratedContent', () => {
      it('should validate correct content', () => {
        const validContent = {
          tailoredResume: 'A'.repeat(200),
          coverLetter: 'B'.repeat(300)
        };
        
        expect(() => AIGenerationService.validateGeneratedContent(validContent))
          .not.toThrow();
      });
      
      it('should reject content without tailoredResume', () => {
        const invalidContent = {
          coverLetter: 'Cover letter content'
        };
        
        expect(() => AIGenerationService.validateGeneratedContent(invalidContent))
          .toThrow('Generated content must include a valid tailoredResume');
      });
      
      it('should reject content with short resume', () => {
        const invalidContent = {
          tailoredResume: 'short',
          coverLetter: 'B'.repeat(300)
        };
        
        expect(() => AIGenerationService.validateGeneratedContent(invalidContent))
          .toThrow('Generated resume is too short');
      });
    });
    
    describe('validateConfiguration', () => {
      it('should validate when API key is present', () => {
        process.env.GEMINI_API_KEY = 'valid-api-key';
        const isValid = AIGenerationService.validateConfiguration();
        expect(isValid).toBe(true);
      });
      
      it('should reject placeholder API key', () => {
        process.env.GEMINI_API_KEY = 'your-gemini-api-key-here';
        const isValid = AIGenerationService.validateConfiguration();
        expect(isValid).toBe(false);
      });
    });
  });
  
  describe('DocumentGenerationService', () => {
    let DocumentGenerationService;
    
    beforeEach(() => {
      jest.resetModules();
      DocumentGenerationService = require('../services/DocumentGenerationService');
    });
    
    describe('parseContent', () => {
      it('should parse resume content', () => {
        const content = `
          JOHN DOE
          john@example.com
          
          EXPERIENCE
          Software Engineer
          • Developed applications
          • Led team projects
        `;
        
        const sections = DocumentGenerationService.parseContent(content, 'resume');
        expect(sections).toBeInstanceOf(Array);
        expect(sections.length).toBeGreaterThan(0);
        
        // Should identify name section
        const nameSection = sections.find(s => s.type === 'name');
        expect(nameSection).toBeDefined();
        expect(nameSection.text).toBe('JOHN DOE');
      });
      
      it('should parse cover letter content', () => {
        const content = `
          Cover Letter
          
          January 15, 2024
          
          Dear Hiring Manager,
          
          I am writing to express my interest...
          
          Sincerely,
          John Doe
        `;
        
        const sections = DocumentGenerationService.parseContent(content, 'coverLetter');
        expect(sections).toBeInstanceOf(Array);
        expect(sections.length).toBeGreaterThan(0);
        
        // Should identify different section types
        const titleSection = sections.find(s => s.type === 'title');
        const dateSection = sections.find(s => s.type === 'date');
        const salutationSection = sections.find(s => s.type === 'salutation');
        
        expect(titleSection).toBeDefined();
        expect(dateSection).toBeDefined();
        expect(salutationSection).toBeDefined();
      });
      
      it('should handle empty content', () => {
        expect(() => DocumentGenerationService.parseContent('', 'resume'))
          .toThrow('Content must be a non-empty string');
      });
    });
    
    describe('helper methods', () => {
      it('should detect title case', () => {
        expect(DocumentGenerationService.isTitleCase('John Doe')).toBe(true);
        expect(DocumentGenerationService.isTitleCase('JOHN DOE')).toBe(false);
        expect(DocumentGenerationService.isTitleCase('john doe')).toBe(false);
      });
      
      it('should detect contact info', () => {
        expect(DocumentGenerationService.isContactInfo('john@example.com')).toBe(true);
        expect(DocumentGenerationService.isContactInfo('555-123-4567')).toBe(true);
        expect(DocumentGenerationService.isContactInfo('123 Main Street')).toBe(true);
        expect(DocumentGenerationService.isContactInfo('linkedin.com/in/johndoe')).toBe(true);
        expect(DocumentGenerationService.isContactInfo('Regular text')).toBe(false);
      });
      
      it('should detect bullet points', () => {
        expect(DocumentGenerationService.isBulletPoint('• Bullet point')).toBe(true);
        expect(DocumentGenerationService.isBulletPoint('- Bullet point')).toBe(true);
        expect(DocumentGenerationService.isBulletPoint('* Bullet point')).toBe(true);
        expect(DocumentGenerationService.isBulletPoint('Regular text')).toBe(false);
      });
      
      it('should detect dates', () => {
        expect(DocumentGenerationService.isDate('January 15, 2024')).toBe(true);
        expect(DocumentGenerationService.isDate('01/15/2024')).toBe(true);
        expect(DocumentGenerationService.isDate('2024-01-15')).toBe(true);
        expect(DocumentGenerationService.isDate('Regular text')).toBe(false);
      });
      
      it('should detect closings', () => {
        expect(DocumentGenerationService.isClosing('Sincerely,')).toBe(true);
        expect(DocumentGenerationService.isClosing('Best regards,')).toBe(true);
        expect(DocumentGenerationService.isClosing('Thank you,')).toBe(true);
        expect(DocumentGenerationService.isClosing('Regular text')).toBe(false);
      });
    });
  });
  
  describe('MonitoringService', () => {
    let MonitoringService;
    
    beforeEach(() => {
      jest.resetModules();
      MonitoringService = require('../services/MonitoringService');
    });
    
    describe('recordRequest', () => {
      it('should record successful request', () => {
        MonitoringService.recordRequest('/test', 100, true);
        
        const metrics = MonitoringService.getMetrics();
        expect(metrics.requests.total).toBe(1);
        expect(metrics.requests.successful).toBe(1);
        expect(metrics.requests.failed).toBe(0);
      });
      
      it('should record failed request', () => {
        MonitoringService.recordRequest('/test', 500, false);
        
        const metrics = MonitoringService.getMetrics();
        expect(metrics.requests.failed).toBe(1);
      });
      
      it('should track endpoint-specific metrics', () => {
        MonitoringService.recordRequest('/generate', 2000, true);
        MonitoringService.recordRequest('/generate', 3000, true);
        
        const metrics = MonitoringService.getMetrics();
        const endpointStats = metrics.requests.byEndpoint['/generate'];
        
        expect(endpointStats.count).toBe(2);
        expect(endpointStats.averageTime).toBe(2500);
      });
    });
    
    describe('recordError', () => {
      it('should record error with details', () => {
        const error = new Error('Test error');
        error.name = 'TestError';
        
        MonitoringService.recordError(error, '/test');
        
        const metrics = MonitoringService.getMetrics();
        expect(metrics.errors.total).toBe(1);
        expect(metrics.errors.byType.TestError).toBe(1);
        expect(metrics.errors.recent).toHaveLength(1);
        expect(metrics.errors.recent[0].message).toBe('Test error');
      });
    });
    
    describe('formatBytes', () => {
      it('should format bytes correctly', () => {
        expect(MonitoringService.formatBytes(0)).toBe('0 B');
        expect(MonitoringService.formatBytes(1024)).toBe('1 KB');
        expect(MonitoringService.formatBytes(1024 * 1024)).toBe('1 MB');
        expect(MonitoringService.formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
      });
    });
    
    describe('formatUptime', () => {
      it('should format uptime correctly', () => {
        expect(MonitoringService.formatUptime(30)).toBe('30s');
        expect(MonitoringService.formatUptime(90)).toBe('1m 30s');
        expect(MonitoringService.formatUptime(3661)).toBe('1h 1m 1s');
        expect(MonitoringService.formatUptime(90061)).toBe('1d 1h 1m 1s');
      });
    });
  });
});