-- Migration 014: normalize account names to Unicode NFC. Meta's Instagram
-- exports deliver NFD ("a" + U+0308) while Facebook/GA deliver NFC, so the
-- same account looked identical but never matched in SQL/JS comparisons.
-- Imports normalize from now on (server/utils/normalizeName.js); this fixes
-- the rows already stored. nfc() is registered on the connection in
-- connection.js (SQLite has no NFC function of its own).
--
-- Collision-safe: if normalizing would make two rows share a UNIQUE key (an
-- NFC twin already exists, or two variants fold together), the guard below
-- fails with "CHECK constraint failed: nfc_collision_found" and the whole
-- migration rolls back. Nothing is merged or deleted silently.

CREATE TEMP TABLE _nfc_guard (
  tbl TEXT,
  n INTEGER CONSTRAINT nfc_collision_found CHECK (n = 0)
);

INSERT INTO _nfc_guard (tbl, n) SELECT 'ig_account_reach', COUNT(*) FROM (
  SELECT 1 FROM ig_account_reach GROUP BY nfc(account_name), month HAVING COUNT(*) > 1);
INSERT INTO _nfc_guard (tbl, n) SELECT 'account_roster', COUNT(*) FROM (
  SELECT 1 FROM account_roster GROUP BY nfc(account_name), platform HAVING COUNT(*) > 1);
INSERT INTO _nfc_guard (tbl, n) SELECT 'account_gaps', COUNT(*) FROM (
  SELECT 1 FROM account_gaps GROUP BY nfc(account_name), platform, month HAVING COUNT(*) > 1);
INSERT INTO _nfc_guard (tbl, n) SELECT 'hidden_accounts', COUNT(*) FROM (
  SELECT 1 FROM hidden_accounts GROUP BY nfc(account_name), platform HAVING COUNT(*) > 1);
INSERT INTO _nfc_guard (tbl, n) SELECT 'import_accounts', COUNT(*) FROM (
  SELECT 1 FROM import_accounts GROUP BY import_id, nfc(account_name) HAVING COUNT(*) > 1);

DROP TABLE _nfc_guard;

UPDATE posts             SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
UPDATE ig_account_reach  SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
UPDATE import_accounts   SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
UPDATE account_roster    SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
UPDATE hidden_accounts   SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
UPDATE account_gaps      SET account_name = nfc(account_name) WHERE account_name <> nfc(account_name);
