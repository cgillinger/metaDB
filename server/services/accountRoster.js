/**
 * accountRoster.js — CRUD for account_roster/account_gaps/import_accounts,
 * plus Jaccard-scoping of history and open gaps for the missingAccounts
 * detection. See TASK-account-roster.md. Pattern: hiddenAccounts.js.
 */
import { getDb } from '../db/connection.js';
import { jaccardSimilarity, findMissingAccounts } from './roster/missingAccounts.js';

const JACCARD_THRESHOLD = 0.5;
const DEFAULT_WINDOW = 6;
const DEFAULT_MIN_SEEN = 4;

// --- Roster CRUD -----------------------------------------------------------

/**
 * INSERT OR IGNORE a roster row for each account name in an import. Runs
 * inside the import transaction — new accounts show up as 'active' automatically.
 * @param {import('better-sqlite3').Database} db
 * @param {string[]} accountNames
 * @param {string} platform
 */
export function upsertRosterEntries(db, accountNames, platform) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO account_roster (account_name, platform) VALUES (?, ?)'
  );
  for (const name of accountNames) {
    if (name) stmt.run(name, platform);
  }
}

export function listRoster(platform) {
  const db = getDb();
  if (platform) {
    return db.prepare(
      'SELECT account_name, platform, status, retired_at, note, created_at FROM account_roster WHERE platform = ? ORDER BY account_name'
    ).all(platform);
  }
  return db.prepare(
    'SELECT account_name, platform, status, retired_at, note, created_at FROM account_roster ORDER BY platform, account_name'
  ).all();
}

export function retireAccount(accountName, platform, note = null) {
  const db = getDb();
  db.prepare(
    `INSERT INTO account_roster (account_name, platform, status, retired_at, note)
     VALUES (?, ?, 'retired', datetime('now'), ?)
     ON CONFLICT(account_name, platform) DO UPDATE SET
       status = 'retired', retired_at = datetime('now'), note = excluded.note`
  ).run(accountName, platform, note);
}

export function reactivateAccount(accountName, platform) {
  const db = getDb();
  db.prepare(
    `INSERT INTO account_roster (account_name, platform, status, retired_at)
     VALUES (?, ?, 'active', NULL)
     ON CONFLICT(account_name, platform) DO UPDATE SET
       status = 'active', retired_at = NULL`
  ).run(accountName, platform);
}

/** @returns {Set<string>} account names with status 'retired' for the platform. */
export function getRetiredNames(db, platform) {
  const rows = db.prepare(
    "SELECT account_name FROM account_roster WHERE platform = ? AND status = 'retired'"
  ).all(platform);
  return new Set(rows.map(r => r.account_name));
}

// --- import_accounts ---------------------------------------------------------

/**
 * INSERT OR IGNORE a row per account name in the incoming file. Runs inside
 * the import transaction.
 */
export function recordImportAccounts(db, importId, accountNames) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO import_accounts (import_id, account_name) VALUES (?, ?)'
  );
  for (const name of accountNames) {
    if (name) stmt.run(importId, name);
  }
}

// --- Jaccard-scoped history & open gaps ---------------------------------

/**
 * The most recent `window` imports of the same platform whose account list
 * (import_accounts) overlaps `importedNames` with Jaccard >= 0.5. Naturally
 * excludes the import in progress: it has no import_accounts rows yet when
 * this is called (see imports.js — history is read before the file's own
 * list is written), so its (empty) set never matches.
 * @returns {Array<{month: string, names: Set<string>}>}
 */
export function getScopedHistory(db, platform, importedNames, { window = DEFAULT_WINDOW } = {}) {
  const imports = db.prepare(
    'SELECT id, month FROM imports WHERE platform = ? ORDER BY imported_at DESC'
  ).all(platform);

  const namesStmt = db.prepare('SELECT account_name FROM import_accounts WHERE import_id = ?');
  const history = [];

  for (const imp of imports) {
    if (history.length >= window) break;
    const rows = namesStmt.all(imp.id);
    if (rows.length === 0) continue;
    const importNames = new Set(rows.map(r => r.account_name));
    if (jaccardSimilarity(importNames, importedNames) >= JACCARD_THRESHOLD) {
      history.push({ month: imp.month, names: importNames });
    }
  }

  return history;
}

/**
 * Account names with an unresolved row in account_gaps for the platform,
 * Jaccard-scoped against the current file.
 *
 * Two cases:
 * - Rows WITH import_id (registered by the import transaction) are scoped via
 *   their origin import: account_gaps.import_id → import_accounts.
 * - Rows WITHOUT import_id (the static 38-month seed, migration 011) have no
 *   origin import. Without special handling they would never be scoped in,
 *   and would therefore never be caught by the open-gap tracking — exactly
 *   the cases (e.g. Kvällspasset, Naturmorgon) that were gone so long they
 *   fall below the 4/6 threshold AND drop out of the Jaccard-matched history
 *   window, which reintroduces the original bug this rule exists to fix.
 *   These are instead scoped via the account's MOST RECENT appearance in
 *   import_accounts (the latest import where the account actually showed
 *   up) — migration 011's backfill guarantees every historical account
 *   appears there at least once. If no such appearance is found (shouldn't
 *   happen), the account is silently excluded.
 * @returns {Set<string>}
 */
export function getScopedOpenGapAccounts(db, platform, importedNames) {
  const rows = db.prepare(
    `SELECT DISTINCT account_name, import_id
     FROM account_gaps
     WHERE platform = ? AND resolved_at IS NULL`
  ).all(platform);

  if (rows.length === 0) return new Set();

  const namesStmt = db.prepare('SELECT account_name FROM import_accounts WHERE import_id = ?');
  const latestImportForAccountStmt = db.prepare(`
    SELECT ia.import_id
    FROM import_accounts ia
    JOIN imports i ON i.id = ia.import_id
    WHERE ia.account_name = ?
    ORDER BY i.imported_at DESC
    LIMIT 1
  `);
  const originNamesByImport = new Map();
  const result = new Set();

  for (const row of rows) {
    let originImportId = row.import_id;
    if (originImportId === null) {
      const latest = latestImportForAccountStmt.get(row.account_name);
      if (!latest) continue; // never seen in import_accounts — exclude silently
      originImportId = latest.import_id;
    }

    if (!originNamesByImport.has(originImportId)) {
      const originRows = namesStmt.all(originImportId);
      originNamesByImport.set(originImportId, new Set(originRows.map(r => r.account_name)));
    }
    const originNames = originNamesByImport.get(originImportId);
    if (originNames.size > 0 && jaccardSimilarity(originNames, importedNames) >= JACCARD_THRESHOLD) {
      result.add(row.account_name);
    }
  }

  return result;
}

// --- account_gaps: registration & auto-resolve -----------------------------

/**
 * Registers one unresolved gap per flagged account. INSERT OR IGNORE — an
 * already-open gap for the same (account, platform, month) is left untouched.
 */
export function registerGaps(db, platform, month, importId, missingAccounts) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO account_gaps (account_name, platform, month, import_id)
     VALUES (?, ?, ?, ?)`
  );
  for (const m of missingAccounts) {
    stmt.run(m.account_name, platform, month, importId);
  }
}

/**
 * Closes gaps for (account, month) pairs that actually occur in this
 * import's posts — read per post (strftime on publish_time), not the file's
 * single parsed.month, so a targeted single-account backfill of a specific
 * month closes the right gap even if the file happens to contain a stray
 * post from another month.
 * @returns {number} number of gaps closed
 */
export function autoResolveGaps(db, platform, importId) {
  const rows = db.prepare(
    `SELECT DISTINCT account_name, strftime('%Y-%m', publish_time) AS month
     FROM posts
     WHERE import_id = ? AND publish_time IS NOT NULL AND account_name IS NOT NULL`
  ).all(importId);

  const stmt = db.prepare(
    `UPDATE account_gaps SET resolved_at = datetime('now'), resolution = 'imported'
     WHERE account_name = ? AND platform = ? AND month = ? AND resolved_at IS NULL`
  );

  let resolved = 0;
  for (const row of rows) {
    if (!row.month) continue;
    const info = stmt.run(row.account_name, platform, row.month);
    resolved += info.changes;
  }
  return resolved;
}

/**
 * Manually dismisses one (account, platform, month) gap because the account
 * genuinely published nothing that month — not a real gap. Only touches an
 * unresolved row; already-resolved rows (either path) are left untouched.
 * Does not affect account_gaps registration: registerGaps still uses
 * INSERT OR IGNORE against UNIQUE(account_name, platform, month), so a
 * dismissed row is never re-created by a later import.
 * @returns {number} rows changed (0 or 1)
 */
export function dismissGapMonth(accountName, platform, month) {
  const db = getDb();
  const info = db.prepare(
    `UPDATE account_gaps SET resolved_at = datetime('now'), resolution = 'no_posts'
     WHERE account_name = ? AND platform = ? AND month = ? AND resolved_at IS NULL`
  ).run(accountName, platform, month);
  return info.changes;
}

/**
 * Reopens a gap previously dismissed via dismissGapMonth ("Ångra"). Only
 * touches rows with resolution = 'no_posts' — an 'imported' row (closed by
 * an actual import) is never reopened by this, by design.
 * @returns {number} rows changed (0 or 1)
 */
export function reopenGapMonth(accountName, platform, month) {
  const db = getDb();
  const info = db.prepare(
    `UPDATE account_gaps SET resolved_at = NULL, resolution = NULL
     WHERE account_name = ? AND platform = ? AND month = ? AND resolution = 'no_posts'`
  ).run(accountName, platform, month);
  return info.changes;
}

// --- Composite: an import's full roster handling ---------------------------

/**
 * Runs the whole roster flow for an import: history, open gaps, detection,
 * registering new gaps, auto-resolving closed ones. Called from imports.js
 * INSIDE the import transaction, after the posts have been written (so
 * auto-resolve can see this import's rows). History and open gaps are read
 * BEFORE this file's own account_roster/import_accounts rows are written
 * (see the comment inline below) so the file never matches itself; auto-resolve
 * then runs after posts are written so it can see this import's rows.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} platform
 * @param {string} month - parsed.month, the file's canonical reporting month.
 * @param {number} importId
 * @param {string[]} accountNames - account names in the incoming file.
 * @returns {{ missingAccounts: Array, gapsRegistered: number, gapsAutoResolved: number }}
 */
export function processImportRoster(db, platform, month, importId, accountNames) {
  const importedNames = new Set(accountNames.filter(Boolean));

  // History and open gaps are read BEFORE this import is written to
  // account_roster/import_accounts, so it never matches itself.
  const history = getScopedHistory(db, platform, importedNames, { window: DEFAULT_WINDOW });
  const openGapAccounts = getScopedOpenGapAccounts(db, platform, importedNames);
  const retired = getRetiredNames(db, platform);

  upsertRosterEntries(db, [...importedNames], platform);
  recordImportAccounts(db, importId, [...importedNames]);

  const missingAccounts = findMissingAccounts({
    importedNames,
    history,
    retired,
    openGapAccounts,
    window: DEFAULT_WINDOW,
    minSeen: DEFAULT_MIN_SEEN,
  });

  if (missingAccounts.length > 0) {
    registerGaps(db, platform, month, importId, missingAccounts);
  }
  const gapsAutoResolved = autoResolveGaps(db, platform, importId);

  return { missingAccounts, gapsRegistered: missingAccounts.length, gapsAutoResolved };
}

// --- Open gaps for the UI (the "Öppna luckor" card) ----------------------------

/** Reach table per platform — facebook and instagram only; other platforms have none. */
const REACH_TABLE_BY_PLATFORM = {
  facebook: 'account_reach',
  instagram: 'ig_account_reach',
};

/**
 * Sum of monthly reach for one account's gap months, plus how many of those
 * months actually had reach data (account_reach is frozen through 2026-05,
 * so many recent gap months contribute 0 known). Used as a prioritization
 * measure — summing different months' audiences, not the same-month
 * SUM-vs-AVG reach rule (CLAUDE.md) that applies within a single month.
 * @returns {{ gap_reach: number, gap_reach_known: number }}
 */
function sumGapReach(db, accountName, platform, months) {
  const table = REACH_TABLE_BY_PLATFORM[platform];
  if (!table || months.length === 0) return { gap_reach: 0, gap_reach_known: 0 };

  const placeholders = months.map(() => '?').join(', ');
  const rows = db.prepare(
    `SELECT reach FROM ${table} WHERE account_name = ? AND month IN (${placeholders})`
  ).all(accountName, ...months);

  const gap_reach = rows.reduce((sum, r) => sum + (r.reach || 0), 0);
  return { gap_reach, gap_reach_known: rows.length };
}

/**
 * Unresolved gaps, grouped per account, with retired accounts filtered out
 * (join against roster status — the row in account_gaps is never deleted).
 * Each account also carries gap_reach (sum of reach across its unresolved
 * gap months, for client-side sorting by "störst räckvidd i luckorna") and
 * gap_reach_known (how many of those months had reach data at all — always
 * <= months.length; account_reach is frozen through 2026-05 so many recent
 * months contribute 0/unknown). Sorting itself happens client-side.
 * @param {string} [platform]
 * @returns {Array<{account_name: string, platform: string, months: string[], gap_reach: number, gap_reach_known: number}>}
 */
export function listOpenGaps(platform) {
  const db = getDb();
  const conditions = ['ag.resolved_at IS NULL', "(ar.status IS NULL OR ar.status != 'retired')"];
  const params = [];
  if (platform) {
    conditions.push('ag.platform = ?');
    params.push(platform);
  }
  const rows = db.prepare(`
    SELECT ag.account_name, ag.platform, ag.month
    FROM account_gaps ag
    LEFT JOIN account_roster ar
      ON ar.account_name = ag.account_name AND ar.platform = ag.platform
    WHERE ${conditions.join(' AND ')}
    ORDER BY ag.account_name, ag.month
  `).all(...params);

  const byAccount = new Map();
  for (const row of rows) {
    const key = `${row.account_name}::${row.platform}`;
    if (!byAccount.has(key)) {
      byAccount.set(key, { account_name: row.account_name, platform: row.platform, months: [] });
    }
    byAccount.get(key).months.push(row.month);
  }

  return [...byAccount.values()].map(entry => ({
    ...entry,
    ...sumGapReach(db, entry.account_name, entry.platform, entry.months),
  }));
}
