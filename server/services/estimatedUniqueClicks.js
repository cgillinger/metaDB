import { getDb } from '../db/connection.js';
import { hiddenPostsFilter } from './hiddenAccounts.js';

/**
 * Beräknar uppskattade unika länkklickare per konto och månad.
 * Kräver data i både posts och account_reach.
 *
 * @param {object} [options]
 * @param {string[]} [options.accountNames] - Filter by account names
 * @param {string[]} [options.months] - Filter by months (YYYY-MM array)
 *
 * Returnerar array av:
 * {
 *   account_name, month, platform,
 *   total_link_clicks, sum_post_reach, account_reach,
 *   overlap_factor,
 *   estimated_unique_upper, estimated_unique_lower
 * }
 */
export function getEstimatedUniqueClicks({ accountNames, months } = {}) {
  const db = getDb();
  const conditions = ["p.platform = 'facebook'", 'p.publish_time IS NOT NULL'];
  const params = [];

  if (accountNames && accountNames.length > 0) {
    const placeholders = accountNames.map(() => '?').join(',');
    conditions.push(`p.account_name IN (${placeholders})`);
    params.push(...accountNames);
  }

  if (months && months.length > 0) {
    const placeholders = months.map(() => '?').join(',');
    conditions.push(`strftime('%Y-%m', p.publish_time) IN (${placeholders})`);
    params.push(...months);
  }

  conditions.push(hiddenPostsFilter('p').slice(4));

  const sql = `
    SELECT
      p.account_name,
      strftime('%Y-%m', p.publish_time) AS month,
      p.platform,
      SUM(p.link_clicks) AS total_link_clicks,
      SUM(p.reach) AS sum_post_reach,
      ar.reach AS account_reach,
      CASE WHEN ar.reach > 0 AND SUM(p.reach) > 0
        THEN CAST(SUM(p.reach) AS REAL) / ar.reach
        ELSE NULL
      END AS overlap_factor,
      CASE WHEN ar.reach > 0 AND SUM(p.reach) > 0
        THEN CAST(SUM(p.link_clicks) AS REAL) / (CAST(SUM(p.reach) AS REAL) / ar.reach)
        ELSE NULL
      END AS estimated_unique_upper,
      CASE WHEN ar.reach > 0 AND SUM(p.reach) > 0
        THEN CAST(SUM(p.link_clicks) AS REAL) / (CAST(SUM(p.reach) AS REAL) / ar.reach * 1.5)
        ELSE NULL
      END AS estimated_unique_lower
    FROM posts p
    LEFT JOIN account_reach ar
      ON p.account_name = ar.account_name
      AND strftime('%Y-%m', p.publish_time) = ar.month
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.account_name, strftime('%Y-%m', p.publish_time)
    ORDER BY p.account_name, strftime('%Y-%m', p.publish_time)
  `;

  return db.prepare(sql).all(...params);
}
