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
export function getEstimatedUniqueClicks({ accountNames, months, excludeCollab } = {}) {
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
  if (excludeCollab) conditions.push('p.is_collab = 0');

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

/**
 * Period-aggregerade estimat per konto — för AccountView-tabellen, som visar ETT
 * estimat per konto över hela den valda perioden (inte per månad).
 *
 * Summerar råkomponenterna (link_clicks, post-räckvidd, kontoräckvidd, antal inlägg)
 * över de månader i perioden som har giltig kontoräckvidd, och kör därefter EXAKT
 * samma F-beräkning som månadsvyn (computeEstimates). Månader utan kontoräckvidd
 * exkluderas helt så att de inte blåser upp F. En enmånadsperiod reproducerar därmed
 * exakt den månadens estimat.
 *
 * Ersätter den tidigare inline-reimplementationen i routes/accounts.js, som joinade
 * SUM(ar.reach) per inlägg och därför multiplicerade kontoräckvidden med antalet
 * inlägg → F < 1 → allt suppressades. Detta är den enda sanningskällan nu.
 *
 * @returns {Object<string, {upper: number|null, lower: number|null, quality: string}>}
 *          map nycklad på account_name (samma kontrakt som AccountView förväntar sig).
 */
export function getEstimatedUniqueClicksByAccount(opts = {}) {
  const rows = getEstimatedUniqueClicks(opts);
  const agg = {};
  for (const r of rows) {
    if (!agg[r.account_name]) {
      agg[r.account_name] = {
        account_name: r.account_name,
        total_link_clicks: 0, sum_post_reach: 0, account_reach: 0, post_count: 0,
      };
    }
    // Endast månader med giltig kontoräckvidd bidrar (täljare och nämnare i takt).
    if (r.account_reach && r.account_reach > 0) {
      const a = agg[r.account_name];
      a.total_link_clicks += r.total_link_clicks || 0;
      a.sum_post_reach += r.sum_post_reach || 0;
      a.account_reach += r.account_reach || 0;
      a.post_count += r.post_count || 0;
    }
  }
  const out = {};
  for (const a of Object.values(agg)) {
    const e = computeEstimates(a); // account_reach=0 → quality 'suppressed'
    out[a.account_name] = {
      upper: e.estimated_unique_upper,
      lower: e.estimated_unique_lower,
      quality: e.quality,
    };
  }
  return out;
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
