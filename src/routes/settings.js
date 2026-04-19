const express = require("express");
const db = require("../db/init");
const router = express.Router();

router.get('/', (req, res) => {
  try {
    const webshare_api_key = db.prepare("SELECT value FROM settings WHERE key = 'webshare_api_key'").get()?.value || '';
    const capsolver_key = db.prepare("SELECT value FROM settings WHERE key = 'capsolver_key'").get()?.value || '';
    const captcha_enabled = db.prepare("SELECT value FROM settings WHERE key = 'captcha_enabled'").get()?.value === 'true';
    const headless_mode = db.prepare("SELECT value FROM settings WHERE key = 'headless_mode'").get()?.value !== 'false';
    const admin_username = db.prepare("SELECT value FROM settings WHERE key = 'admin_username'").get()?.value || 'admin';
    const admin_password = db.prepare("SELECT value FROM settings WHERE key = 'admin_password'").get()?.value || 'password';
    const timezone = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get()?.value || 'UTC';
    res.json({ webshare_api_key, capsolver_key, captcha_enabled, headless_mode, admin_username, admin_password, timezone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/", (req, res) => {
  try {
    const {
      webshare_api_key,
      capsolver_key,
      captcha_enabled,
      headless_mode,
      admin_username,
      admin_password,
      timezone,
    } = req.body;
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    if (webshare_api_key !== undefined)
      stmt.run("webshare_api_key", webshare_api_key);
    if (capsolver_key !== undefined) stmt.run("capsolver_key", capsolver_key);
    if (captcha_enabled !== undefined)
      stmt.run("captcha_enabled", captcha_enabled ? "true" : "false");
    if (headless_mode !== undefined)
      stmt.run("headless_mode", headless_mode ? "true" : "false");
    if (admin_username !== undefined)
      stmt.run("admin_username", admin_username);
    if (admin_password !== undefined && admin_password !== "")
      stmt.run("admin_password", admin_password);
    if (timezone !== undefined) stmt.run("timezone", timezone);
    res.json({ message: "Settings updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
