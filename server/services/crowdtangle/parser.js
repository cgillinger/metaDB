/**
 * crowdtangle/parser.js — pure parsing of CrowdTangle "leaderboard" exports.
 * No I/O here: filename → meta, csv text → normalized rows, selection/dedupe.
 */
import { nfc } from '../../utils/normalizeName.js';

const ALLOWED_LISTS = new Set(['Sveriges-Radio', 'P4-Lokalkanaler']);
// Local-zone UTC offsets (hours) as written in CrowdTangle filenames.
const ZONE_OFFSET = { CET: 1, CEST: 2, EET: 2, EEST: 3 };

const NAME_RE = /(facebook|instagram|twitter)_leaderboard_(.+?)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_([A-Z]+)[-_](\d{4})-(\d{2})-(\d{2})_/;
const PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-([A-Z]+)-(?:facebook|instagram|twitter)_leaderboard_/;

const pad = (n) => String(n).padStart(2, '0');
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Parse a leaderboard filename (basename).
 * Periods: one calendar month ('month') or one full calendar year ('year').
 * @returns {{ok: true, platform, list, period, month|year, exportedAt: string|null, exportDateSource: 'filename'|null}
 *          | {ok: false, reason: string}}
 */
export function parseFilename(basename) {
  const m = NAME_RE.exec(basename);
  if (!m) return { ok: false, reason: 'not_leaderboard_name' };
  const [, platform, rawList, sy, sm, sd, , , , , ey, em, ed] = m;
  const list = rawList.replace(/_/g, '-');
  if (!ALLOWED_LISTS.has(list)) return { ok: false, reason: 'excluded_list' };
  const [Y, M, D, EY, EM, ED] = [sy, sm, sd, ey, em, ed].map(Number);
  const isMonth = sd === '01' && Y === EY && M === EM && ED === lastDayOfMonth(EY, EM);
  const isYear = sm === '01' && sd === '01' && Y === EY && em === '12' && ed === '31';
  if (!isMonth && !isYear) return { ok: false, reason: 'not_one_month' };

  let exportedAt = null;
  const p = PREFIX_RE.exec(basename);
  if (p) {
    const [y, mo, d, h, mi, s] = p.slice(1, 7).map(Number);
    const off = ZONE_OFFSET[p[7]] ?? 1;
    exportedAt = new Date(Date.UTC(y, mo - 1, d, h - off, mi, s)).toISOString();
  }
  return {
    ok: true, platform, list,
    period: isYear ? 'year' : 'month',
    ...(isYear ? { year: sy } : { month: `${sy}-${sm}` }),
    exportedAt, exportDateSource: exportedAt ? 'filename' : null,
  };
}

/** Split CSV text into records, honouring quotes. Separator auto-detected from the header. */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  let q = false, commas = 0, semis = 0;
  for (const ch of firstLine) {
    if (ch === '"') q = !q;
    else if (!q && ch === ',') commas++;
    else if (!q && ch === ';') semis++;
  }
  const sep = semis > commas ? ';' : ',';
  const records = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) records.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) records.push(row);
  return records;
}

/** "287,537" → 287537, "3.22%" → null (not an integer count), "--"/"" → null. */
export function parseCount(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (s === '' || s === '--' || s.includes('%')) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Account key from URL (FB id/slug, IG handle) or handle (Twitter). */
export function accountKey(platform, url, handle) {
  const u = (url || '').trim();
  if (platform === 'facebook') {
    const m = /facebook\.com\/(?:pages\/[^/]+\/)?(?:profile\.php\?id=)?([^/?#]+)/i.exec(u);
    return m ? m[1] : null;
  }
  if (platform === 'instagram') {
    const m = /instagram\.com\/([^/?#]+)/i.exec(u);
    return m ? m[1].toLowerCase() : null;
  }
  const h = (handle || '').trim().replace(/^@/, '');
  if (h) return h.toLowerCase();
  const m = /twitter\.com\/([^/?#]+)/i.exec(u);
  return m ? m[1].toLowerCase() : null;
}

// Header aliases per field, matched case-insensitively; first present wins.
const FIELDS = {
  interactions: ['Total Interactions'],
  likes: ['Likes'],
  comments: ['Comments'],
  shares: ['Shares', 'Retweets'],
  posts: ['Total Posts', 'Total Tweets'],
  video_views: ['Owned Total Views', 'Views'],
  followers: ['Page Followers', 'Followers'],
};

/**
 * Parse one CSV file into normalized rows (one per account).
 * @param {string} text
 * @param {'facebook'|'instagram'|'twitter'} platform
 * @returns {Array<object>} rows without file provenance
 */
export function parseLeaderboard(text, platform) {
  const records = parseCsv(text);
  if (records.length < 2) return [];
  const header = records[0].map(h => h.trim().toLowerCase());
  const idx = (names) => {
    for (const n of names) { const i = header.indexOf(n.toLowerCase()); if (i >= 0) return i; }
    return -1;
  };
  const col = Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, idx(v)]));
  const iUrl = idx(['URL']);
  const iHandle = platform === 'twitter' ? idx(['Handle']) : -1;
  if (iUrl < 0) return [];

  const rows = [];
  for (const rec of records.slice(1)) {
    const name = (rec[0] || '').trim();
    const url = (rec[iUrl] || '').trim();
    if (!name || !url || name.toLowerCase() === 'averages') continue;
    const key = accountKey(platform, url, iHandle >= 0 ? rec[iHandle] : '');
    if (!key) continue;
    const out = { platform, account_key: key, account_name: nfc(name) };
    for (const [field, i] of Object.entries(col)) {
      let v = i >= 0 ? parseCount(rec[i]) : null;
      if (field === 'posts' && i >= 0 && /no (posts|tweets)/i.test(rec[i] || '')) v = 0;
      out[field] = v;
    }
    rows.push(out);
  }
  return rows;
}

const periodKey = (c) => c.year ?? c.month;

function periodEndMs(c) {
  if (c.year) return Date.UTC(Number(c.year), 11, 31, 23, 59, 59);
  const [y, m] = c.month.split('-').map(Number);
  return Date.UTC(y, m - 1, lastDayOfMonth(y, m), 23, 59, 59);
}

/**
 * Pick ONE row per platform+account+period (month 'YYYY-MM' or year 'YYYY').
 * Candidates carry exported_at (ISO) and export_date_source ('filename' | 'mtime').
 * Rule: smallest exported_at at or after period end; if none, the latest.
 * mtime-dated candidates (may be a copy date) only compete when no
 * filename-dated candidate exists.
 */
export function selectRows(candidates) {
  const groups = new Map();
  for (const c of candidates) {
    const k = `${c.platform}|${c.account_key}|${periodKey(c)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const picked = [];
  for (const list of groups.values()) {
    const named = list.filter(c => c.export_date_source === 'filename');
    const pool = named.length ? named : list;
    const end = periodEndMs(pool[0]);
    const t = (c) => Date.parse(c.exported_at);
    const after = pool.filter(c => t(c) >= end).sort((a, b) => t(a) - t(b));
    const best = after.length ? after[0] : [...pool].sort((a, b) => t(b) - t(a))[0];
    picked.push(best);
  }
  return picked.sort((a, b) =>
    a.platform.localeCompare(b.platform) || periodKey(a).localeCompare(periodKey(b)) ||
    a.account_key.localeCompare(b.account_key));
}
