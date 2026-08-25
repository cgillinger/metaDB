-- Migration 011: Account roster — alarms when a normally-present account is
-- missing from an import, instead of the gap sitting undetected for months
-- (see TASK-saknade-exportmanader.md for the mapped historical gaps).
--
-- Three loose tables, no FK (same pattern as hidden_accounts in 004): identity
-- is (account_name, platform), timestamps are datetime('now'). No CHECK on
-- status — see 006_allow_gsv_group_source.sql for what it costs to widen a
-- CHECKed value set later (full table-swap with FK-off outside the
-- transaction). Kept deliberately separate from hidden_accounts: "hidden"
-- means "I don't want to see this" and hides the history too; "retired"
-- means "this account doesn't exist any more" and keeps all history, it just
-- stops alarming.

CREATE TABLE IF NOT EXISTS account_roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'retired'
  retired_at TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_name, platform)
);

CREATE TABLE IF NOT EXISTS account_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  month TEXT NOT NULL,
  import_id INTEGER,
  noticed_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  UNIQUE(account_name, platform, month)
);

CREATE TABLE IF NOT EXISTS import_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  UNIQUE(import_id, account_name)
);

CREATE INDEX IF NOT EXISTS idx_account_gaps_lookup ON account_gaps(account_name, platform, resolved_at);
CREATE INDEX IF NOT EXISTS idx_account_gaps_import ON account_gaps(import_id);
CREATE INDEX IF NOT EXISTS idx_import_accounts_import ON import_accounts(import_id);
CREATE INDEX IF NOT EXISTS idx_import_accounts_name ON import_accounts(account_name);

-- Backfill import_accounts from posts. Accepted underrepresentation for older
-- re-imports: since v2.22.0 a post keeps its ORIGINAL import_id on UPSERT, so
-- a re-import's full account list can't be reconstructed from posts after the
-- fact. Good enough as a starting point — the Jaccard history (see
-- server/services/roster/missingAccounts.js) only needs a six-import window
-- going forward from this migration.
INSERT OR IGNORE INTO import_accounts (import_id, account_name)
SELECT DISTINCT import_id, account_name FROM posts WHERE account_name IS NOT NULL;

-- Seed the 38 known gap months from TASK-saknade-exportmanader.md (mapped
-- 2026-08-25). Facebook only — verified against the live posts table so the
-- exact account_name spellings match (several of these programmes have a
-- similarly-named sibling account, e.g. "Naturmorgon" vs "Naturmorgon i P1",
-- that is NOT affected). Static, auditable INSERT OR IGNORE rows — deliberately
-- not derived from the heuristic SQL in that file, which stays for finding NEW
-- gaps, not for this one-time seed. No import_id: these predate the roster and
-- have no triggering import row.

-- Kvällspasset i P4 (7 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2025-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2025-12');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2026-01');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2026-02');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2026-03');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2026-04');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Kvällspasset i P4', 'facebook', '2026-06');

-- Naturmorgon (7 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2025-11');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2025-12');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2026-01');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2026-02');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2026-03');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2026-04');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Naturmorgon', 'facebook', '2026-06');

-- Trafikredaktionen P4 Stockholm (2 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Trafikredaktionen P4 Stockholm', 'facebook', '2024-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Trafikredaktionen P4 Stockholm', 'facebook', '2024-12');

-- Vaken med P3 och P4 (3 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Vaken med P3 och P4', 'facebook', '2026-03');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Vaken med P3 och P4', 'facebook', '2026-04');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Vaken med P3 och P4', 'facebook', '2026-06');

-- Nyheter från Sveriges Radio Ekot (6 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2024-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2024-11');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2025-06');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2025-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2025-08');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Nyheter från Sveriges Radio Ekot', 'facebook', '2025-09');

-- Sveriges Radio P2 (1 month)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Sveriges Radio P2', 'facebook', '2024-05');

-- Klassisk morgon i P2 (1 month)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Klassisk morgon i P2', 'facebook', '2026-01');

-- P4 DANS (1 month)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('P4 DANS', 'facebook', '2025-11');

-- Framåt Fredag (3 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Framåt Fredag', 'facebook', '2024-02');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Framåt Fredag', 'facebook', '2024-03');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Framåt Fredag', 'facebook', '2025-08');

-- Radio Romano (1 month)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Radio Romano', 'facebook', '2026-02');

-- Livsåskådning i P1 (1 month)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Livsåskådning i P1', 'facebook', '2024-08');

-- Terni Generatcia (5 months)
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Terni Generatcia', 'facebook', '2024-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Terni Generatcia', 'facebook', '2025-03');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Terni Generatcia', 'facebook', '2025-07');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Terni Generatcia', 'facebook', '2025-08');
INSERT OR IGNORE INTO account_gaps (account_name, platform, month) VALUES ('Terni Generatcia', 'facebook', '2025-12');
-- Total: 38 rows.
