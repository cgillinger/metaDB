-- Migration 003: Account Groups
-- User-defined named groups of accounts for aggregated viewing.
-- Groups are source-scoped: a group contains only accounts from one source type.

CREATE TABLE IF NOT EXISTS account_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('ga_listens', 'posts')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, source)
);

CREATE TABLE IF NOT EXISTS account_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,  -- For posts: "account_name::platform", for GA: "account_name::ga_listens"
  UNIQUE(group_id, account_key)
);

CREATE INDEX IF NOT EXISTS idx_agm_group ON account_group_members(group_id);
