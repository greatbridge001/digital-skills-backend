// ===== IN-MEMORY DATA STORE =====
// Simple store for development and small-scale production use.
//
// IMPORTANT FOR PRODUCTION:
// Render's free tier restarts the server after ~15 minutes of inactivity,
// which clears this in-memory store. Students who paid will lose access.
//
// To persist data, replace this store with MongoDB Atlas (free tier):
//   1. npm install mongoose
//   2. Add MONGODB_URI to your Render environment variables
//   3. Create Mongoose models for Student and Settings
//
// The rest of the code (routes) does not need to change — just swap
// the array operations for Mongoose find/save calls.

const store = {
  // Array of student objects:
  // { reference, name, phone, status, payheroRef, createdAt, paidAt }
  students: [],

  // App-wide settings
  settings: {
    price:         1,                // KSh — update via admin panel
    adminPassword: process.env.ADMIN_PASSWORD || 'smartfuture2024',
  },
};

module.exports = store;
