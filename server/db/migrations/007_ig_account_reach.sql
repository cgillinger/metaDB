-- Migration 007: Instagram Account Reach
-- Monthly account-level reach from Meta Graph API for Instagram accounts.
-- Separate from account_reach (Facebook) to maintain clean platform separation.

CREATE TABLE IF NOT EXISTS ig_account_reach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,        -- ig_name from CSV (display name)
  ig_username TEXT,                   -- ig_username from CSV (handle without @)
  month TEXT NOT NULL,                -- 'YYYY-MM' derived from Period_start
  reach INTEGER NOT NULL DEFAULT 0,
  followers INTEGER DEFAULT 0,       -- Stored for future use
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,

  UNIQUE(account_name, month)
);

CREATE INDEX IF NOT EXISTS idx_ig_account_reach_month ON ig_account_reach(month);
CREATE INDEX IF NOT EXISTS idx_ig_account_reach_name ON ig_account_reach(account_name);
