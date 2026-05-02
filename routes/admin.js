// ===== ADMIN ROUTES =====
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const store   = require('../data/store');

// ── Multer (PDF upload) ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, 'course-' + Date.now() + path.extname(file.originalname)),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted.'), false);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

// ── Session store (swap for JWT in production) ────────────────────────────────
const activeSessions = new Set();

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' });
  }
  const token = auth.slice(7);
  if (!activeSessions.has(token)) {
    return res.status(401).json({ success: false, message: 'Session expired. Please login again.' });
  }
  next();
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  const correct = store.settings.adminPassword ||
    process.env.ADMIN_PASSWORD ||
    'smartfuture2024';

  if (password === correct) {
    const token = 'sf-admin-' + Math.random().toString(36).slice(2) + Date.now();
    activeSessions.add(token);
    // Auto-expire after 8 hours
    setTimeout(() => activeSessions.delete(token), 8 * 60 * 60 * 1000);
    return res.json({ success: true, token });
  }
  return res.json({ success: false, message: 'Incorrect password.' });
});

// ── GET /api/admin/students ───────────────────────────────────────────────────
router.get('/students', requireAdmin, (req, res) => {
  return res.json({
    success:  true,
    students: store.students,
    total:    store.students.length,
    paid:     store.students.filter(s => s.status === 'paid').length,
  });
});

// ── GET /api/admin/settings ───────────────────────────────────────────────────
router.get('/settings', requireAdmin, (req, res) => {
  return res.json({
    success:  true,
    settings: { price: store.settings.price },
  });
});

// ── PATCH /api/admin/settings — update course price ──────────────────────────
router.patch('/settings', requireAdmin, (req, res) => {
  const { price } = req.body;
  if (price && typeof price === 'number' && price >= 1) {
    store.settings.price = price;
    console.log(`Course price updated → KSh ${price}`);
  }
  return res.json({ success: true, settings: { price: store.settings.price } });
});

// ── PATCH /api/admin/modules/:id — update lesson notes ───────────────────────
router.patch('/modules/:id', requireAdmin, (req, res) => {
  const { id }    = req.params;
  const { notes } = req.body;
  // In production: persist to DB here
  console.log(`Admin updated notes for Module ${id}`);
  return res.json({ success: true, message: `Module ${id} notes updated.` });
});

// ── POST /api/admin/upload-pdf ────────────────────────────────────────────────
router.post('/upload-pdf', requireAdmin, upload.single('pdf'), (req, res) => {
  if (!req.file) {
    return res.json({ success: false, message: 'No PDF file received.' });
  }
  console.log('PDF uploaded:', req.file.filename);
  return res.json({
    success:  true,
    message:  'PDF uploaded successfully.',
    filename: req.file.filename,
    path:     `/uploads/${req.file.filename}`,
  });
});

// ── PATCH /api/admin/password ─────────────────────────────────────────────────
router.patch('/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.json({ success: false, message: 'Password must be at least 6 characters.' });
  }
  store.settings.adminPassword = password;
  activeSessions.clear(); // force re-login
  return res.json({ success: true, message: 'Password updated. Please login again.' });
});

module.exports = router;
