// ===== SMARTFUTURE BACKEND — server.js =====
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const axios   = require('axios');

const payRoutes    = require('./routes/pay');
const accessRoutes = require('./routes/access');
const adminRoutes  = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: function(origin, cb) {
    // Allow everything — browser, Postman, Vercel, localhost
    cb(null, true);
  },
  methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials:    true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static uploads ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', function(req, res) {
  res.json({
    status:  'ok',
    message: 'Smartfuture backend is running.',
    time:    new Date().toISOString(),
    version: '3.0',
  });
});

// ── DIAGNOSTIC ENDPOINT ───────────────────────────────────────────────────────
// Visit: https://YOUR-RENDER-URL.onrender.com/api/diagnose?phone=0712345678
// This shows exactly what is set in env vars and what PayHero returns.
// Delete this route once payment is working.
app.get('/api/diagnose', async function(req, res) {
  var username    = process.env.PAYHERO_USERNAME    || '';
  var password    = process.env.PAYHERO_PASSWORD    || '';
  var channelId   = process.env.PAYHERO_CHANNEL_ID  || '';
  var callbackUrl = process.env.CALLBACK_URL        || 'https://smartfuture-backend.onrender.com/api/pay/callback';
  var testPhone   = req.query.phone                 || '0712345678';

  // Format phone: ensure 07XXXXXXXXX
  var formattedPhone = testPhone.replace(/[\s\-\+]/g, '');
  if (formattedPhone.startsWith('2547') || formattedPhone.startsWith('2541')) {
    formattedPhone = '0' + formattedPhone.slice(3);
  }

  var report = {
    step1_env_vars: {
      PAYHERO_USERNAME:   username   ? 'SET — starts with: ' + username.slice(0, 4) + '***'   : '*** MISSING ***',
      PAYHERO_PASSWORD:   password   ? 'SET — length: ' + password.length                      : '*** MISSING ***',
      PAYHERO_CHANNEL_ID: channelId  ? 'SET — value: ' + channelId                             : '*** MISSING ***',
      CALLBACK_URL:       callbackUrl,
      FRONTEND_URL:       process.env.FRONTEND_URL || 'not set',
    },
    step2_phone_formatting: {
      input:     testPhone,
      formatted: formattedPhone,
      channel_id_as_number: parseInt(channelId, 10) || 'INVALID (not a number)',
    },
    step3_payhero_call: null,
    step4_payhero_raw_response: null,
    step4_payhero_raw_error: null,
  };

  if (!username || !password || !channelId) {
    report.PROBLEM = 'Credentials are missing. Go to Render dashboard → your service → Environment and add them.';
    return res.json(report);
  }

  var credentials = Buffer.from(username + ':' + password).toString('base64');
  var payload = {
    amount:             1,
    phone_number:       formattedPhone,
    channel_id:         parseInt(channelId, 10),
    provider:           'm-pesa',
    external_reference: 'SF-DIAG-' + Date.now(),
    callback_url:       callbackUrl,
    customer_name:      'Diagnostic Test',
  };

  report.step3_payhero_call = {
    url:     'https://backend.payhero.co.ke/api/v2/payments',
    payload: payload,
    auth:    'Basic ' + credentials.slice(0, 8) + '*** (truncated)',
  };

  try {
    var r = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      {
        headers: {
          'Authorization': 'Basic ' + credentials,
          'Content-Type':  'application/json',
        },
        timeout: 20000,
      }
    );
    report.step4_payhero_raw_response = r.data;
    report.RESULT = r.data.success ? 'SUCCESS — STK Push sent! Payment will work.' : 'PayHero returned success:false — see step4_payhero_raw_response for reason.';
  } catch (err) {
    report.step4_payhero_raw_error = {
      http_status: err.response ? err.response.status : 'no response (network error)',
      body:        err.response ? err.response.data   : null,
      message:     err.message,
    };
    if (err.response && err.response.status === 401) {
      report.PROBLEM = 'HTTP 401 — Username or password is wrong. Check PAYHERO_USERNAME and PAYHERO_PASSWORD in Render env vars.';
    } else if (err.response && err.response.status === 400) {
      report.PROBLEM = 'HTTP 400 — PayHero rejected the request. See step4_payhero_raw_error.body for the exact reason.';
    } else if (err.response && err.response.status === 403) {
      report.PROBLEM = 'HTTP 403 — Access denied. Your PayHero account may be inactive or the channel_id is wrong.';
    } else {
      report.PROBLEM = 'Unknown error — see step4_payhero_raw_error.message';
    }
  }

  return res.json(report);
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/pay',    payRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/admin',  adminRoutes);

// ── 404 catch-all ─────────────────────────────────────────────────────────────
app.use(function(req, res) {
  res.status(404).json({ error: 'Route not found.', path: req.path });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, function() {
  console.log('\nSmartfuture backend running on port ' + PORT);
  console.log('Health: http://localhost:' + PORT + '/api/health');
  console.log('Diagnose: http://localhost:' + PORT + '/api/diagnose?phone=0712345678\n');
});
