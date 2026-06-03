import { getDb } from '../db/connection.js';
import { hiddenPostsFilter, hiddenSiteVisitsFilter } from './hiddenAccounts.js';
import { getAccountGroups } from './accountGroupService.js';

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

/**
 * Build a map from GA (short) account name → Meta (long) account name.
 * E.g. "P4 Halland" → "P4 Halland Sveriges Radio"
 * Returns Map<string, string>. Entries only exist where a match is found.
 */
function buildGaToMetaNameMap(db) {
  const metaRows = db.prepare(`
    SELECT DISTINCT account_name FROM posts
    WHERE platform = 'facebook'
      ${hiddenPostsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const map = new Map();
  for (const metaName of metaRows) {
    const gaName = normalizeMetaName(metaName);
    if (gaName && !map.has(gaName)) {
      map.set(gaName, metaName);
    }
  }
  return map;
}

export function getBesokVsLankklick(accountName, months) {
  const db = getDb();

  const gaToMeta = buildGaToMetaNameMap(db);
  const metaName = gaToMeta.get(accountName);

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

/**
 * Aggregate GA besök and Meta länkklick across a group of GA account names.
 * @param {string[]} memberGaNames - GA (short) account names from group members
 * @param {string[]|null} months
 * @returns {{data: Array<{month, seriesA, seriesB}>, matchInfo: {total, matched}}}
 */
export function getBesokVsLankklickGroup(memberGaNames, months) {
  const db = getDb();
  const gaToMeta = buildGaToMetaNameMap(db);

  const matchedPairs = [];
  for (const gaName of memberGaNames) {
    const metaName = gaToMeta.get(gaName);
    if (metaName) matchedPairs.push({ gaName, metaName });
  }

  let metaImportedMonths;
  let gaImportedMonths;
  if (months && months.length > 0) {
    const ph = months.map(() => '?').join(',');
    metaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM imports WHERE platform = 'facebook' AND month IN (${ph})`)
        .all(...months).map(r => r.month)
    );
    gaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM ga_site_visits WHERE month IN (${ph})`)
        .all(...months).map(r => r.month)
    );
  } else {
    metaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM imports WHERE platform = 'facebook'`)
        .all().map(r => r.month)
    );
    gaImportedMonths = new Set(
      db.prepare(`SELECT DISTINCT month FROM ga_site_visits`)
        .all().map(r => r.month)
    );
  }

  const bothImported = [...metaImportedMonths].filter(m => gaImportedMonths.has(m)).sort();
  const matchInfo = { total: memberGaNames.length, matched: matchedPairs.length };

  if (bothImported.length === 0 || memberGaNames.length === 0) {
    return { data: [], matchInfo };
  }

  const ph = bothImported.map(() => '?').join(',');
  const gaNamePh = memberGaNames.map(() => '?').join(',');

  const visitRows = db.prepare(`
    SELECT month, SUM(visits) AS besok
    FROM ga_site_visits
    WHERE account_name IN (${gaNamePh})
      AND month IN (${ph})
      ${hiddenSiteVisitsFilter()}
    GROUP BY month
  `).all(...memberGaNames, ...bothImported);

  let linkClickRows = [];
  const matchedMetaNames = matchedPairs.map(p => p.metaName);
  if (matchedMetaNames.length > 0) {
    const metaPh = matchedMetaNames.map(() => '?').join(',');
    linkClickRows = db.prepare(`
      SELECT strftime('%Y-%m', publish_time) AS month, SUM(link_clicks) AS lankklick
      FROM posts
      WHERE account_name IN (${metaPh})
        AND platform = 'facebook'
        AND strftime('%Y-%m', publish_time) IN (${ph})
        ${hiddenPostsFilter()}
      GROUP BY strftime('%Y-%m', publish_time)
    `).all(...matchedMetaNames, ...bothImported);
  }

  const visitMap = new Map(visitRows.map(r => [r.month, r.besok]));
  const linkClickMap = new Map(linkClickRows.map(r => [r.month, r.lankklick]));

  const data = bothImported.map(month => ({
    month,
    seriesA: visitMap.get(month) ?? 0,
    seriesB: linkClickMap.get(month) ?? 0,
  }));

  return { data, matchInfo };
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

  const accounts = [...matched].sort((a, b) => a.localeCompare(b, 'sv'));

  const allGroups = getAccountGroups('ga_site_visits');
  const groups = allGroups
    .map(g => {
      const memberGaNames = g.members.map(key => key.split('::')[0]);
      const matchedCount = memberGaNames.filter(n => gaNames.has(n)).length;
      return {
        id: g.id,
        name: g.name,
        memberCount: g.members.length,
        matchedCount,
        memberGaNames,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  return { accounts, groups };
}
