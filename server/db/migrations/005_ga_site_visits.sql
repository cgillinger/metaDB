-- Migration 005: GA Site Visits
-- Monthly site visit data per programme/editorial account from Google Analytics.

CREATE TABLE IF NOT EXISTS ga_site_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  month TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,
  UNIQUE(account_name, month)
);

CREATE INDEX IF NOT EXISTS idx_ga_site_visits_month ON ga_site_visits(month);
CREATE INDEX IF NOT EXISTS idx_ga_site_visits_name ON ga_site_visits(account_name);
