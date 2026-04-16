const express = require('express');
const db = require('../db/init');
const router = express.Router();

router.get('/stats', (req, res) => {
  try {
    const totalCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns').get().count;
    const activeCampaigns = db.prepare('SELECT COUNT(*) as count FROM campaigns WHERE status = 1').get().count;
    const totalClicks = db.prepare('SELECT COUNT(*) as count FROM clicks').get().count;
    const successClicks = db.prepare("SELECT COUNT(*) as count FROM clicks WHERE status = 'success'").get().count;
    const failureClicks = totalClicks - successClicks;
    const successRate = totalClicks > 0 ? ((successClicks / totalClicks) * 100).toFixed(2) : 0;

    const last7Days = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM clicks
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all();

    const topCampaigns = db.prepare(`
      SELECT c.name, COUNT(cl.id) as clicks
      FROM campaigns c
      LEFT JOIN clicks cl ON cl.campaign_id = c.id
      GROUP BY c.id
      ORDER BY clicks DESC
      LIMIT 5
    `).all();

    res.json({
      totalCampaigns,
      activeCampaigns,
      totalClicks,
      successClicks,
      failureClicks,
      successRate,
      last7Days,
      topCampaigns
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;