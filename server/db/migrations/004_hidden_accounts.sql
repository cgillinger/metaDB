CREATE TABLE IF NOT EXISTS hidden_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,        -- 'facebook', 'instagram', 'ga_listens'
  hidden_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_name, platform)
);
CREATE INDEX IF NOT EXISTS idx_hidden_accounts_lookup ON hidden_accounts(account_name, platform);
