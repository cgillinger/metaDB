import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';

const router = Router();

const ALLOWED_METRICS = new Set([
  'views', 'reach', 'average_reach', 'likes', 'comments', 'shares',
  'total_clicks', 'link_clicks', 'other_clicks',
  'saves', 'follows', 'interactions', 'engagement',
  'post_count', 'posts_per_day', 'account_reach'
]);

// GET /api/trends?metric=interactions&accounts=id1,id2&granularity=month&platform=facebook
router.get('/', (req, res) => {
  const db = getDb();

  let metric = ALLOWED_METRICS.has(req.query.metric) ? req.query.metric : 'interactions';
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';

  // account_reach comes from a separate table and cannot be summed/split.
  // Always returns ALL imported months — period selection is ignored.
  if (metric === 'account_reach') {
    const reachConditions = [];
    const reachParams = [];

    // Filter by accounts (match via account_name from posts table, Facebook only)
    if (req.query.accounts) {
      const accountIds = req.query.accounts.split(',').map(s => s.trim()).filter(Boolean);
      if (accountIds.length > 0) {
        const placeholders = accountIds.map(() => '?').join(',');
        reachConditions.push(`ar.account_name IN (SELECT DISTINCT account_name FROM posts WHERE account_id IN (${placeholders}) AND platform = 'facebook')`);
        reachParams.push(...accountIds);
      }
    }

    const reachWhere = reachConditions.length > 0 ? `WHERE ${reachConditions.join(' AND ')}` : '';
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
          account_id: row.account_name,
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
      account_id: account.account_id,
      account_name: account.account_name,
      platform: account.platform,
      is_collab: account.is_collab,
      data: months.map(m => account.dataMap[m] || 0),
    }));

    return res.json({ metric, granularity: 'month', months, series });
  }

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

  if (req.query.accounts) {
    const accountIds = req.query.accounts.split(',').map(s => s.trim()).filter(Boolean);
    if (accountIds.length > 0) {
      conditions.push(`account_id IN (${accountIds.map(() => '?').join(',')})`);
      params.push(...accountIds);
    }
  }

  if (req.query.excludeCollab === 'true') {
    conditions.push('is_collab = 0');
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const timeExpr = granularity === 'week'
    ? "strftime('%Y-W%W', publish_time)"
    : "strftime('%Y-%m', publish_time)";

  // Determine SQL aggregation based on metric
  let valueExpr;
  if (metric === 'reach' || metric === 'average_reach') {
    valueExpr = 'CAST(ROUND(AVG(reach)) AS INTEGER)';
  } else if (metric === 'post_count') {
    valueExpr = 'COUNT(*)';
  } else if (metric === 'posts_per_day') {
    // Will compute in JS based on period
    valueExpr = 'COUNT(*)';
  } else {
    valueExpr = `SUM(${metric})`;
  }

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
    GROUP BY ${timeExpr}, account_id
    ORDER BY period ASC, account_name ASC
  `;

  const rows = db.prepare(query).all(...params);

  // Collect all unique months
  const monthSet = new Set();
  const byAccount = {};

  for (const row of rows) {
    monthSet.add(row.period);
    const key = row.account_id;
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
    // For posts_per_day: count / days in month
    if (metric === 'posts_per_day' && row.period) {
      const [year, month] = row.period.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      value = Math.round((row.post_count / daysInMonth) * 10) / 10;
    }

    byAccount[key].dataMap[row.period] = value;
  }

  const months = Array.from(monthSet).sort();

  // Build series with aligned data arrays
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
