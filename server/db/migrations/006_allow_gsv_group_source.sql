-- Migration 006: Allow 'ga_site_visits' as a valid source in account_groups.
-- SQLite does not support ALTER TABLE ... DROP CONSTRAINT or modifying a CHECK
-- constraint in place. Use the canonical table-swap pattern instead.
--
-- PRAGMA foreign_keys = OFF/ON are no-ops inside a transaction (SQLite docs),
-- but included for clarity. The runner wraps this in db.transaction(), so
-- DDL operations are safe -- SQLite does not enforce FKs at the DDL level.

PRAGMA foreign_keys = OFF;

CREATE TABLE account_groups_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('ga_listens', 'ga_site_visits', 'posts')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, source)
);

INSERT INTO account_groups_new (id, name, source, created_at)
SELECT id, name, source, created_at FROM account_groups;

DROP TABLE account_groups;
ALTER TABLE account_groups_new RENAME TO account_groups;

PRAGMA foreign_keys = ON;
