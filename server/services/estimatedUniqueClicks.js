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
 *   post_count, total_link_clicks, sum_post_reach, account_reach,
 *   overlap_factor,
 *   estimated_unique_upper, estimated_unique_lower,
 *   quality: 'ok' | 'uncertain' | 'suppressed'
 * }
 *
 * quality-regler:
 *   'suppressed' — F < 1, post_count < 5, eller saknar account_reach → upper/lower = null
 *   'uncertain'  — F > 5 → beräkning visas men flaggas
 *   'ok'         — alla andra fall
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
      COUNT(*) AS post_count,
      SUM(p.link_clicks) AS total_link_clicks,
      SUM(p.reach) AS sum_post_reach,
      ar.reach AS account_reach
    FROM posts p
    LEFT JOIN account_reach ar
      ON p.account_name = ar.account_name
      AND strftime('%Y-%m', p.publish_time) = ar.month
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.account_name, strftime('%Y-%m', p.publish_time)
    ORDER BY p.account_name, strftime('%Y-%m', p.publish_time)
  `;

  const rows = db.prepare(sql).all(...params);
  return rows.map(computeEstimates);
}

function computeEstimates(row) {
  const { total_link_clicks, sum_post_reach, account_reach, post_count } = row;

  // Guardrail: saknar account_reach eller post-räckvidd
  if (!account_reach || account_reach <= 0 || !sum_post_reach || sum_post_reach <= 0) {
    return { ...row, overlap_factor: null, estimated_unique_upper: null, estimated_unique_lower: null, quality: 'suppressed' };
  }

  const overlap_factor = sum_post_reach / account_reach;

  // Guardrail: inkonsekvent data (account_reach > sum post reach)
  if (overlap_factor < 1) {
    return { ...row, overlap_factor, estimated_unique_upper: null, estimated_unique_lower: null, quality: 'suppressed' };
  }

  // Guardrail: för lite underlag
  if (post_count < 5) {
    return { ...row, overlap_factor, estimated_unique_upper: null, estimated_unique_lower: null, quality: 'suppressed' };
  }

  const estimated_unique_upper = Math.round(total_link_clicks / overlap_factor);
  const estimated_unique_lower = Math.round(estimated_unique_upper / 1.5);

  // Osäkerhetsmarkering: mycket trogen publik
  const quality = overlap_factor > 5 ? 'uncertain' : 'ok';

  return { ...row, overlap_factor, estimated_unique_upper, estimated_unique_lower, quality };
}
