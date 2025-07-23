// config/database-mock.js
// Mock database for development when PostgreSQL is not available

const { logger } = require('./database');

class DatabaseMock {
    constructor() {
        this.users = new Map();
        this.generations = new Map();
        this.apiUsage = new Map();
        this.connected = false;
    }

    async connect() {
        logger.info('Using mock database for development');
        this.connected = true;
        return true;
    }

    async testConnection() {
        return this.connected;
    }

    async query(sql, params = []) {
        logger.debug('Mock database query', { sql, params });
        
        // Mock responses for common queries
        if (sql.includes('SELECT') && sql.includes('users')) {
            return { rows: [] };
        }
        
        if (sql.includes('INSERT') && sql.includes('users')) {
            return { rows: [{ id: 'mock-user-id', tokens: 5 }] };
        }
        
        if (sql.includes('UPDATE') && sql.includes('users')) {
            return { rows: [{ tokens: 4 }] };
        }
        
        return { rows: [] };
    }

    async end() {
        this.connected = false;
        logger.info('Mock database connection closed');
    }
}

module.exports = new DatabaseMock();