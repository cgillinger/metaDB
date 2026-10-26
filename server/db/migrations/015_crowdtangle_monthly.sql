-- Migration 015: historic CrowdTangle monthly per-account totals (2018-2024).
-- Kept in its own table on purpose: these are monthly sums from CrowdTangle
-- leaderboard exports, NOT posts, and must never feed existing metrics,
-- totals, groups, year-over-year or exports. Only the "Legacy CrowdTangle"
-- tab reads it. Non-destructive: creates a new table and index only.
-- NULL means "column missing in that export era", never 0.

CREATE TABLE IF NOT EXISTS ct_monthly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'twitter')),
  account_key TEXT NOT NULL,
  account_name TEXT NOT NULL,
  month TEXT NOT NULL,
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
  UNIQUE (platform, account_key, month)
);

CREATE INDEX IF NOT EXISTS idx_ct_monthly_platform_month ON ct_monthly (platform, month);
