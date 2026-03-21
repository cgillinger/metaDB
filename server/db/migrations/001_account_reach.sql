CREATE TABLE IF NOT EXISTS account_reach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  page_id TEXT,
  month TEXT NOT NULL,              -- 'YYYY-MM' format
  reach INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,

  UNIQUE(account_name, month)       -- En rad per konto per månad
);

CREATE INDEX IF NOT EXISTS idx_account_reach_month ON account_reach(month);
CREATE INDEX IF NOT EXISTS idx_account_reach_name ON account_reach(account_name);
