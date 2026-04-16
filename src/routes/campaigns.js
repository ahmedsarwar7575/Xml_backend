const express = require("express");
const db = require("../db/init");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const campaigns = db
      .prepare(
        `
      SELECT c.*, f.name as feed_name
      FROM campaigns c
      LEFT JOIN feeds f ON c.feed_id = f.id
      ORDER BY c.created_at DESC
    `
      )
      .all();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const campaign = db
      .prepare(
        `
      SELECT c.*, f.name as feed_name
      FROM campaigns c
      LEFT JOIN feeds f ON c.feed_id = f.id
      WHERE c.id = ?
    `
      )
      .get(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", (req, res) => {
  try {
    const {
      feed_id,
      name,
      keywords,
      daily_click_target,
      start_time,
      end_time,
      click_interval_min,
      click_interval_max,
      proxy_rotation_strategy,
      browser_rotation_strategy,
      hourly_click_limit = 0,
      browser_profile = "desktop",
    } = req.body;

    if (
      !feed_id ||
      !name ||
      !daily_click_target ||
      !start_time ||
      !end_time ||
      !click_interval_min ||
      !click_interval_max ||
      !proxy_rotation_strategy ||
      !browser_rotation_strategy
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const keywordsJson = JSON.stringify(keywords || []);

    const stmt = db.prepare(`
      INSERT INTO campaigns (
        feed_id, name, keywords, daily_click_target,
        start_time, end_time, click_interval_min, click_interval_max,
        proxy_rotation_strategy, browser_rotation_strategy, hourly_click_limit, browser_profile
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      feed_id,
      name,
      keywordsJson,
      daily_click_target,
      start_time,
      end_time,
      click_interval_min,
      click_interval_max,
      proxy_rotation_strategy,
      browser_rotation_strategy,
      hourly_click_limit,
      browser_profile
    );
    res
      .status(201)
      .json({ id: info.lastInsertRowid, message: "Campaign created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const {
      feed_id,
      name,
      keywords,
      daily_click_target,
      start_time,
      end_time,
      click_interval_min,
      click_interval_max,
      proxy_rotation_strategy,
      browser_rotation_strategy,
      status,
      hourly_click_limit,
      browser_profile,
    } = req.body;

    const campaignId = req.params.id;
    const existing = db
      .prepare("SELECT * FROM campaigns WHERE id = ?")
      .get(campaignId);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });

    const keywordsJson = JSON.stringify(keywords || []);
    const hourlyLimit =
      hourly_click_limit !== undefined
        ? hourly_click_limit
        : existing.hourly_click_limit;
    const browserProf =
      browser_profile !== undefined
        ? browser_profile
        : existing.browser_profile;

    const stmt = db.prepare(`
      UPDATE campaigns SET
        feed_id = ?,
        name = ?,
        keywords = ?,
        daily_click_target = ?,
        start_time = ?,
        end_time = ?,
        click_interval_min = ?,
        click_interval_max = ?,
        proxy_rotation_strategy = ?,
        browser_rotation_strategy = ?,
        status = ?,
        hourly_click_limit = ?,
        browser_profile = ?
      WHERE id = ?
    `);
    stmt.run(
      feed_id,
      name,
      keywordsJson,
      daily_click_target,
      start_time,
      end_time,
      click_interval_min,
      click_interval_max,
      proxy_rotation_strategy,
      browser_rotation_strategy,
      status !== undefined ? status : existing.status,
      hourlyLimit,
      browserProf,
      campaignId
    );
    res.json({ message: "Campaign updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const campaignId = req.params.id;
    const existing = db
      .prepare("SELECT * FROM campaigns WHERE id = ?")
      .get(campaignId);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(campaignId);
    res.json({ message: "Campaign deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
