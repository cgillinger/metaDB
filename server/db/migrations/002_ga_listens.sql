CREATE TABLE IF NOT EXISTS ga_listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  month TEXT NOT NULL,              -- 'YYYY-MM' format
  listens INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT DEFAULT (datetime('now')),
  source_filename TEXT,

  UNIQUE(account_name, month)       -- En rad per konto per månad
);

CREATE INDEX IF NOT EXISTS idx_ga_listens_month ON ga_listens(month);
CREATE INDEX IF NOT EXISTS idx_ga_listens_name ON ga_listens(account_name);
