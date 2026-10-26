/**
 * crowdtangle/series.js — read side of the "Legacy CrowdTangle" tab.
 *
 * CT monthly totals (table ct_monthly) are visually spliced with metaDB's own
 * post data using spliceAccountSeries (CT = "legacy", metaDB = "new"; metaDB
 * wins where present). Values are raw and never scaled or summed together.
 * Nothing here is read by any other metric, total, group or export.
 */
import { spliceAccountSeries } from '../trend/spliceViewers.js';

export const PLATFORMS = ['facebook', 'instagram', 'twitter'];
// Whitelist: metric → CT column and metaDB SQL expression per platform.
// Only these literals are ever interpolated into SQL.
export const METRICS = {
  interactions: {
    ctColumn: 'interactions',
    metadbExpr: {
      facebook: 'COALESCE(SUM(interactions), 0)',
      // CT Instagram has no shares: keep the metaDB side comparable (likes + comments).
      instagram: 'COALESCE(SUM(COALESCE(likes, 0) + COALESCE(comments, 0)), 0)',
    },
  },
  posts: {
    ctColumn: 'posts',
    metadbExpr: { facebook: 'COUNT(*)', instagram: 'COUNT(*)' },
  },
};
export const MAX_ACCOUNTS = 60;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (s) => typeof s === 'string' && MONTH_RE.test(s);

export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** metaDB identity: key → latest display name (FB by account_id, IG by lowercase username). */
function metadbNames(db, platform) {
  if (platform === 'twitter') return new Map();
  const keyExpr = platform === 'facebook' ? 'account_id' : 'lower(account_username)';
  const rows = db.prepare(`
    SELECT ${keyExpr} AS k, account_name, MAX(publish_time) AS last_seen
    FROM posts
    WHERE platform = ? AND ${keyExpr} IS NOT NULL AND ${keyExpr} != ''
    GROUP BY ${keyExpr}`).all(platform);
  return new Map(rows.map(r => [r.k, r.account_name]));
}

function hiddenSet(db, platform) {
  return new Set(db.prepare('SELECT account_name FROM hidden_accounts WHERE platform = ?').all(platform).map(r => r.account_name));
}

/** Accounts that have CT data, with display name, CT span and metaDB link. */
export function listAccounts(db, platform) {
  const names = metadbNames(db, platform);
  const hidden = hiddenSet(db, platform);
  const rows = db.prepare(`
    SELECT account_key, MIN(month) AS first_month, MAX(month) AS last_month, COUNT(*) AS months
    FROM ct_monthly WHERE platform = ? GROUP BY account_key`).all(platform);
  const latestName = db.prepare(
    'SELECT account_name FROM ct_monthly WHERE platform = ? AND account_key = ? ORDER BY month DESC LIMIT 1');
  const out = [];
  for (const r of rows) {
    const linked = names.get(r.account_key);
    const name = linked || latestName.get(platform, r.account_key).account_name;
    if (hidden.has(name)) continue;
    out.push({
      account_key: r.account_key, account_name: name,
      first_month: r.first_month, last_month: r.last_month, ct_months: r.months,
      has_metadb: !!linked,
    });
  }
  return out.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
}

/**
 * @param {object} p {platform, metric, accounts: string[], from?, to?}
 */
export function buildSeries(db, { platform, metric, accounts, from, to }) {
  const spec = METRICS[metric];
  const names = metadbNames(db, platform);
  const hidden = hiddenSet(db, platform);
  const keys = [...new Set(accounts)].slice(0, MAX_ACCOUNTS);
  if (!keys.length) return { months: [], series: [] };
  const ph = keys.map(() => '?').join(',');

  const ctRows = db.prepare(`
    SELECT account_key, account_name, month, ${spec.ctColumn} AS value
    FROM ct_monthly WHERE platform = ? AND account_key IN (${ph}) ORDER BY month`).all(platform, ...keys);

  const metaRows = platform === 'twitter' ? [] : db.prepare(`
    SELECT ${platform === 'facebook' ? 'account_id' : 'lower(account_username)'} AS k,
           substr(publish_time, 1, 7) AS month, ${spec.metadbExpr[platform]} AS value
    FROM posts
    WHERE platform = ? AND ${platform === 'facebook' ? 'account_id' : 'lower(account_username)'} IN (${ph})
      AND publish_time IS NOT NULL
    GROUP BY k, month`).all(platform, ...keys);

  const ct = {}, meta = {}, ctName = {};
  for (const r of ctRows) {
    (ct[r.account_key] ??= {});
    if (r.value !== null) ct[r.account_key][r.month] = r.value;
    ctName[r.account_key] = r.account_name; // rows are month-ordered: last wins
  }
  for (const r of metaRows) (meta[r.k] ??= {})[r.month] = r.value;

  // Axis: requested span, else min..max over everything fetched.
  const all = [...Object.values(ct), ...Object.values(meta)].flatMap(o => Object.keys(o)).sort();
  const lo = from || all[0], hi = to || all[all.length - 1];
  if (!lo || !hi || lo > hi) return { months: [], series: [] };
  const axis = monthRange(lo, hi);

  const series = [];
  for (const key of keys) {
    if (!ct[key] && !meta[key]) continue;
    const name = names.get(key) || ctName[key] || key;
    if (hidden.has(name)) continue;
    const s = spliceAccountSeries(axis, ct[key], meta[key]);
    const label = (src) => (src === 'legacy' ? 'crowdtangle' : src === 'viewers' ? 'metadb' : null);
    series.push({
      account_key: key, account_name: name,
      data: s.data.map(d => ({ value: d.value, source: label(d.source), ghost: d.ghost })),
      breakpoint_month: s.breakpoint_month,
      splice_status: s.splice_status === 'legacy_only' ? 'crowdtangle_only'
        : s.splice_status === 'viewers_only' ? 'metadb_only' : s.splice_status,
      overlap_months: s.overlap_months,
    });
  }
  series.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
  return { months: axis, series };
}
