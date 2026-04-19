const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "../../data/clicker.db");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('url', 'upload')),
  source TEXT NOT NULL,
  refresh_interval_hours INTEGER DEFAULT 0,
  last_refresh_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    daily_click_target INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    click_interval_min INTEGER NOT NULL,
    click_interval_max INTEGER NOT NULL,
    browser_profile TEXT DEFAULT 'desktop',
    target_country TEXT DEFAULT 'Remote',
    hourly_click_limit INTEGER DEFAULT 0,
    proxy_rotation_strategy TEXT NOT NULL CHECK(proxy_rotation_strategy IN ('round-robin', 'random')),
    browser_rotation_strategy TEXT NOT NULL CHECK(browser_rotation_strategy IN ('single-per-campaign', 'per-click')),
    status INTEGER NOT NULL DEFAULT 1,
    last_proxy_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
    
  );

  CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    proxy_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL,
    title TEXT,
    description TEXT,
    url TEXT NOT NULL,
    locked_until DATETIME,
    country TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    feed_item_id INTEGER NOT NULL,
    proxy_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
    final_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    ip_country TEXT,
    user_agent TEXT,
    error_message TEXT,
    browser_type_used TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    admin_username TEXT DEFAULT 'admin',
    admin_password TEXT DEFAULT 'password',
    timezone TEXT DEFAULT 'UTC'
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_clicks_campaign_timestamp ON clicks(campaign_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_clicks_status ON clicks(status);
  CREATE INDEX IF NOT EXISTS idx_feed_items_feed ON feed_items(feed_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_feed ON campaigns(feed_id);
`);

db.exec(`
  INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('webshare_api_key', ''),
    ('capsolver_key', ''),
    ('captcha_enabled', 'false'),
    ('headless_mode', 'true');
    
`);

console.log("Database initialized at", dbPath);
module.exports = db;
