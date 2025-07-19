// tests/globalSetup.js
// Global test setup

module.exports = async () => {
  console.log('🧪 Setting up test environment...');
  
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  
  // You could set up a test database here if needed
  // For now, we'll use mocked repositories
  
  console.log('✅ Test environment ready');
};