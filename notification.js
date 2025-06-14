const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const router = express.Router();
router.use(cors());
router.use(express.json());

// === Nodemailer Setup ===
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// === Styled Email Template with Custom Message ===
function styledTemplate({ company_name, body }) {
  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        background: #f9f9f9;
        padding: 40px;
        color: #333;
      }
      .container {
        max-width: 600px;
        margin: auto;
        background: #ffffff;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 0 8px rgba(0,0,0,0.1);
      }
      h2 {
        color: #004080;
      }
      p {
        line-height: 1.6;
      }
      .highlight {
        background: #f0f8ff;
        padding: 10px;
        border-left: 4px solid #007acc;
        margin: 20px 0;
      }
      .footer {
        font-size: 12px;
        color: #777;
        margin-top: 40px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Message from ${company_name || 'Your Company'}</h2>
      <div class="highlight">
        ${body}
      </div>
      <div class="footer">
        &copy; ${new Date().getFullYear()} ${company_name || 'Your Company'}. All rights reserved.
      </div>
    </div>
  </body>
  </html>`;
}

// === POST /api/send-notification
router.post('/send-notification', (req, res) => {
  const { to, subject, body, company_name } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ message: 'Missing required fields: to, subject, body' });
  }

  const html = styledTemplate({ company_name, body });

  const mailOptions = {
    from: `"${company_name || 'Notifier'}" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) return res.status(500).json({ message: 'Failed to send email', error: err });
    res.json({ message: 'Notification email sent', to, info: info.response });
  });
});

module.exports = router;