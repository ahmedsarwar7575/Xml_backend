const db = require('../db/init');
const { parseFeedFromUrl, parseFeedFromFile } = require('./feedParser');

function safeString(value, maxLength) {
  if (value === undefined || value === null) return '';
  const str = String(value);
  return str.substring(0, maxLength);
}

async function refreshFeed(feed) {
  console.log(`Refreshing feed ${feed.id} (${feed.name})`);
  let newItems = [];
  try {
    if (feed.source_type === 'url') {
      newItems = await parseFeedFromUrl(feed.source);
    } else {
      newItems = await parseFeedFromFile(feed.source);
    }
  } catch (err) {
    console.error(`Failed to refresh feed ${feed.id}:`, err.message || err);
    return false;
  }

  const processedItems = newItems.map(item => ({
    title: safeString(item.title, 1000),
    description: safeString(item.description, 5000),
    url: item.url,
    country: safeString(item.country, 100)
  }));

  const deleteStmt = db.prepare('DELETE FROM feed_items WHERE feed_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO feed_items (feed_id, title, description, url, country)
    VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((feedId, items) => {
    deleteStmt.run(feedId);
    for (const item of items) {
      try {
        insertStmt.run(feedId, item.title, item.description, item.url, item.country);
      } catch (err) {
        if (err.message.includes("string longer than")) {
          console.warn(`Skipping item ${item.url} – description too long`);
        } else {
          throw err;
        }
      }
    }
  });

  try {
    transaction(feed.id, processedItems);
    db.prepare('UPDATE feeds SET last_refresh_at = CURRENT_TIMESTAMP WHERE id = ?').run(feed.id);
    console.log(`Feed ${feed.id} refreshed: ${processedItems.length} items`);
    return true;
  } catch (err) {
    console.error(`Transaction failed for feed ${feed.id}:`, err.message || err);
    return false;
  }
}

async function refreshAllDueFeeds() {
  const feeds = db.prepare(`
    SELECT * FROM feeds
    WHERE refresh_interval_hours > 0
    AND (
      last_refresh_at IS NULL 
      OR datetime(last_refresh_at) <= datetime('now', '-' || refresh_interval_hours || ' hours')
    )
  `).all();
  for (const feed of feeds) {
    await refreshFeed(feed);
  }
}

module.exports = { refreshAllDueFeeds };