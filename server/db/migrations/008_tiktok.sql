-- Migration 008: TikTok-stöd
-- Lägger till 'tiktok' som tillåten plattform i posts och imports (table-swap pattern,
-- jfr migration 006). Skapar tiktok_account_daily för Översikt-CSV:n (per dag/konto).
--
-- Video-CSV:n lagras i den befintliga posts-tabellen med platform = 'tiktok':
--   - post_id    = sista siffersträngen i Videolänk
--   - account_username = handle (t.ex. p3dingata) ur URL
--   - account_name     = display-namn (t.ex. "P3 Din Gata") från användarbekräftelse
--   - permalink  = hela Videolänk
--   - description = Videotitel
--   - publish_time = Publiceringstid (redan Stockholm — ingen konvertering)
--   - views/likes/comments/shares/saves = direkta värden
--   - reach/total_clicks/link_clicks/other_clicks/follows = 0 (saknas i TikTok-export)
--   - interactions = likes + comments + shares
--   - engagement   = interactions + saves  (TikTok-specifik formel)
--
-- Översikt-CSV:n lagras i tiktok_account_daily, en rad per dag och konto.

PRAGMA foreign_keys = OFF;

-- 1. Utöka posts.platform till att inkludera 'tiktok'
CREATE TABLE posts_new (
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
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'tiktok')),
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

INSERT INTO posts_new
SELECT id, import_id, post_id, account_id, account_name, account_username,
       description, publish_time, post_type, permalink, platform,
       views, reach, likes, comments, shares,
       total_clicks, link_clicks, other_clicks, saves, follows,
       interactions, engagement, is_collab
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_import ON posts(import_id);
CREATE INDEX IF NOT EXISTS idx_posts_account ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_publish_time ON posts(publish_time);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);

-- 2. Utöka imports.platform till att inkludera 'tiktok'
CREATE TABLE imports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'tiktok')),
  month TEXT NOT NULL,
  imported_at TEXT DEFAULT (datetime('now')),
  row_count INTEGER DEFAULT 0,
  account_count INTEGER DEFAULT 0,
  date_range_start TEXT,
  date_range_end TEXT
);

INSERT INTO imports_new
SELECT id, filename, platform, month, imported_at, row_count, account_count,
       date_range_start, date_range_end
FROM imports;

DROP TABLE imports;
ALTER TABLE imports_new RENAME TO imports;

-- 3. Ny tabell för TikTok Översikt-data (dagsupplösning per konto)
-- Råvärden lagras dagligt; månadsaggregat beräknas vid hämtning (CLAUDE.md-princip).
-- Räckvidd (reach) är icke-summerbar över dagar — använd alltid AVG, aldrig SUM.
CREATE TABLE IF NOT EXISTS tiktok_account_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_username TEXT NOT NULL,         -- handle, kanonisk identifierare (t.ex. p3dingata)
  account_name TEXT,                       -- display-namn vid importtillfället (t.ex. "P3 Din Gata")
  date TEXT NOT NULL,                      -- 'YYYY-MM-DD'
  month TEXT NOT NULL,                     -- 'YYYY-MM' (denormaliserad för enkel indexering/filtrering)
  video_views INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,        -- dagsräckvidd ("Målgrupp som nåtts") — får ej summeras
  profile_views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  shares INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  new_followers INTEGER NOT NULL DEFAULT 0,
  lost_followers INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,
  UNIQUE(account_username, date)           -- per-dag UPSERT: ny data vinner
);

CREATE INDEX IF NOT EXISTS idx_tiktok_daily_month ON tiktok_account_daily(month);
CREATE INDEX IF NOT EXISTS idx_tiktok_daily_account ON tiktok_account_daily(account_username);
CREATE INDEX IF NOT EXISTS idx_tiktok_daily_account_month ON tiktok_account_daily(account_username, month);

PRAGMA foreign_keys = ON;
