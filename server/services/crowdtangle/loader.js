import { nfc } from '../../utils/normalizeName.js';

const BASE_COLS = ['platform', 'account_key', 'account_name'];
const VALUE_COLS = ['interactions', 'likes', 'comments',
  'shares', 'posts', 'video_views', 'followers', 'source_list', 'source_filename', 'exported_at', 'export_date_source'];
const TABLES = {
  month: { table: 'ct_monthly', periodCol: 'month', migration: '015' },
  year: { table: 'ct_yearly', periodCol: 'year', migration: '016' },
};

/** Throws a clear error when the migration for this period's table has not run. */
export function assertCtTable(db, period = 'month') {
  const { table, migration } = TABLES[period];
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!t) throw new Error(`Tabellen ${table} saknas — starta appen en gång så att migration ${migration} körs, och försök igen.`);
}

/**
 * Upsert rows in ONE transaction. Rows with `year` go to ct_yearly, rows with
 * `month` to ct_monthly.
 * @returns {{inserted: number, updated: number}}
 */
export function loadRows(db, rows, { dryRun = false } = {}) {
  const periods = [...new Set(rows.map(r => (r.year ? 'year' : 'month')))];
  if (!periods.length) periods.push('month');
  for (const p of periods) assertCtTable(db, p);

  const stmts = {};
  for (const p of periods) {
    const { table, periodCol } = TABLES[p];
    const cols = [...BASE_COLS, periodCol, ...VALUE_COLS];
    stmts[p] = {
      cols, periodCol,
      exists: db.prepare(`SELECT 1 FROM ${table} WHERE platform = ? AND account_key = ? AND ${periodCol} = ?`),
      upsert: db.prepare(`
        INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})
        ON CONFLICT (platform, account_key, ${periodCol}) DO UPDATE SET
          ${cols.slice(2).filter(c => c !== periodCol).map(c => `${c} = excluded.${c}`).join(',\n          ')},
          imported_at = datetime('now')`),
    };
  }
  let inserted = 0, updated = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      const s = stmts[r.year ? 'year' : 'month'];
      const row = Object.fromEntries(s.cols.map(c => [c, r[c] ?? null]));
      row.account_name = nfc(row.account_name);
      if (s.exists.get(row.platform, row.account_key, row[s.periodCol])) updated++; else inserted++;
      s.upsert.run(row);
    }
    if (dryRun) throw new Error('__dry_run__');
  });
  try { run(); } catch (e) { if (e.message !== '__dry_run__') throw e; }
  return { inserted, updated };
}
