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

  // accountName is the GA (short) name, e.g. "P4 Halland"
  // Find the matching Meta name by normalizing all FB account names
  const metaRows = db.prepare(`
    SELECT DISTINCT account_name FROM posts
    WHERE platform = 'facebook'
      ${hiddenPostsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const metaName = metaRows.find(name => normalizeMetaName(name) === accountName);

  let linkClickRows = [];
  if (metaName) {
    let linkClickSQL = `
      SELECT strftime('%Y-%m', publish_time) AS month, SUM(link_clicks) AS lankklick
      FROM posts
      WHERE account_name = ?
        AND platform = 'facebook'
        ${hiddenPostsFilter()}
    `;
    const linkClickParams = [metaName];

    if (months && months.length > 0) {
      const placeholders = months.map(() => '?').join(',');
      linkClickSQL += ` AND strftime('%Y-%m', publish_time) IN (${placeholders})`;
      linkClickParams.push(...months);
    }

    linkClickSQL += ` GROUP BY strftime('%Y-%m', publish_time)`;
    linkClickRows = db.prepare(linkClickSQL).all(...linkClickParams);
  }

  let visitSQL = `
    SELECT month, visits AS besok
    FROM ga_site_visits
    WHERE account_name = ?
      ${hiddenSiteVisitsFilter()}
  `;
  const visitParams = [accountName];

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    visitSQL += ` AND month IN (${placeholders})`;
    visitParams.push(...months);
  }

  const visitRows = db.prepare(visitSQL).all(...visitParams);

  const linkClickMap = new Map(linkClickRows.map(r => [r.month, r.lankklick]));
  const visitMap = new Map(visitRows.map(r => [r.month, r.besok]));

  const linkClickMonths = new Set(linkClickRows.map(r => r.month));
  const visitMonths = new Set(visitRows.map(r => r.month));
  const commonMonths = [...linkClickMonths].filter(m => visitMonths.has(m)).sort();

  return commonMonths.map(month => ({
    month,
    seriesA: visitMap.get(month) ?? null,
    seriesB: linkClickMap.get(month) ?? null,
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
