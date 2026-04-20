import { getDb } from '../db/connection.js';
import { hiddenPostsFilter, hiddenSiteVisitsFilter } from './hiddenAccounts.js';

/**
 * Manual overrides for account names that cannot be derived by suffix-stripping.
 * Key: Meta (posts) account_name → Value: GA (ga_site_visits) account_name
 */
const MANUAL_NAME_MAP = {
  'Nyheter från Sveriges Radio Ekot': 'Ekot',
  'SR Kultur': 'Kulturnytt',
};

/**
 * Normalize a Meta account name to match GA naming convention.
 * Strips ", Sveriges Radio" and " Sveriges Radio" suffixes.
 * Falls back to manual overrides for irregular names.
 *
 * IMPORTANT: This uses exact suffix matching, NOT substring/startsWith.
 * "P4 Västerbotten Sveriges Radio" → "P4 Västerbotten" (not "P4 Väst")
 * "P4 Väst, Sveriges Radio" → "P4 Väst" (correct)
 */
function normalizeMetaName(metaName) {
  if (!metaName) return '';

  if (MANUAL_NAME_MAP[metaName]) {
    return MANUAL_NAME_MAP[metaName];
  }

  return metaName
    .replace(/,\s*Sveriges Radio\s*$/i, '')
    .replace(/\s+Sveriges Radio\s*$/i, '')
    .trim();
}

export function getBesokVsLankklick(accountName, months) {
  const db = getDb();

  // accountName is the GA (short) name — find matching Meta name
  const metaRows = db.prepare(`
    SELECT DISTINCT account_name FROM posts
    WHERE platform = 'facebook'
      ${hiddenPostsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const metaName = metaRows.find(name => normalizeMetaName(name) === accountName);

  // Meta: months where a Facebook CSV was imported
  let metaImportedMonths;
  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    metaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM imports WHERE platform = 'facebook' AND month IN (${placeholders})`)
        .all(...months).map(r => r.month)
    );
  } else {
    metaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM imports WHERE platform = 'facebook'`)
        .all().map(r => r.month)
    );
  }

  // GA: months where any ga_site_visits data exists
  let gaImportedMonths;
  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    gaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM ga_site_visits WHERE month IN (${placeholders})`)
        .all(...months).map(r => r.month)
    );
  } else {
    gaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM ga_site_visits`)
        .all().map(r => r.month)
    );
  }

  // Only show months where BOTH sources have imports
  const bothImported = [...metaImportedMonths].filter(m => gaImportedMonths.has(m)).sort();

  if (bothImported.length === 0) return [];

  // Link clicks (may not have rows for every imported month)
  let linkClickRows = [];
  if (metaName) {
    const placeholders = bothImported.map(() => '?').join(',');
    linkClickRows = db.prepare(`
      SELECT strftime('%Y-%m', publish_time) AS month, SUM(link_clicks) AS lankklick
      FROM posts
      WHERE account_name = ?
        AND platform = 'facebook'
        AND strftime('%Y-%m', publish_time) IN (${placeholders})
        ${hiddenPostsFilter()}
      GROUP BY strftime('%Y-%m', publish_time)
    `).all(metaName, ...bothImported);
  }

  // Visits (may not have rows for every imported month)
  const visitPlaceholders = bothImported.map(() => '?').join(',');
  const visitRows = db.prepare(`
    SELECT month, visits AS besok
    FROM ga_site_visits
    WHERE account_name = ?
      AND month IN (${visitPlaceholders})
      ${hiddenSiteVisitsFilter()}
  `).all(accountName, ...bothImported);

  const linkClickMap = new Map(linkClickRows.map(r => [r.month, r.lankklick]));
  const visitMap = new Map(visitRows.map(r => [r.month, r.besok]));

  // Use 0 (not null) for months where data was imported but account has no rows
  return bothImported.map(month => ({
    month,
    seriesA: visitMap.get(month) ?? 0,
    seriesB: linkClickMap.get(month) ?? 0,
  }));
}

export function getComparisonAccounts() {
  const db = getDb();

  const metaRows = db.prepare(`
    SELECT DISTINCT account_name FROM posts
    WHERE platform = 'facebook'
      ${hiddenPostsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const gaNames = new Set(
    db.prepare(`
      SELECT DISTINCT account_name FROM ga_site_visits
      WHERE 1=1
        ${hiddenSiteVisitsFilter()}
    `).all().map(r => r.account_name).filter(Boolean)
  );

  const matched = new Set();
  for (const metaName of metaRows) {
    const normalized = normalizeMetaName(metaName);
    if (gaNames.has(normalized)) {
      matched.add(normalized);
    }
  }

  return [...matched].sort((a, b) => a.localeCompare(b, 'sv'));
}
