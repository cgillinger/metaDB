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
export const isYear = (s) => typeof s === 'string' && /^\d{4}$/.test(s) && s >= '2000' && s <= '2100';
export const FIRST_YEAR = 2014;

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

/** Latest display name seen in CT data; yearly rows count as ending in December. */
function latestCtName(db, platform, key) {
  const m = db.prepare(
    'SELECT account_name, month AS p FROM ct_monthly WHERE platform = ? AND account_key = ? ORDER BY month DESC LIMIT 1').get(platform, key);
  const y = db.prepare(
    "SELECT account_name, year || '-12' AS p FROM ct_yearly WHERE platform = ? AND account_key = ? ORDER BY year DESC LIMIT 1").get(platform, key);
  if (m && (!y || m.p >= y.p)) return m.account_name;
  return y ? y.account_name : null;
}

/**
 * Accounts that have CT data (monthly and/or yearly), with display name, CT spans
 * and metaDB link. first_month/last_month/ct_months describe ct_monthly only
 * (null/0 for accounts that exist only in the yearly table); first_year/last_year
 * span both tables.
 */
export function listAccounts(db, platform) {
  const names = metadbNames(db, platform);
  const hidden = hiddenSet(db, platform);
  const monthly = new Map(db.prepare(`
    SELECT account_key, MIN(month) AS first_month, MAX(month) AS last_month, COUNT(*) AS months
    FROM ct_monthly WHERE platform = ? GROUP BY account_key`).all(platform).map(r => [r.account_key, r]));
  const yearly = new Map(db.prepare(`
    SELECT account_key, MIN(year) AS first_year, MAX(year) AS last_year, COUNT(*) AS years
    FROM ct_yearly WHERE platform = ? GROUP BY account_key`).all(platform).map(r => [r.account_key, r]));
  const out = [];
  for (const key of new Set([...monthly.keys(), ...yearly.keys()])) {
    const m = monthly.get(key), y = yearly.get(key);
    const linked = names.get(key);
    const name = linked || latestCtName(db, platform, key);
    if (hidden.has(name)) continue;
    const firstYear = [m?.first_month.slice(0, 4), y?.first_year].filter(Boolean).sort()[0];
    const lastYear = [m?.last_month.slice(0, 4), y?.last_year].filter(Boolean).sort().at(-1);
    out.push({
      account_key: key, account_name: name,
      first_month: m?.first_month ?? null, last_month: m?.last_month ?? null, ct_months: m?.months ?? 0,
      first_year: Number(firstYear), last_year: Number(lastYear), ct_years: y?.years ?? 0,
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

  // The CT key only identifies the account; the metaDB side is fetched by account
  // name. Meta moved most FB pages to a new page id mid-2024 (new Pages
  // experience), so matching posts on account_id would end every curve there.
  // The importer keeps one series per account name across that id switch.
  const keyByName = new Map();
  for (const key of keys) {
    const n = names.get(key);
    if (n && !keyByName.has(n)) keyByName.set(n, key);
  }
  const linkedNames = [...keyByName.keys()];
  const metaRows = platform === 'twitter' || !linkedNames.length ? [] : db.prepare(`
    SELECT account_name, substr(publish_time, 1, 7) AS month, ${spec.metadbExpr[platform]} AS value
    FROM posts
    WHERE platform = ? AND account_name IN (${linkedNames.map(() => '?').join(',')})
      AND publish_time IS NOT NULL
    GROUP BY account_name, month`).all(platform, ...linkedNames);

  const ct = {}, meta = {}, ctName = {};
  for (const r of ctRows) {
    (ct[r.account_key] ??= {});
    if (r.value !== null) ct[r.account_key][r.month] = r.value;
    ctName[r.account_key] = r.account_name; // rows are month-ordered: last wins
  }
  for (const r of metaRows) (meta[keyByName.get(r.account_name)] ??= {})[r.month] = r.value;

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
    // CT is closed-ended (no later backfill), so the switch is simply the first
    // metaDB month after a CT month. spliceAccountSeries anchors its marker on the
    // trailing gap-free metaDB run instead, which drops the marker whenever an
    // account misses a later export month.
    let breakpoint = null;
    for (let i = 1; i < s.data.length && !breakpoint; i++) {
      if (s.data[i].source === 'viewers' && s.data.slice(0, i).some(d => d.source === 'legacy')) breakpoint = axis[i];
    }
    series.push({
      account_key: key, account_name: name,
      data: s.data.map(d => ({ value: d.value, source: label(d.source), ghost: d.ghost })),
      breakpoint_month: breakpoint,
      splice_status: s.splice_status === 'legacy_only' ? 'crowdtangle_only'
        : s.splice_status === 'viewers_only' ? 'metadb_only' : s.splice_status,
      overlap_months: s.overlap_months,
    });
  }
  series.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
  return { months: axis, series };
}

/**
 * Yearly series, one source per account and year (never summed across sources,
 * never scaled). Priority:
 *   1. metadb             — year is a full metaDB year for the platform and the
 *                           account has posts that year (current year = year to date, partial)
 *   2. crowdtangle_months — all 12 ct_monthly months present (never fewer)
 *   3. crowdtangle_year   — full-year CT export (ct_yearly)
 *   4. null               — gap
 * The metaDB side is matched by account name, as in buildSeries (FB page-id switch).
 * @param {object} p {platform, metric, accounts: string[], fromYear?, toYear?, currentYear?}
 */
export function buildYearlySeries(db, { platform, metric, accounts, fromYear, toYear, currentYear = new Date().getFullYear() }) {
  const spec = METRICS[metric];
  const names = metadbNames(db, platform);
  const hidden = hiddenSet(db, platform);
  const keys = [...new Set(accounts)].slice(0, MAX_ACCOUNTS);
  const lo = Number(fromYear || FIRST_YEAR), hi = Number(toYear || currentYear);
  if (!keys.length || lo > hi) return { years: [], series: [] };
  const years = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const ph = keys.map(() => '?').join(',');

  const ctCol = spec.ctColumn; // whitelisted literal
  const monthRows = db.prepare(`
    SELECT account_key, account_name, month, ${ctCol} AS value
    FROM ct_monthly WHERE platform = ? AND account_key IN (${ph}) ORDER BY month`).all(platform, ...keys);
  const yearRows = db.prepare(`
    SELECT account_key, account_name, year, ${ctCol} AS value
    FROM ct_yearly WHERE platform = ? AND account_key IN (${ph}) ORDER BY year`).all(platform, ...keys);

  // First metaDB month for the platform decides which years are full metaDB years.
  const earliest = platform === 'twitter' ? null : db.prepare(
    'SELECT MIN(substr(publish_time, 1, 7)) AS m FROM posts WHERE platform = ? AND publish_time IS NOT NULL').get(platform).m;
  const fullMetadbYear = (y) => !!earliest && earliest <= `${y}-01`;

  const keyByName = new Map();
  for (const key of keys) {
    const n = names.get(key);
    if (n && !keyByName.has(n)) keyByName.set(n, key);
  }
  const linkedNames = [...keyByName.keys()];
  const metaRows = !earliest || !linkedNames.length ? [] : db.prepare(`
    SELECT account_name, substr(publish_time, 1, 4) AS year, ${spec.metadbExpr[platform]} AS value
    FROM posts
    WHERE platform = ? AND account_name IN (${linkedNames.map(() => '?').join(',')})
      AND publish_time IS NOT NULL
    GROUP BY account_name, year`).all(platform, ...linkedNames);

  const meta = {}, months = {}, yearly = {}, ctName = {};
  for (const r of metaRows) (meta[keyByName.get(r.account_name)] ??= {})[r.year] = r.value;
  for (const r of monthRows) {
    const k = (months[r.account_key] ??= {});
    const y = r.month.slice(0, 4);
    (k[y] ??= { n: 0, sum: 0 });
    if (r.value !== null) { k[y].n++; k[y].sum += r.value; }
    ctName[r.account_key] = { p: r.month, name: r.account_name };
  }
  for (const r of yearRows) {
    if (r.value !== null) (yearly[r.account_key] ??= {})[r.year] = r.value;
    const p = `${r.year}-12`;
    if (!ctName[r.account_key] || ctName[r.account_key].p < p) ctName[r.account_key] = { p, name: r.account_name };
  }

  const series = [];
  for (const key of keys) {
    if (!meta[key] && !months[key] && !yearly[key] && !ctName[key]) continue;
    const name = names.get(key) || ctName[key]?.name || key;
    if (hidden.has(name)) continue;
    const data = years.map((y) => {
      const ys = String(y);
      if (fullMetadbYear(y) && meta[key]?.[ys] !== undefined) {
        return { value: meta[key][ys], source: 'metadb', partial: y === currentYear };
      }
      const m = months[key]?.[ys];
      if (m && m.n === 12) return { value: m.sum, source: 'crowdtangle_months', partial: false };
      const v = yearly[key]?.[ys];
      if (v !== undefined) return { value: v, source: 'crowdtangle_year', partial: false };
      return { value: null, source: null, partial: false };
    });
    let breakpointYear = null;
    for (let i = 1; i < data.length && breakpointYear === null; i++) {
      if (data[i].source === 'metadb' && data.slice(0, i).some(d => d.source && d.source !== 'metadb')) breakpointYear = years[i];
    }
    series.push({ account_key: key, account_name: name, data, breakpoint_year: breakpointYear });
  }
  series.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
  return { years, series };
}
