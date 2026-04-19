const express = require("express");
const db = require("../db/init");
const router = express.Router();

router.get("/stats", (req, res) => {
  try {
    const totalCampaigns = db
      .prepare("SELECT COUNT(*) as count FROM campaigns")
      .get().count;
    const activeCampaigns = db
      .prepare("SELECT COUNT(*) as count FROM campaigns WHERE status = 1")
      .get().count;
    const totalClicks = db
      .prepare("SELECT COUNT(*) as count FROM clicks")
      .get().count;
    const successClicks = db
      .prepare("SELECT COUNT(*) as count FROM clicks WHERE status = 'success'")
      .get().count;
    const failureClicks = totalClicks - successClicks;
    const successRate =
      totalClicks > 0 ? ((successClicks / totalClicks) * 100).toFixed(2) : 0;

    const last7Days = db
      .prepare(
        `
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM clicks
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `
      )
      .all();

    // Fixed query: CAST campaign_id to INTEGER to avoid type mismatch
    const topCampaigns = db
      .prepare(
        `
      SELECT c.name, COUNT(cl.id) as clicks
      FROM campaigns c
      LEFT JOIN clicks cl ON CAST(cl.campaign_id AS INTEGER) = c.id
      GROUP BY c.id
      ORDER BY clicks DESC
      LIMIT 5
    `
      )
      .all();

    const recentLogs = db
      .prepare(
        `
      SELECT cl.id, cl.status, cl.final_url, cl.timestamp, cl.error_message,
             cl.ip_address, cl.ip_country, cl.browser_type_used,
             c.name as campaign_name, fi.title as item_title
      FROM clicks cl
      LEFT JOIN campaigns c ON CAST(cl.campaign_id AS INTEGER) = c.id
      LEFT JOIN feed_items fi ON cl.feed_item_id = fi.id
      ORDER BY cl.timestamp DESC
      LIMIT 10
    `
      )
      .all();

    res.json({
      totalCampaigns,
      activeCampaigns,
      totalClicks,
      successClicks,
      failureClicks,
      successRate,
      last7Days,
      topCampaigns,
      recentLogs,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
