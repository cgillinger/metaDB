-- Migration 009: Facebook Account Viewers ("Unika tittare (API)")
-- Monthly account-level unique viewers (page_total_media_view_unique, Graph API
-- v25.0+). Replaces the deprecated legacy reach measure (page_impressions_unique,
-- dead upstream since 2026-06-15), which stays frozen in account_reach as history.
-- Separate table on purpose: the two measures have different definitions (viewers
-- uses a stricter view threshold), so the series must never be merged — and a
-- viewers backfill may overlap legacy months without overwriting them.

CREATE TABLE IF NOT EXISTS account_viewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  page_id TEXT,
  month TEXT NOT NULL,               -- 'YYYY-MM' derived from Period_start
  viewers INTEGER NOT NULL DEFAULT 0,
  period_start TEXT,                 -- actual API window; read this, never the label
  period_end TEXT,
  views_source TEXT,                 -- metric provenance, e.g. 'page_total_media_view_unique@v25.0'
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,

  UNIQUE(account_name, month)
);

CREATE INDEX IF NOT EXISTS idx_account_viewers_month ON account_viewers(month);
CREATE INDEX IF NOT EXISTS idx_account_viewers_name ON account_viewers(account_name);
