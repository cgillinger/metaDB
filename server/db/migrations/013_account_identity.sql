-- Migration 013: account_id on account_roster and import_accounts — gives the
-- roster a stable identity for accounts that get RENAMED at Meta. UNIQUE keys
-- stay on account_name (display name), but the import can now recognize that
-- an incoming (account_id, new name) is the same account as a historical
-- (account_id, old name) and merge the series instead of raising a false
-- missing-account alarm plus a parallel new series (the Radiokören →
-- Swedish Radio Choir case, 2026-09-04). See applyAccountRenames in
-- accountRoster.js.

ALTER TABLE account_roster ADD COLUMN account_id TEXT;
ALTER TABLE import_accounts ADD COLUMN account_id TEXT;

-- Backfill from posts, but only where (platform, account_name) maps to exactly
-- ONE distinct non-empty account_id — ambiguous names stay NULL rather than
-- guessing. Names never seen with an id (old exports) also stay NULL; they
-- simply cannot be rename-matched until an id shows up.
UPDATE account_roster SET account_id = (
  SELECT CASE WHEN COUNT(DISTINCT p.account_id) = 1 THEN MAX(p.account_id) END
  FROM posts p
  WHERE p.platform = account_roster.platform
    AND p.account_name = account_roster.account_name
    AND p.account_id IS NOT NULL AND p.account_id != ''
) WHERE account_id IS NULL;

UPDATE import_accounts SET account_id = (
  SELECT CASE WHEN COUNT(DISTINCT p.account_id) = 1 THEN MAX(p.account_id) END
  FROM posts p
  JOIN imports i ON i.id = import_accounts.import_id
  WHERE p.platform = i.platform
    AND p.account_name = import_accounts.account_name
    AND p.account_id IS NOT NULL AND p.account_id != ''
) WHERE account_id IS NULL;
