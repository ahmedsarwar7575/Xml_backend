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
  feed_item_id INTEGER,
  proxy_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('success', 'failure')),
  final_url TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT,
  geolocation TEXT,
  ip_country TEXT,
  user_agent TEXT,
  error_message TEXT,
  browser_type_used TEXT,
  screenshot_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE SET NULL,
  FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_clicks_campaign_timestamp ON clicks(campaign_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_clicks_status ON clicks(status);
  CREATE INDEX IF NOT EXISTS idx_feed_items_feed ON feed_items(feed_id);
  CREATE INDEX IF NOT EXISTS idx_campaigns_feed ON campaigns(feed_id);
`);

try {
  db.exec("ALTER TABLE clicks ADD COLUMN geolocation TEXT;");
} catch (e) {}

db.exec("PRAGMA max_page_count = 2147483646;");
db.exec("PRAGMA cache_size = -20000;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

// AUTO-FIX MISSING COLUMNS (prevents jobs from silently failing)
const requiredColumns = {
  feed_items: [
    { name: 'is_active', type: 'INTEGER DEFAULT 1' },
    { name: 'last_clicked_at', type: 'DATETIME' },
  ],
  clicks: [
    { name: 'captcha_solved', type: 'INTEGER DEFAULT 0' },
    { name: 'captcha_types', type: 'TEXT' },
  ],
};

for (const [table, columns] of Object.entries(requiredColumns)) {
  for (const col of columns) {
    try {
      db.prepare(`SELECT ${col.name} FROM ${table} LIMIT 1`).get();
    } catch (err) {
      if (err.message.includes('no such column')) {
        console.log(`[DB] Adding missing column: ${table}.${col.name}`);
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type}`).run();
        if (col.name === 'is_active') {
          db.prepare(`UPDATE ${table} SET ${col.name} = 1 WHERE ${col.name} IS NULL`).run();
        }
      }
    }
  }
}

const defaultSettings = [
  ['webshare_api_key', ''],
  ['capsolver_key', ''],
  ['captcha_enabled', 'false'],
  ['headless_mode', 'true'],
  ['admin_username', 'admin'],
  ['admin_password', 'password'],
  ['timezone', 'UTC'],
  ['nova_enabled', 'false'],
  ['nova_host', 'residential.novaproxy.io'],
  ['nova_port', '12321'],
  ['nova_user', ''],
  ['nova_pass', ''],
  ['kind_enabled', 'false'],
  ['kind_host', 'gw.kindproxy.com'],
  ['kind_port', '12000'],
  ['kind_user', ''],
  ['kind_pass', ''],
];

const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [key, value] of defaultSettings) {
  stmt.run(key, value);
}

console.log("Database initialized at", dbPath);
module.exports = db;