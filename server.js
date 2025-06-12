require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure /data folder exists for persistent DB storage
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Initialize persistent SQLite database
const db = new sqlite3.Database(path.join(dataDir, 'data.db'));

// JSON body parser
app.use(express.json());

// Create table for storing codes
db.run(`
  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT,
    username TEXT,
    email TEXT,
    code TEXT,
    created_at INTEGER
  )
`);

// Setup Gmail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Generate random 5-character hex code
function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Clean up old codes every minute (2 min expiry)
setInterval(() => {
  const expiry = Date.now() - 2 * 60 * 1000;
  db.run(`DELETE FROM verification_codes WHERE created_at < ?`, expiry);
}, 60000);

// 📤 Send verification code
app.post('/request-code', (req, res) => {
  const { company, username, email } = req.body;
  if (!company || !username || !email) {
    return res.status(400).json({ message: 'Company, username, and email are required.' });
  }

  const normalizedEmail = email.toLowerCase();
  const code = generateCode();
  const createdAt = Date.now();

  db.run(
    `INSERT INTO verification_codes (company, username, email, code, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [company, username, normalizedEmail, code, createdAt]
  );

  const mailOptions = {
    from: `"${company} Verification" <${process.env.GMAIL_USER}>`,
    to: normalizedEmail,
    subject: `${company} | Verification Code`,
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>${company} Verification</h2>
        <p>Hello <strong>${username}</strong>,</p>
        <p>Your verification code is:</p>
        <div style="font-size: 24px; font-weight: bold;">${code}</div>
        <p>This code expires in 2 minutes.</p>
      </div>
    `
  };

  transporter.sendMail(mailOptions, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Email failed to send.' });
    }
    res.json({ message: 'Verification code sent.' });
  });
});

// ✅ Verify code
app.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  const now = Date.now();

  db.get(
    `SELECT * FROM verification_codes
     WHERE email = ? AND code = ? AND created_at > ?`,
    [email.toLowerCase(), code, now - 2 * 60 * 1000],
    (err, row) => {
      if (err) {
        return res.status(500).json({ valid: false, message: 'Database error.' });
      }

      if (row) {
        return res.json({ valid: true, message: 'Code is valid.' });
      } else {
        return res.status(400).json({ valid: false, message: 'Invalid or expired code.' });
      }
    }
  );
});

// 🔁 Retry logic helper for async SMTP check
function verifySMTPWithRetry(retries = 3, delay = 1000) {
  return new Promise((resolve) => {
    function attempt(n) {
      transporter.verify((err, success) => {
        if (success) return resolve('ok');
        if (n <= 0) return resolve('error');
        setTimeout(() => attempt(n - 1), delay);
      });
    }
    attempt(retries);
  });
}

// 🔍 Healthcheck route with SMTP + DB check
app.get('/health', async (req, res) => {
  const dbStatus = await new Promise((resolve) => {
    db.get('SELECT 1', [], (err) => {
      resolve(err ? 'error' : 'ok');
    });
  });

  const smtpStatus = await verifySMTPWithRetry(3, 1000);
  const allOk = dbStatus === 'ok' && smtpStatus === 'ok';

  res.status(allOk ? 200 : 500).json({
    status: allOk ? 'ok' : 'error',
    components: {
      http: 'ok',
      database: dbStatus,
      smtp: smtpStatus
    },
    timestamp: new Date().toISOString()
  });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});