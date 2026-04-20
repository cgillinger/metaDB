import { getDb } from '../db/connection.js';
import { hiddenPostsFilter, hiddenSiteVisitsFilter } from './hiddenAccounts.js';

export function getBesokVsLankklick(accountName, months) {
  const db = getDb();

  let linkClickSQL = `
    SELECT strftime('%Y-%m', publish_time) AS month, SUM(link_clicks) AS lankklick
    FROM posts
    WHERE account_name = ?
      AND platform = 'facebook'
      ${hiddenPostsFilter()}
  `;
  const linkClickParams = [accountName];

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    linkClickSQL += ` AND strftime('%Y-%m', publish_time) IN (${placeholders})`;
    linkClickParams.push(...months);
  }
  linkClickSQL += ` GROUP BY strftime('%Y-%m', publish_time)`;

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

  const linkClickRows = db.prepare(linkClickSQL).all(...linkClickParams);
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

  const postAccounts = db.prepare(`
    SELECT DISTINCT account_name FROM posts
    WHERE platform = 'facebook'
      ${hiddenPostsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const visitAccounts = db.prepare(`
    SELECT DISTINCT account_name FROM ga_site_visits
    WHERE 1=1
      ${hiddenSiteVisitsFilter()}
  `).all().map(r => r.account_name).filter(Boolean);

  const postSet = new Set(postAccounts);
  const all = visitAccounts.filter(name => postSet.has(name));
  return all.sort((a, b) => a.localeCompare(b, 'sv'));
}
