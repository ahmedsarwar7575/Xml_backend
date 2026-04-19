const express = require('express');
const db = require('../db/init');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const storedUsername = db.prepare("SELECT value FROM settings WHERE key = 'admin_username'").get()?.value;
  const storedPassword = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get()?.value;
  if (!storedUsername || !storedPassword) {
    return res.status(500).json({ error: 'Admin credentials not set up' });
  }
  if (username === storedUsername && password === storedPassword) {
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

module.exports = router;