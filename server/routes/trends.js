import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

// Allowed metrics for trend queries
const ALLOWED_METRICS = new Set([
  'views', 'reach', 'likes', 'comments', 'shares',
  'total_clicks', 'link_clicks', 'other_clicks',
  'saves', 'follows', 'interactions', 'engagement'
]);

// GET /api/trends?metric=interactions&accounts=id1,id2&granularity=month&platform=facebook
router.get('/', (req, res) => {
  const db = getDb();

  const metric = ALLOWED_METRICS.has(req.query.metric) ? req.query.metric : 'interactions';
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';

  const conditions = [];
  const params = [];

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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Determine time grouping
  let timeExpr;
  if (granularity === 'week') {
    timeExpr = "strftime('%Y-W%W', publish_time)";
  } else {
    timeExpr = "strftime('%Y-%m', publish_time)";
  }

  // For reach, use AVG; for everything else, SUM
  const aggregation = metric === 'reach'
    ? `CAST(ROUND(AVG(${metric})) AS INTEGER)`
    : `SUM(${metric})`;

  const query = `
    SELECT
      ${timeExpr} AS period,
      account_id,
      account_name,
      ${aggregation} AS value,
      COUNT(*) AS post_count
    FROM posts
    ${whereClause}
    AND publish_time IS NOT NULL
    GROUP BY ${timeExpr}, account_id
    ORDER BY period ASC, account_name ASC
  `;

  // Fix WHERE/AND: if whereClause is empty, the "AND" is invalid
  const fixedQuery = whereClause
    ? query
    : query.replace('AND publish_time IS NOT NULL', 'WHERE publish_time IS NOT NULL');

  const rows = db.prepare(fixedQuery).all(...params);

  // Group by account for easier frontend consumption
  const byAccount = {};
  for (const row of rows) {
    const key = row.account_id || row.account_name;
    if (!byAccount[key]) {
      byAccount[key] = {
        account_id: row.account_id,
        account_name: row.account_name,
        data: [],
      };
    }
    byAccount[key].data.push({
      period: row.period,
      value: row.value,
      post_count: row.post_count,
    });
  }

  res.json({
    metric,
    granularity,
    accounts: Object.values(byAccount),
  });
});

export default router;
