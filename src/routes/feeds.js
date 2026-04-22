const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db/init");
const {
  parseFeedFromUrl,
  parseFeedFromFile,
} = require("../services/feedParser");

const router = express.Router();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 50 * 1024 * 1024 },
}); // 50MB limit

function batchInsertItems(feedId, items, batchSize = 500) {
  const insertStmt = db.prepare(`
    INSERT INTO feed_items (feed_id, title, description, url, country)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const insertMany = db.transaction((batchItems) => {
      for (const item of batchItems) {
        const title = (item.title || '').substring(0, 1000);
        const description = (item.description || '').substring(0, 2000);
        const country = (item.country || '').substring(0, 100);
        insertStmt.run(feedId, title, description, item.url, country);
      }
    });
    insertMany(batch);
  }
}
router.get("/", (req, res) => {
  try {
    const feeds = db
      .prepare("SELECT * FROM feeds ORDER BY created_at DESC")
      .all();
    res.json(feeds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const feed = db
      .prepare("SELECT * FROM feeds WHERE id = ?")
      .get(req.params.id);
    if (!feed) return res.status(404).json({ error: "Feed not found" });
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { name, source_type, source, refresh_interval_hours = 0 } = req.body;
    if (!name || !source_type) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    let finalSource = source;
    let feedItems = [];

    if (source_type === "url") {
      feedItems = await parseFeedFromUrl(source);
    } else if (source_type === "upload") {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      finalSource = req.file.path;
      feedItems = await parseFeedFromFile(finalSource);
    } else {
      return res.status(400).json({ error: "Invalid source_type" });
    }

    const insertFeed = db.prepare(`
      INSERT INTO feeds (name, source_type, source, refresh_interval_hours, last_refresh_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const info = insertFeed.run(
      name,
      source_type,
      finalSource,
      refresh_interval_hours
    );
    const feedId = info.lastInsertRowid;
    if (feedItems.length > 5000) {
      console.warn(`Feed had ${feedItems.length} items, truncated to 5000`);
    }
    batchInsertItems(feedId, feedItems);

    res
      .status(201)
      .json({
        id: feedId,
        message: "Feed created",
        itemsCount: feedItems.length,
      });
  } catch (err) {
    console.error("Feed creation error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", upload.single("file"), async (req, res) => {
  try {
    const { name, source_type, source, refresh_interval_hours = 0 } = req.body;
    const feedId = req.params.id;

    const existing = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId);
    if (!existing) return res.status(404).json({ error: "Feed not found" });

    const hasFile = !!req.file;
    const sourceChanged =
      source_type &&
      source &&
      (source !== existing.source || source_type !== existing.source_type);

    if (!hasFile && !sourceChanged) {
      db.prepare(
        "UPDATE feeds SET name = ?, refresh_interval_hours = ? WHERE id = ?"
      ).run(name, refresh_interval_hours, feedId);
      return res.json({ message: "Feed metadata updated" });
    }

    let finalSource = source;
    let feedItems = [];

    if (source_type === "url") {
      feedItems = await parseFeedFromUrl(source);
    } else if (source_type === "upload") {
      if (!hasFile) return res.status(400).json({ error: "No file uploaded" });
      finalSource = req.file.path;
      feedItems = await parseFeedFromFile(finalSource);
    } else {
      return res.status(400).json({ error: "Invalid source_type" });
    }

    const updateFeed = db.prepare(`
      UPDATE feeds SET name = ?, source_type = ?, source = ?, refresh_interval_hours = ?, last_refresh_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateFeed.run(
      name,
      source_type,
      finalSource,
      refresh_interval_hours,
      feedId
    );

    db.prepare("DELETE FROM feed_items WHERE feed_id = ?").run(feedId);
    batchInsertItems(feedId, feedItems);

    res.json({ message: "Feed fully updated", itemsCount: feedItems.length });
  } catch (err) {
    console.error("Feed update error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const feedId = req.params.id;
    const existing = db.prepare("SELECT * FROM feeds WHERE id = ?").get(feedId);
    if (!existing) return res.status(404).json({ error: "Feed not found" });

    const deleteFeed = db.transaction((id) => {
      db.prepare("UPDATE clicks SET feed_item_id = NULL WHERE feed_item_id IN (SELECT id FROM feed_items WHERE feed_id = ?)").run(id);
      db.prepare("DELETE FROM feed_items WHERE feed_id = ?").run(id);
      db.prepare("DELETE FROM campaigns WHERE feed_id = ?").run(id);
      db.prepare("DELETE FROM feeds WHERE id = ?").run(id);
    });
    deleteFeed(feedId);

    res.json({ message: "Feed deleted" });
  } catch (err) {
    console.error("Feed delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
