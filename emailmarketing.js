const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const GITHUB_REPO = 'https://github.com/Frost-bit-star/stackverify.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const LOCAL_REPO_PATH = path.join(__dirname, 'repo-data');

const router = express.Router();
router.use(cors());
router.use(express.json());

// Git functions
function runGit(cmd) {
  execSync(`git ${cmd}`, { cwd: LOCAL_REPO_PATH, stdio: 'inherit' });
}

function setupGit() {
  runGit('config user.name "Frostbit Star"');
  runGit('config user.email "morganmilstone983@gmail.com"');
}

function ensureMainBranch() {
  const head = path.join(LOCAL_REPO_PATH, '.git', 'HEAD');
  if (fs.existsSync(head) && !fs.readFileSync(head, 'utf-8').includes('refs/heads/main')) {
    runGit('checkout -b main');
  }
}

function cloneRepo() {
  if (!fs.existsSync(LOCAL_REPO_PATH)) {
    const tokenUrl = GITHUB_REPO.replace('https://', `https://${GITHUB_TOKEN}@`);
    execSync(`git clone ${tokenUrl} repo-data`, { cwd: __dirname, stdio: 'inherit' });
  }
}

function pullFromGitHub() {
  runGit('pull');
}

function pushToGitHub(msg = 'Backup: DB update') {
  try {
    setupGit();
    ensureMainBranch();
    runGit('add .');
    execSync(`git diff --cached --quiet || git commit -m "${msg}"`, { cwd: LOCAL_REPO_PATH });
    runGit('push -u origin main');
  } catch (err) {
    console.error("❌ Push error:", err.message);
  }
}

// Initial repo setup
cloneRepo();
pullFromGitHub();

// SQLite setup
const dbPath = path.join(LOCAL_REPO_PATH, 'data.db');
const db = new sqlite3.Database(dbPath, err => {
  if (err) console.error("❌ DB error:", err);
  else console.log("✅ EmailMarketing DB connected from Git repo");
});

// Auto backup every 2 minutes
setInterval(() => {
  pushToGitHub('Backup: Automated 2-minute sync');
}, 2 * 60 * 1000);

// DB tables
db.run(`CREATE TABLE IF NOT EXISTS marketers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER
)`);

db.run(`CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  FOREIGN KEY(company) REFERENCES marketers(company)
)`);

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Email template
function emailTemplate({ brand, headline, subtext, message, cta, footer }) {
  return `<!DOCTYPE html>
  <html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${headline}</title>
  <style>
    body { margin: 0; font-family: 'Segoe UI', sans-serif; background-color: #00c4a7; color: #fff; text-align: center; }
    .container { max-width: 480px; margin: auto; padding: 20px; }
    .logo svg { width: 50px; height: 50px; }
    h2 { font-size: 1.5rem; font-weight: bold; color: #ff1744; }
    .msg { margin: 1rem 0; font-size: 0.95rem; color: #e0f7fa; }
    .btn { display: inline-block; padding: 12px 30px; background: #ff1744; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; margin: 1.5rem 0; }
    footer { font-size: 0.75rem; color: #e0f2f1; margin-top: 10px; }
  </style>
  </head><body><div class="container">
    <h3>${brand}</h3>
    <h2>${headline}</h2>
    <p class="msg">${subtext || ''}</p>
    <p class="msg">${message}</p>
    <a href="#" class="btn">${cta}</a>
    <footer><p>${footer || `&copy; ${new Date().getFullYear()} ${brand}. All rights reserved.`}</p></footer>
  </div></body></html>`;
}

// === API Routes ===

// ✅ Register Marketer
router.post('/marketer/register', (req, res) => {
  const { email, company } = req.body;
  if (!email || !company) return res.status(400).json({ message: 'Email and company name are required' });
  const createdAt = Date.now();
  db.run(`INSERT OR IGNORE INTO marketers (email, company, created_at) VALUES (?, ?, ?)`,
    [email.toLowerCase(), company.toLowerCase(), createdAt],
    function (err) {
      if (err) return res.status(500).json({ message: 'Registration failed', error: err });
      res.json({ message: 'Marketer registered', marketer_id: this.lastID });
    });
});

// ✅ Add Customer Contact
router.post('/marketer/:company/add-contact', (req, res) => {
  const company = req.params.company.toLowerCase();
  const { name, email } = req.body;
  if (!email) return res.status(400).json({ message: 'Customer email is required' });

  db.run(`INSERT INTO contacts (company, name, email) VALUES (?, ?, ?)`,
    [company, name || '', email.toLowerCase()],
    function (err) {
      if (err) return res.status(500).json({ message: 'Failed to add contact', error: err });
      res.json({ message: 'Contact added', contact_id: this.lastID });
    });
});

// ✅ Send Email to All Customers under Company
router.post('/marketer/:company/send-email', (req, res) => {
  const company = req.params.company.toLowerCase();
  const { subject, brand, headline, subtext, message, cta, footer } = req.body;

  if (!subject || !brand || !headline || !message || !cta) {
    return res.status(400).json({ message: 'Missing required fields: subject, brand, headline, message, or cta' });
  }

  db.all('SELECT email FROM contacts WHERE company = ?', [company], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch contacts', error: err });
    if (rows.length === 0) return res.status(404).json({ message: 'No contacts found for this company' });

    const recipients = rows.map(r => r.email);
    const html = emailTemplate({ brand, headline, subtext, message, cta, footer });

    const mailOptions = {
      from: `"${brand}" <${process.env.GMAIL_USER}>`,
      to: recipients,
      subject,
      html
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) return res.status(500).json({ message: 'Failed to send email', error: err });
      res.json({ message: 'Email sent', recipients: recipients.length, info: info.response });
    });
  });
});

module.exports = router;