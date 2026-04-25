const db = require("../db/init");
const { streamParseFromUrl, streamParseFromFile } = require("./feedParser");

const BATCH_SIZE = 500;
const GC_INTERVAL = 5000;

function safeString(value, maxLength) {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return str.substring(0, maxLength);
}

async function refreshFeed(feed) {
  console.log(`Refreshing feed ${feed.id} (${feed.name})`);

  const deleteStmt = db.prepare("DELETE FROM feed_items WHERE feed_id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO feed_items (feed_id, title, description, url, country)
    VALUES (?, ?, ?, ?, ?)
  `);

  try {
    deleteStmt.run(feed.id);

    let batch = [];
    let totalInserted = 0;
    let processed = 0;

    const flushBatch = db.transaction((items) => {
      for (const item of items) {
        try {
          insertStmt.run(
            feed.id,
            safeString(item.title, 1000),
            safeString(item.description, 5000),
            item.url || "",
            safeString(item.country, 100)
          );
        } catch (err) {
          if (!err.message.includes("string longer than")) {
            console.warn(`Skip item ${item.url}: ${err.message}`);
          }
        }
      }
    });

    const onItem = (item) => {
      if (!item.url) return;

      batch.push(item);
      processed++;

      if (batch.length >= BATCH_SIZE) {
        flushBatch(batch);
        totalInserted += batch.length;
        batch = [];

        if (processed % GC_INTERVAL === 0) {
          if (global.gc) global.gc(false);
          const mem = process.memoryUsage();
          console.log(
            `Feed ${feed.id}: ${processed} items, heap ${Math.round(
              mem.heapUsed / 1024 / 1024
            )}MB`
          );
        }
      }
    };

    if (feed.source_type === "url") {
      await streamParseFromUrl(feed.source, onItem);
    } else {
      await streamParseFromFile(feed.source, onItem);
    }

    if (batch.length > 0) {
      flushBatch(batch);
      totalInserted += batch.length;
      batch = [];
    }

    db.prepare(
      "UPDATE feeds SET last_refresh_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(feed.id);
    console.log(`Feed ${feed.id} refreshed: ${totalInserted} items`);

    if (global.gc) global.gc(true);

    return true;
  } catch (err) {
    console.error(`Failed to refresh feed ${feed.id}:`, err.message || err);
    if (global.gc) global.gc(true);
    return false;
  }
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

  console.log(`Found ${feeds.length} feeds due for refresh`);

  for (const feed of feeds) {
    await refreshFeed(feed);
    if (global.gc) global.gc(true);
  }
}

module.exports = { refreshAllDueFeeds, refreshFeed };
