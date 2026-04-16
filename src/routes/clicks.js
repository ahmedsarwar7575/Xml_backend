const express = require("express");
const db = require("../db/init");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const { campaign_id, limit = 100 } = req.query;
    let query = "SELECT * FROM clicks ORDER BY timestamp DESC LIMIT ?";
    let params = [limit];
    if (campaign_id) {
      query =
        "SELECT * FROM clicks WHERE campaign_id = ? ORDER BY timestamp DESC LIMIT ?";
      params = [campaign_id, limit];
    }
    const clicks = db.prepare(query).all(...params);
    res.json(clicks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats/:campaignId", (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    const total = db
      .prepare("SELECT COUNT(*) as total FROM clicks WHERE campaign_id = ?")
      .get(campaignId).total;
    const success = db
      .prepare(
        "SELECT COUNT(*) as success FROM clicks WHERE campaign_id = ? AND status = 'success'"
      )
      .get(campaignId).success;
    const failure = total - success;
    const successRate = total > 0 ? ((success / total) * 100).toFixed(2) : 0;

    const daily = db
      .prepare(
        `
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM clicks
      WHERE campaign_id = ?
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
      LIMIT 30
    `
      )
      .all(campaignId);

    const geo = db
      .prepare(
        `
      SELECT ip_country, COUNT(*) as count
      FROM clicks
      WHERE campaign_id = ? AND ip_country IS NOT NULL
      GROUP BY ip_country
    `
      )
      .all(campaignId);

    res.json({
      total,
      success,
      failure,
      successRate,
      daily,
      geo,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/logs/recent", (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const logs = db
      .prepare(
        `
      SELECT cl.id, cl.status, cl.final_url, cl.timestamp, cl.error_message, 
             cl.ip_address, cl.ip_country, cl.browser_type_used,
             c.name as campaign_name, fi.title as item_title
      FROM clicks cl
      LEFT JOIN campaigns c ON cl.campaign_id = c.id
      LEFT JOIN feed_items fi ON cl.feed_item_id = fi.id
      ORDER BY cl.timestamp DESC
      LIMIT ?
    `
      )
      .all(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
