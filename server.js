require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins (adjust for production)
app.use(cors());

// JSON body parser
app.use(express.json());

// Ensure /data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Initialize SQLite database
const db = new sqlite3.Database(path.join(dataDir, 'data.db'));

// Create table if not exists
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

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Generate 6-character hex code
function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Delete expired codes every 1 min (expire after 5 mins)
setInterval(() => {
  const expiry = Date.now() - 5 * 60 * 1000;
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

  // Store in DB
  db.run(
    `INSERT INTO verification_codes (company, username, email, code, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [company, username, normalizedEmail, code, createdAt],
    function (err) {
      if (err) {
        console.error("DB Insert Error:", err);
        return res.status(500).json({ message: 'Failed to store code.' });
      }

      // Format code into individual digits
      const codeDigits = code.split('').map(c => `<div>${c}</div>`).join('');

      // Send email using HTML template
      const mailOptions = {
        from: `"${company} Verification" <${process.env.GMAIL_USER}>`,
        to: normalizedEmail,
        subject: `${company} | Your Verification Code`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Email Verification</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background-color: #f5f7fa;
      margin: 0;
      padding: 0;
    }
    .container {
      background: white;
      max-width: 480px;
      margin: 40px auto;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 0 8px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #2979ff;
      color: white;
      padding: 30px 20px;
      text-align: center;
    }
    .content {
      padding: 20px;
      color: #333;
    }
    .otp-box {
      display: flex;
      justify-content: center;
      margin: 20px 0;
    }
    .otp-box div {
      font-size: 24px;
      font-weight: bold;
      border: 1px solid #ccc;
      padding: 10px 15px;
      margin: 0 5px;
      border-radius: 4px;
      background-color: #f0f0f0;
    }
    .note {
      font-size: 14px;
      margin-bottom: 20px;
      text-align: center;
    }
    .btn {
      display: block;
      width: 150px;
      margin: 0 auto 20px;
      background-color: #ff5722;
      color: white;
      text-align: center;
      padding: 10px 0;
      text-decoration: none;
      border-radius: 4px;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${company}</h2>
      <p>THANKS FOR SIGNING UP!</p>
      <h3>Verify Your E-Mail Address</h3>
    </div>
    <div class="content">
      <p>Hello ${username},</p>
      <p>Please use the following One Time Password (OTP):</p>
      <div class="otp-box">${codeDigits}</div>
      <p class="note">
        This passcode will only be valid for the next <strong>5 minutes</strong>.
      </p>
      <a class="btn" href="#">Verify Email</a>
    </div>
  </div>
</body>
</html>
        `
      };

      transporter.sendMail(mailOptions, (err) => {
        if (err) {
          console.error("Email Error:", err);
          return res.status(500).json({ message: 'Email failed to send.' });
        }
        res.json({ message: 'Verification code sent.' });
      });
    }
  );
});

// ✅ Verify code
app.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  const now = Date.now();
  const expiry = now - 5 * 60 * 1000;

  if (!email || !code) {
    return res.status(400).json({ valid: false, message: 'Email and code are required.' });
  }

  db.get(
    `SELECT * FROM verification_codes
     WHERE email = ? AND code = ? AND created_at > ?`,
    [email.toLowerCase(), code, expiry],
    (err, row) => {
      if (err) {
        console.error("DB Lookup Error:", err);
        return res.status(500).json({ valid: false, message: 'Database error.' });
      }

      if (row) {
        return res.json({ valid: true, message: '✅ Code is valid!' });
      } else {
        return res.status(400).json({ valid: false, message: '❌ Invalid or expired code.' });
      }
    }
  );
});

// 🧪 Healthcheck
app.get('/health', async (req, res) => {
  const dbStatus = await new Promise((resolve) => {
    db.get('SELECT 1', [], (err) => resolve(err ? 'error' : 'ok'));
  });

  const smtpStatus = await new Promise((resolve) => {
    transporter.verify((err) => resolve(err ? 'error' : 'ok'));
  });

  const allOk = dbStatus === 'ok' && smtpStatus === 'ok';
  res.status(allOk ? 200 : 500).json({
    status: allOk ? 'ok' : 'error',
    components: { http: 'ok', database: dbStatus, smtp: smtpStatus },
    timestamp: new Date().toISOString()
  });
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});