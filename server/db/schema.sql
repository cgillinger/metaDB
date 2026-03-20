CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram')),
  month TEXT NOT NULL,
  imported_at TEXT DEFAULT (datetime('now')),
  row_count INTEGER DEFAULT 0,
  account_count INTEGER DEFAULT 0,
  date_range_start TEXT,
  date_range_end TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL,
  account_id TEXT,
  account_name TEXT,
  account_username TEXT,
  description TEXT,
  publish_time TEXT,
  post_type TEXT,
  permalink TEXT,
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram')),
  views INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  link_clicks INTEGER DEFAULT 0,
  other_clicks INTEGER DEFAULT 0,
  saves INTEGER DEFAULT 0,
  follows INTEGER DEFAULT 0,
  interactions INTEGER DEFAULT 0,
  engagement INTEGER DEFAULT 0,
  is_collab BOOLEAN DEFAULT 0,

  UNIQUE(post_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_posts_import ON posts(import_id);
CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_publish_time ON posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
