// tests/globalTeardown.js
// Global test teardown

module.exports = async () => {
  console.log('🧹 Cleaning up test environment...');
  
  // Clean up any global resources
  // Close database connections, etc.
  
  console.log('✅ Test cleanup complete');
};