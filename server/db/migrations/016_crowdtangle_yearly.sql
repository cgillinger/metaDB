-- Migration 016: historic CrowdTangle full-year per-account totals (2014-2022).
-- Kept in its own table on purpose, like ct_monthly (015): these are yearly
-- sums from CrowdTangle leaderboard exports, NOT posts, and must never feed
-- existing metrics, totals, groups, year-over-year or exports. Only the
-- "Legacy CrowdTangle" tab reads it. Non-destructive: creates a new table and
-- index only. NULL means "column missing in that export era", never 0.

CREATE TABLE IF NOT EXISTS ct_yearly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'twitter')),
  account_key TEXT NOT NULL,
  account_name TEXT NOT NULL,
  year TEXT NOT NULL,
  interactions INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  posts INTEGER,
  video_views INTEGER,
  followers INTEGER,
  source_list TEXT,
  source_filename TEXT,
  exported_at TEXT,
  export_date_source TEXT,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (platform, account_key, year)
);

CREATE INDEX IF NOT EXISTS idx_ct_yearly_platform_year ON ct_yearly (platform, year);
