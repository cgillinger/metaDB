import { nfc } from '../../utils/normalizeName.js';

const COLS = ['platform', 'account_key', 'account_name', 'month', 'interactions', 'likes', 'comments',
  'shares', 'posts', 'video_views', 'followers', 'source_list', 'source_filename', 'exported_at', 'export_date_source'];

/** Throws a clear error when migration 015 has not run on this database. */
export function assertCtTable(db) {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ct_monthly'").get();
  if (!t) throw new Error('Tabellen ct_monthly saknas — starta appen en gång så att migration 015 körs, och försök igen.');
}

/**
 * Upsert rows into ct_monthly in ONE transaction.
 * @returns {{inserted: number, updated: number}}
 */
export function loadRows(db, rows, { dryRun = false } = {}) {
  assertCtTable(db);
  const exists = db.prepare('SELECT 1 FROM ct_monthly WHERE platform = ? AND account_key = ? AND month = ?');
  const upsert = db.prepare(`
    INSERT INTO ct_monthly (${COLS.join(', ')}) VALUES (${COLS.map(c => '@' + c).join(', ')})
    ON CONFLICT (platform, account_key, month) DO UPDATE SET
      ${COLS.slice(2).filter(c => c !== 'month').map(c => `${c} = excluded.${c}`).join(',\n      ')},
      imported_at = datetime('now')`);
  let inserted = 0, updated = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      const row = Object.fromEntries(COLS.map(c => [c, r[c] ?? null]));
      row.account_name = nfc(row.account_name);
      if (exists.get(row.platform, row.account_key, row.month)) updated++; else inserted++;
      upsert.run(row);
    }
    if (dryRun) throw new Error('__dry_run__');
  });
  try { run(); } catch (e) { if (e.message !== '__dry_run__') throw e; }
  return { inserted, updated };
}
