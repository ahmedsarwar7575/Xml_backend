const db = require("../db/init");
const { parseFeedFromUrl, parseFeedFromFile } = require("./feedParser");

async function refreshFeed(feed) {
  console.log(`Refreshing feed ${feed.id} (${feed.name})`);
  let newItems = [];
  try {
    if (feed.source_type === "url") {
      newItems = await parseFeedFromUrl(feed.source);
    } else {
      newItems = await parseFeedFromFile(feed.source);
    }
  } catch (err) {
    console.error(`Failed to refresh feed ${feed.id}:`, err.message);
    return false;
  }

  const existingItems = db
    .prepare("SELECT id, url FROM feed_items WHERE feed_id = ?")
    .all(feed.id);
  const existingMap = new Map(existingItems.map((item) => [item.url, item.id]));

  const updateStmt = db.prepare(
    "UPDATE feed_items SET title = ?, description = ?, country = ? WHERE id = ?"
  );
  const insertStmt = db.prepare(
    "INSERT INTO feed_items (feed_id, title, description, url, country) VALUES (?, ?, ?, ?, ?)"
  );
  const deleteStmt = db.prepare("DELETE FROM feed_items WHERE id = ?");

  const transaction = db.transaction(() => {
    const processedUrls = new Set();
    for (const newItem of newItems) {
      const existingId = existingMap.get(newItem.url);
      if (existingId) {
        updateStmt.run(
          newItem.title,
          newItem.description,
          newItem.country || "",
          existingId
        );
        processedUrls.add(newItem.url);
      } else {
        insertStmt.run(
          feed.id,
          newItem.title,
          newItem.description,
          newItem.url,
          newItem.country || ""
        );
      }
    }
    for (const [url, id] of existingMap.entries()) {
      if (!processedUrls.has(url)) {
        deleteStmt.run(id);
      }
    }
  });

  transaction();
  db.prepare(
    "UPDATE feeds SET last_refresh_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(feed.id);
  console.log(`Feed ${feed.id} refreshed: ${newItems.length} items processed`);
  return true;
}

async function refreshAllDueFeeds() {
  const feeds = db
    .prepare(
      `
    SELECT * FROM feeds
    WHERE refresh_interval_hours > 0
    AND (
      last_refresh_at IS NULL 
      OR datetime(last_refresh_at) <= datetime('now', '-' || refresh_interval_hours || ' hours')
    )
  `
    )
    .all();
  for (const feed of feeds) {
    await refreshFeed(feed);
  }
}

module.exports = { refreshAllDueFeeds };
