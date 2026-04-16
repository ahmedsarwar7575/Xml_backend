const express = require('express');
const db = require('../db/init');

const router = express.Router();

router.get('/campaign/:campaignId', (req, res) => {
  try {
    const proxies = db.prepare('SELECT * FROM proxies WHERE campaign_id = ? ORDER BY created_at DESC').all(req.params.campaignId);
    res.json(proxies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { campaign_id, proxy_url } = req.body;
    if (!campaign_id || !proxy_url) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const stmt = db.prepare('INSERT INTO proxies (campaign_id, proxy_url) VALUES (?, ?)');
    const info = stmt.run(campaign_id, proxy_url);
    res.status(201).json({ id: info.lastInsertRowid, message: 'Proxy added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const proxyId = req.params.id;
    const existing = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId);
    if (!existing) return res.status(404).json({ error: 'Proxy not found' });

    db.prepare('DELETE FROM proxies WHERE id = ?').run(proxyId);
    res.json({ message: 'Proxy deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Add this after the POST route
router.put('/:id', (req, res) => {
  try {
    const { proxy_url } = req.body;
    const proxyId = req.params.id;
    const existing = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId);
    if (!existing) return res.status(404).json({ error: 'Proxy not found' });
    const stmt = db.prepare('UPDATE proxies SET proxy_url = ? WHERE id = ?');
    stmt.run(proxy_url, proxyId);
    res.json({ message: 'Proxy updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;