// ===== ACCESS VERIFICATION ROUTES =====
const express = require('express');
const router  = express.Router();
const store   = require('../data/store');

function normalizePhone(phone) {
  phone = (phone || '').replace(/[\s\-]/g, '');
  if (phone.startsWith('0'))    return '254' + phone.slice(1);
  if (phone.startsWith('+254')) return phone.slice(1);
  if (phone.startsWith('254'))  return phone;
  return phone;
}

// ── POST /api/access/verify ───────────────────────────────────────────────────
// Body: { code }  — code is either a reference (SF-XXXXXX) or a phone number
// Returns { success, reference, name, phone } if a PAID record is found.
router.post('/verify', (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ success: false, message: 'Code is required.' });

  const trimmed = code.trim();

  // 1. Match by reference code
  let student = store.students.find(
    s => s.reference === trimmed && s.status === 'paid'
  );

  // 2. Match by phone number
  if (!student) {
    const norm = normalizePhone(trimmed);
    student = store.students.find(
      s => s.phone === norm && s.status === 'paid'
    );
  }

  if (student) {
    return res.json({
      success:   true,
      reference: student.reference,
      name:      student.name,
      phone:     student.phone,
    });
  }

  return res.json({
    success: false,
    message: 'No active enrollment found for this phone number or reference code.',
  });
});

module.exports = router;
