/**
 * tiktokOverviewImporter — import och fråga av TikTok-Översiktsdata (per dag/konto).
 *
 * Översikt-CSV:n innehåller en rad per dag med kontonivå-mätvärden (visningar, räckvidd,
 * profilvisningar, nya/tappade följare m.m.). Konto-identiteten finns INTE i filen —
 * användaren anger handle + display-namn vid uppladdning.
 *
 * Lagring: dagsupplösning i tiktok_account_daily. Månadsaggregat beräknas vid hämtning
 * (CLAUDE.md: råvärden lagras, beräkningar görs vid hämtning). UNIQUE(account_username, date)
 * ger per-dag UPSERT — "ny data vinner" vid återimport.
 *
 * Räckvidd (reach) är icke-summerbar över dagar/månader (överlapp) — ska hanteras som AVG.
 */
import Papa from 'papaparse';
import { getDb } from '../db/connection.js';
import {
  isTikTokOverviewCSV,
  getTikTokOverviewMappings,
  normalizeText,
} from '../../shared/columnConfig.js';

/**
 * Map one raw CSV row to internal field names. Handles SV+EN headers + trailing-whitespace
 * defekter i TikTok-export ("Telefonnummerklickar ", "Webbplatsklickar ").
 */
function mapRow(rawRow, mappings) {
  const out = {};
  for (const [origCol, value] of Object.entries(rawRow)) {
    const norm = normalizeText(origCol);
    for (const [mapKey, internal] of Object.entries(mappings)) {
      if (normalizeText(mapKey) === norm) {
        // First-non-empty-wins (same guard as csvProcessor.mapRow): an empty
        // duplicate SV/EN column must not overwrite an already mapped value.
        if (internal in out && out[internal] != null && out[internal] !== ''
            && (value == null || value === '')) {
          break;
        }
        out[internal] = value;
        break;
      }
    }
  }
  return out;
}

/**
 * Normalisera TikTok-datum "2026/04/01" → "2026-04-01".
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const safeInt = (v) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
};

/**
 * Parse + import en TikTok Översikt-CSV.
 *
 * @param {string} csvContent
 * @param {object} opts
 * @param {string} opts.accountUsername - handle (t.ex. "p3dingata"), obligatorisk
 * @param {string} [opts.accountName]   - display-namn (t.ex. "P3 Din Gata"); om tom används handlen
 * @param {string} [opts.filename]      - för audit
 * @returns {{ imported, skipped, month, account_username, account_name, days, netGrowthMismatches }}
 */
export function importTikTokOverviewCSV(csvContent, opts = {}) {
  const accountUsername = (opts.accountUsername || '').trim();
  if (!accountUsername) {
    throw new Error('account_username (handle) måste anges för TikTok Översikt-import.');
  }
  const accountName = (opts.accountName || '').trim() || accountUsername;

  const parsed = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!parsed.data || parsed.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(parsed.data[0]).map(h => h.trim());
  if (!isTikTokOverviewCSV(headers)) {
    throw new Error(
      'Filen är inte en TikTok Översikt-export. Förväntade kolumnerna "Datum", ' +
      '"Målgrupp som nåtts" och "Profilvisningar" (eller engelska motsvarigheter).'
    );
  }

  const mappings = getTikTokOverviewMappings();

  // Steg 1: parse alla rader, validera datum och samla månader
  const rows = [];
  const monthSet = new Set();
  let skipped = 0;
  let netGrowthMismatches = 0;

  for (const raw of parsed.data) {
    const mapped = mapRow(raw, mappings);
    const date = normalizeDate(mapped.date);
    if (!date) { skipped++; continue; }

    const month = date.slice(0, 7); // YYYY-MM
    monthSet.add(month);

    const newFollowers = safeInt(mapped.new_followers);
    const lostFollowers = safeInt(mapped.lost_followers);

    // Sanity-check: rådata-rubriken Nettotillväxt ska = nya − tappade. Vi lagrar inte
    // nettotillväxt (härleds vid hämtning) men flaggar diff för spårbarhet vid återimport.
    const rawNet = raw['Nettotillväxt'] ?? raw['Net growth'];
    if (rawNet !== undefined && rawNet !== null && rawNet !== '') {
      const expected = newFollowers - lostFollowers;
      if (safeInt(rawNet) !== expected) netGrowthMismatches++;
    }

    rows.push({
      date,
      month,
      video_views: safeInt(mapped.video_views),
      reach: safeInt(mapped.reach),
      profile_views: safeInt(mapped.profile_views),
      likes: safeInt(mapped.likes),
      shares: safeInt(mapped.shares),
      comments: safeInt(mapped.comments),
      new_followers: newFollowers,
      lost_followers: lostFollowers,
    });
  }

  if (rows.length === 0) {
    throw new Error('Inga giltiga rader (med datum) hittades.');
  }

  // Validera att alla rader ligger i samma månad (matchar reach-/IG-reach-mönstret).
  if (monthSet.size > 1) {
    const months = [...monthSet].sort();
    throw new Error(
      `CSV-filen innehåller data för flera månader: ${months.join(', ')}. ` +
      'Översikt-import förväntar sig en månad åt gången.'
    );
  }
  const month = [...monthSet][0];

  // Steg 2: UPSERT per (account_username, date) — ny data vinner
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO tiktok_account_daily (
      account_username, account_name, date, month,
      video_views, reach, profile_views, likes, shares, comments,
      new_followers, lost_followers, source_filename
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_username, date) DO UPDATE SET
      account_name = excluded.account_name,
      month = excluded.month,
      video_views = excluded.video_views,
      reach = excluded.reach,
      profile_views = excluded.profile_views,
      likes = excluded.likes,
      shares = excluded.shares,
      comments = excluded.comments,
      new_followers = excluded.new_followers,
      lost_followers = excluded.lost_followers,
      source_filename = excluded.source_filename,
      imported_at = datetime('now')
  `);

  let imported = 0;
  db.transaction(() => {
    for (const r of rows) {
      upsert.run(
        accountUsername, accountName, r.date, r.month,
        r.video_views, r.reach, r.profile_views, r.likes, r.shares, r.comments,
        r.new_followers, r.lost_followers, opts.filename || null
      );
      imported++;
    }
  })();

  return {
    imported,
    skipped,
    month,
    account_username: accountUsername,
    account_name: accountName,
    days: rows.length,
    netGrowthMismatches,
  };
}

/**
 * Hämta råa dagsrader för ett konto, valfritt filtrerat på månader.
 */
export function getTikTokOverviewDaily(accountUsername, months) {
  const db = getDb();
  const params = [accountUsername];
  let monthClause = '';
  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    monthClause = `AND month IN (${placeholders})`;
    params.push(...months);
  }
  return db.prepare(`
    SELECT date, month, video_views, reach, profile_views,
           likes, shares, comments, new_followers, lost_followers
    FROM tiktok_account_daily
    WHERE account_username = ? ${monthClause}
    ORDER BY date ASC
  `).all(...params);
}

/**
 * Returnera distinkta månader som har TikTok Översikt-data.
 */
export function getTikTokOverviewMonths() {
  const db = getDb();
  return db.prepare(
    'SELECT DISTINCT month FROM tiktok_account_daily ORDER BY month ASC'
  ).all().map(r => r.month);
}

/**
 * Distinkta konton (handle + senaste display-namn) med Översikt-data.
 */
export function getTikTokOverviewAccounts() {
  const db = getDb();
  return db.prepare(`
    SELECT account_username,
           (SELECT account_name FROM tiktok_account_daily t2
             WHERE t2.account_username = t.account_username
             ORDER BY imported_at DESC LIMIT 1) AS account_name,
           COUNT(DISTINCT month) AS month_count,
           COUNT(*) AS day_count
    FROM tiktok_account_daily t
    GROUP BY account_username
    ORDER BY account_username ASC
  `).all();
}

/**
 * Månadsaggregat per konto, valfritt filtrerat på månader.
 * Räckvidd levereras som AVG (icke-summerbar invariant) + dagligt max för spårbarhet.
 * Övriga fält summeras över dagarna inom månaden.
 * Engagement-formel (per dag, summerad): likes + comments + shares + new_followers.
 */
export function getTikTokOverviewMonthlySummary(months, dateRange = null) {
  const db = getDb();
  const params = [];
  const conditions = [];
  // A custom period (both bounds) takes priority over `months` — matching the
  // apiClient, which sends one or the other. ANDing them would intersect to an
  // empty result when the range and the months don't overlap.
  const hasRange = !!(dateRange?.dateFrom && dateRange?.dateTo);
  if (hasRange) {
    // Inclusive YYYY-MM-DD bounds on the daily rows, so a partial month
    // aggregates only the days inside the range.
    conditions.push('date >= ?');
    params.push(dateRange.dateFrom);
    conditions.push('date <= ?');
    params.push(dateRange.dateTo);
  } else if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    conditions.push(`month IN (${placeholders})`);
    params.push(...months);
  }
  const monthClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      account_username,
      (SELECT account_name FROM tiktok_account_daily t2
        WHERE t2.account_username = t.account_username
        ORDER BY imported_at DESC LIMIT 1) AS account_name,
      month,
      SUM(video_views) AS video_views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS avg_daily_reach,
      MAX(reach) AS peak_daily_reach,
      SUM(profile_views) AS profile_views,
      SUM(likes) AS likes,
      SUM(shares) AS shares,
      SUM(comments) AS comments,
      SUM(new_followers) AS new_followers,
      SUM(lost_followers) AS lost_followers,
      (SUM(new_followers) - SUM(lost_followers)) AS net_follower_growth,
      (SUM(likes) + SUM(comments) + SUM(shares)) AS interactions,
      (SUM(likes) + SUM(comments) + SUM(shares) + SUM(new_followers)) AS daily_engagement_sum,
      COUNT(*) AS day_count
    FROM tiktok_account_daily t
    ${monthClause}
    GROUP BY account_username, month
    ORDER BY account_username, month
  `).all(...params);
}

/**
 * Radera en månads Översikt-data (alla konton).
 */
export function deleteTikTokOverviewMonth(month) {
  const db = getDb();
  return db.prepare('DELETE FROM tiktok_account_daily WHERE month = ?').run(month);
}

/**
 * Radera en månads data för ett specifikt konto.
 */
export function deleteTikTokOverviewByAccount(accountUsername, month) {
  const db = getDb();
  return db.prepare(
    'DELETE FROM tiktok_account_daily WHERE account_username = ? AND month = ?'
  ).run(accountUsername, month);
}
