import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';
import { hiddenPostsFilter, hiddenReachFilter } from '../services/hiddenAccounts.js';

const router = Router();

/**
 * Whitelist map: metric name → SQL aggregation expression.
 * Only metrics listed here are accepted; anything else returns 400.
 * account_reach is handled separately (own table, own query path).
 */
const METRIC_SQL_MAP = {
  views:          'SUM(views)',
  reach:          'CAST(ROUND(AVG(reach)) AS INTEGER)',
  average_reach:  'CAST(ROUND(AVG(reach)) AS INTEGER)',
  likes:          'SUM(likes)',
  comments:       'SUM(comments)',
  shares:         'SUM(shares)',
  total_clicks:   'SUM(total_clicks)',
  link_clicks:    'SUM(link_clicks)',
  other_clicks:   'SUM(other_clicks)',
  saves:          'SUM(saves)',
  follows:        'SUM(follows)',
  interactions:   'SUM(interactions)',
  engagement:     'SUM(engagement)',
  post_count:     'COUNT(*)',
  posts_per_day:  'COUNT(*)',
};

// Parse composite keys "name::platform" into {name, platform} pairs.
// Keys are separated by "||" to avoid conflicts with commas in account names.
function parseAccountKeys(keysParam) {
  if (!keysParam) return [];
  return keysParam.split('||').map(k => k.trim()).filter(Boolean).map(key => {
    const idx = key.lastIndexOf('::');
    if (idx === -1) return { name: key, platform: null };
    return { name: key.slice(0, idx), platform: key.slice(idx + 2) };
  });
}

// Build SQL conditions for account name+platform pairs
function buildAccountFilter(pairs, tableAlias = '') {
  if (pairs.length === 0) return { sql: '', params: [] };
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const conditions = pairs.map(p =>
    p.platform
      ? `(${prefix}account_name = ? AND ${prefix}platform = ?)`
      : `(${prefix}account_name = ?)`
  );
  const params = pairs.flatMap(p =>
    p.platform ? [p.name, p.platform] : [p.name]
  );
  return { sql: `(${conditions.join(' OR ')})`, params };
}

// GET /api/trends?metric=interactions&accountKeys=name1::facebook||name2::instagram&granularity=month
router.get('/', (req, res) => {
  const db = getDb();

  const metric = req.query.metric;
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';

  const accountPairs = parseAccountKeys(req.query.accountKeys);

  // account_reach is served from a separate table (FB only) — validate and handle early
  if (metric === 'account_reach') {
    const reachConditions = [];
    const reachParams = [];

    if (accountPairs.length > 0) {
      // account_reach is always facebook, so just filter by name
      const names = accountPairs.map(p => p.name);
      const placeholders = names.map(() => '?').join(',');
      reachConditions.push(`ar.account_name IN (${placeholders})`);
      reachParams.push(...names);
    }

    // Hidden accounts filter
    reachConditions.push(hiddenReachFilter('ar').slice(4));

    // Period filtering for account_reach
    const { months: monthsParam } = req.query;
    if (months) {
      const monthList = monthsParam.split(',').map(m => m.trim()).filter(Boolean);
      if (monthList.length > 0) {
        const placeholders = monthList.map(() => '?').join(',');
        reachConditions.push(`ar.month IN (${placeholders})`);
        reachParams.push(...monthList);
      }
    }

    const reachWhere = `WHERE ${reachConditions.join(' AND ')}`;
    const reachQuery = `
      SELECT
        ar.month AS period,
        ar.account_name,
        ar.reach AS value
      FROM account_reach ar
      ${reachWhere}
      ORDER BY ar.month ASC, ar.account_name ASC
    `;

    const rows = db.prepare(reachQuery).all(...reachParams);

    const monthSet = new Set();
    const byAccount = {};

    for (const row of rows) {
      monthSet.add(row.period);
      const key = row.account_name;
      if (!byAccount[key]) {
        byAccount[key] = {
          account_name: row.account_name,
          platform: 'facebook',
          is_collab: false,
          dataMap: {},
        };
      }
      byAccount[key].dataMap[row.period] = row.value;
    }

    const months = Array.from(monthSet).sort();
    const series = Object.values(byAccount).map(account => ({
      account_id: account.account_name,
      account_name: account.account_name,
      platform: account.platform,
      is_collab: account.is_collab,
      data: months.map(m => account.dataMap[m] || 0),
    }));

    return res.json({ metric, granularity: 'month', months, series });
  }

  // Validate metric against the whitelist map — reject anything not explicitly listed
  const valueExpr = METRIC_SQL_MAP[metric];
  if (!valueExpr) {
    return res.status(400).json({ error: 'Ogiltigt mätvärde.' });
  }

  // Regular metrics from posts table
  const conditions = ['publish_time IS NOT NULL'];
  const params = [];

  // Period filtering
  const periodFilter = buildPeriodConditions(req.query);
  conditions.push(...periodFilter.conditions);
  params.push(...periodFilter.params);

  if (req.query.platform) {
    conditions.push('platform = ?');
    params.push(req.query.platform);
  }

  if (accountPairs.length > 0) {
    const filter = buildAccountFilter(accountPairs);
    conditions.push(filter.sql);
    params.push(...filter.params);
  }

  if (req.query.excludeCollab === 'true') {
    conditions.push('is_collab = 0');
  }

  // Hidden accounts filter
  conditions.push(hiddenPostsFilter().slice(4));

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const timeExpr = granularity === 'week'
    ? "strftime('%Y-W%W', publish_time)"
    : "strftime('%Y-%m', publish_time)";

  // Group by period + account_name + platform to keep FB/IG separate
  const query = `
    SELECT
      ${timeExpr} AS period,
      account_id,
      account_name,
      platform,
      MAX(is_collab) AS is_collab,
      ${valueExpr} AS value,
      COUNT(*) AS post_count
    FROM posts
    ${whereClause}
    GROUP BY ${timeExpr}, account_name, platform
    ORDER BY period ASC, account_name ASC
  `;

  const rows = db.prepare(query).all(...params);

  // Collect all unique months
  const monthSet = new Set();
  const byAccount = {};

  for (const row of rows) {
    monthSet.add(row.period);
    // Use name::platform as key to keep FB/IG versions separate
    const key = `${row.account_name}::${row.platform}`;
    if (!byAccount[key]) {
      byAccount[key] = {
        account_id: row.account_id,
        account_name: row.account_name,
        platform: row.platform,
        is_collab: !!row.is_collab,
        dataMap: {},
      };
    }

    let value = row.value;
    if (metric === 'posts_per_day' && row.period) {
      const [year, month] = row.period.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      value = Math.round((row.post_count / daysInMonth) * 10) / 10;
    }

    byAccount[key].dataMap[row.period] = value;
  }

  const months = Array.from(monthSet).sort();

  const series = Object.values(byAccount).map(account => ({
    account_id: account.account_id,
    account_name: account.account_name,
    platform: account.platform,
    is_collab: account.is_collab,
    data: months.map(m => account.dataMap[m] || 0),
  }));

  res.json({
    metric,
    granularity,
    months,
    series,
  });
});

export default router;
