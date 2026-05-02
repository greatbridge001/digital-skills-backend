// ===== PAYMENT ROUTES =====
const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const store   = require('../data/store');

// ── Phone helpers ─────────────────────────────────────────────────────────────

// PayHero STK Push accepts 07XXXXXXXXX format (10 digits)
function formatPhone(phone) {
  phone = (phone || '').replace(/[\s\-\+]/g, '');
  if (phone.startsWith('2547') || phone.startsWith('2541')) {
    return '0' + phone.slice(3);
  }
  return phone;
}

// Store as 254XXXXXXXXX for consistent lookups
function normalizePhone(phone) {
  phone = (phone || '').replace(/[\s\-\+]/g, '');
  if (phone.startsWith('0'))   return '254' + phone.slice(1);
  if (phone.startsWith('254')) return phone;
  return phone;
}

function generateRef() {
  return 'SF-' + Math.random().toString(36).toUpperCase().slice(2, 8);
}

// Build Basic Auth header from env vars
function getAuthHeader() {
  var u = process.env.PAYHERO_USERNAME || '';
  var p = process.env.PAYHERO_PASSWORD || '';
  return 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
}

// ── POST /api/pay/initiate ────────────────────────────────────────────────────
router.post('/initiate', async function(req, res) {
  var name  = (req.body.name  || '').trim();
  var phone = (req.body.phone || '').trim();

  if (!name || !phone) {
    return res.json({ success: false, message: 'Name and phone number are required.' });
  }

  var storedPhone  = normalizePhone(phone);
  var payheroPhone = formatPhone(phone);
  var amount       = store.settings.price;
  var reference    = generateRef();

  console.log('[PAY] initiate:', { name, storedPhone, payheroPhone, amount, reference });

  // Already paid — redirect straight to dashboard
  var existing = store.students.find(function(s) {
    return s.phone === storedPhone && s.status === 'paid';
  });
  if (existing) {
    return res.json({
      success: false,
      alreadyEnrolled: true,
      reference: existing.reference,
      name: existing.name,
      message: 'This number already has an active enrolment.',
    });
  }

  // Create pending student record
  var student = {
    reference:  reference,
    name:       name,
    phone:      storedPhone,
    status:     'pending',
    payheroRef: null,
    createdAt:  new Date().toISOString(),
    paidAt:     null,
  };
  store.students.push(student);

  var username  = process.env.PAYHERO_USERNAME;
  var password  = process.env.PAYHERO_PASSWORD;
  var channelId = process.env.PAYHERO_CHANNEL_ID;
  var callbackUrl = process.env.CALLBACK_URL ||
    'https://smartfuture-backend.onrender.com/api/pay/callback';

  // TEST MODE — no credentials
  if (!username || !password || !channelId) {
    console.warn('[PAY] TEST MODE — auto-approving in 5s');
    setTimeout(function() {
      var s = store.students.find(function(st) { return st.reference === reference; });
      if (s) { s.status = 'paid'; s.paidAt = new Date().toISOString(); }
    }, 5000);
    return res.json({ success: true, reference: reference, testMode: true });
  }

  var payload = {
    amount:             amount,
    phone_number:       payheroPhone,
    channel_id:         parseInt(channelId, 10),
    provider:           'm-pesa',
    external_reference: reference,
    callback_url:       callbackUrl,
    customer_name:      name,
  };

  console.log('[PAY] sending to PayHero:', JSON.stringify(payload));

  try {
    var phRes = await axios.post(
      'https://backend.payhero.co.ke/api/v2/payments',
      payload,
      {
        headers: {
          'Authorization': getAuthHeader(),
          'Content-Type':  'application/json',
        },
        timeout: 20000,
      }
    );

    console.log('[PAY] PayHero response:', JSON.stringify(phRes.data));

    // Store PayHero's internal reference so we can query status directly
    if (phRes.data && phRes.data.reference) {
      student.payheroRef = phRes.data.reference;
    }

    // PayHero sometimes returns HTTP 200 but success:false
    if (phRes.data && phRes.data.success === false) {
      var idx2 = store.students.findIndex(function(s) { return s.reference === reference; });
      if (idx2 !== -1) store.students.splice(idx2, 1);
      var msg2 = phRes.data.message || phRes.data.error || JSON.stringify(phRes.data);
      console.error('[PAY] PayHero success:false:', msg2);
      return res.json({ success: false, message: msg2 });
    }

    return res.json({ success: true, reference: reference });

  } catch (err) {
    var status  = err.response ? err.response.status : null;
    var errData = err.response ? err.response.data   : null;

    console.error('[PAY] PayHero HTTP error', status, JSON.stringify(errData || err.message));

    var idx = store.students.findIndex(function(s) { return s.reference === reference; });
    if (idx !== -1) store.students.splice(idx, 1);

    var userMsg;
    if (status === 401) {
      userMsg = 'Payment credentials are invalid (401). Check PAYHERO_USERNAME and PAYHERO_PASSWORD in Render.';
    } else if (status === 400) {
      var detail = errData ? (errData.message || errData.error || JSON.stringify(errData)) : err.message;
      userMsg = 'PayHero request error (400): ' + detail;
    } else if (status === 403) {
      userMsg = 'PayHero access denied (403). Verify your channel ID and account status.';
    } else if (err.message && err.message.includes('timeout')) {
      userMsg = 'PayHero request timed out. Please try again.';
    } else {
      var raw = errData ? (errData.message || JSON.stringify(errData)) : err.message;
      userMsg = 'Payment error: ' + raw;
    }

    return res.json({ success: false, message: userMsg });
  }
});

// ── GET /api/pay/status?reference=SF-XXXXXX ───────────────────────────────────
// The frontend polls this every 3 seconds.
// DUAL CHECK: first check our local store (updated by callback),
// then if still pending AND we have a PayHero reference, query PayHero directly.
// This handles Render cold-start delays where the callback may arrive while the
// server is sleeping and get lost.
router.get('/status', async function(req, res) {
  var reference = (req.query.reference || '').trim();
  if (!reference) return res.json({ status: 'not_found' });

  var student = store.students.find(function(s) { return s.reference === reference; });
  if (!student) return res.json({ status: 'not_found' });

  // Already confirmed locally — return immediately
  if (student.status === 'paid' || student.status === 'failed') {
    return res.json({
      status:    student.status,
      reference: student.reference,
      name:      student.name,
      phone:     student.phone,
    });
  }

  // Still pending — ask PayHero directly using their reference
  // This bypasses the callback entirely and works even if Render was sleeping
  if (student.payheroRef) {
    var username = process.env.PAYHERO_USERNAME;
    var password = process.env.PAYHERO_PASSWORD;
    if (username && password) {
      try {
        var phStatus = await axios.get(
          'https://backend.payhero.co.ke/api/v2/payments/' + student.payheroRef,
          {
            headers: { 'Authorization': getAuthHeader() },
            timeout: 10000,
          }
        );

        var d = phStatus.data;
        console.log('[STATUS] PayHero direct status for', reference, ':', JSON.stringify(d));

        // PayHero status field: SUCCESS / FAILED / QUEUED / PENDING
        var phStatusStr = String(d.status || d.payment_status || '').toUpperCase();
        var resultCode  = String(d.result_code || d.ResultCode || '');

        var isSuccess = (phStatusStr === 'SUCCESS' || phStatusStr === 'COMPLETED' ||
                         resultCode === '0');
        var isFailed  = (phStatusStr === 'FAILED'  || phStatusStr === 'CANCELLED' ||
                         phStatusStr === 'EXPIRED'  ||
                         (resultCode !== '' && resultCode !== '0' && resultCode !== 'QUEUED'));

        if (isSuccess) {
          student.status = 'paid';
          student.paidAt = new Date().toISOString();
          console.log('[STATUS] Marked PAID via direct query:', reference);
        } else if (isFailed) {
          student.status = 'failed';
          console.log('[STATUS] Marked FAILED via direct query:', reference);
        }
      } catch (e) {
        // PayHero direct query failed — don't crash, just return current status
        console.warn('[STATUS] Direct PayHero query failed:', e.message);
      }
    }
  }

  return res.json({
    status:    student.status,
    reference: student.reference,
    name:      student.name,
    phone:     student.phone,
  });
});

// ── POST /api/pay/callback ─────────────────────────────────────────────────────
// PayHero calls this after payment. Also works as a backup to the direct polling.
router.post('/callback', function(req, res) {
  var body = req.body || {};
  console.log('[CALLBACK] Received:', JSON.stringify(body));

  var externalRef = body.external_reference || body.ExternalReference ||
                    body.reference          || body.Reference;

  var rawStatus   = String(body.status || body.Status || body.ResultCode || body.result_code || '');
  var upper       = rawStatus.toUpperCase();
  var succeeded   = (upper === 'SUCCESS' || upper === 'COMPLETED' ||
                     rawStatus === '0'   || Number(rawStatus) === 0);

  if (externalRef) {
    var student = store.students.find(function(s) { return s.reference === externalRef; });
    if (student) {
      student.status = succeeded ? 'paid' : 'failed';
      student.paidAt = succeeded ? new Date().toISOString() : null;
      console.log('[CALLBACK] Updated', externalRef, '->', student.status);
    } else {
      // May be a PayHero internal ref — try matching by payheroRef
      var byPhRef = store.students.find(function(s) { return s.payheroRef === externalRef; });
      if (byPhRef) {
        byPhRef.status = succeeded ? 'paid' : 'failed';
        byPhRef.paidAt = succeeded ? new Date().toISOString() : null;
        console.log('[CALLBACK] Updated via payheroRef', externalRef, '->', byPhRef.status);
      } else {
        console.warn('[CALLBACK] Unknown ref:', externalRef);
      }
    }
  } else {
    console.warn('[CALLBACK] Missing external_reference. Body:', JSON.stringify(body));
  }

  return res.status(200).json({ success: true });
});

// GET callback fallback (some PayHero setups redirect)
router.get('/callback', function(req, res) {
  var q      = req.query;
  var extRef = q.external_reference || q.reference;
  var upper  = String(q.status || '').toUpperCase();
  var ok     = (upper === 'SUCCESS' || upper === 'COMPLETED' || q.status === '0');

  if (extRef) {
    var student = store.students.find(function(s) { return s.reference === extRef; });
    if (student) {
      student.status = ok ? 'paid' : 'failed';
      student.paidAt = ok ? new Date().toISOString() : null;
      console.log('[CALLBACK-GET] Updated', extRef, '->', student.status);
    }
  }
  return res.status(200).json({ success: true });
});

module.exports = router;
