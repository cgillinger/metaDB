import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';

const router = Router();

// Metrics that are SUMmed per account
const SUM_FIELDS = new Set([
  'views', 'likes', 'comments', 'shares',
  'total_clicks', 'link_clicks', 'other_clicks',
  'saves', 'follows', 'interactions', 'engagement'
]);

// Allowed sort columns
const ALLOWED_SORT = new Set([
  ...SUM_FIELDS, 'reach', 'account_name', 'post_count', 'posts_per_day'
]);

// GET /api/accounts?fields=views,reach,likes&sort=views&order=desc&platform=facebook
router.get('/', (req, res) => {
  const db = getDb();

  const sort = ALLOWED_SORT.has(req.query.sort) ? req.query.sort : 'views';
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

  // Build WHERE
  const conditions = [];
  const params = [];

  // Period filtering
  const periodFilter = buildPeriodConditions(req.query);
  conditions.push(...periodFilter.conditions);
  params.push(...periodFilter.params);

  if (req.query.platform) {
    conditions.push('platform = ?');
    params.push(req.query.platform);
  }

  if (req.query.excludeCollab === 'true') {
    conditions.push('is_collab = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build SELECT with SUMs and AVG(reach)
  // Reach = AVG (firm rule from spec), everything else = SUM
  const query = `
    SELECT
      account_id,
      account_name,
      account_username,
      platform,
      MAX(is_collab) AS is_collab,
      COUNT(*) AS post_count,
      SUM(views) AS views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS reach,
      SUM(likes) AS likes,
      SUM(comments) AS comments,
      SUM(shares) AS shares,
      SUM(total_clicks) AS total_clicks,
      SUM(link_clicks) AS link_clicks,
      SUM(other_clicks) AS other_clicks,
      SUM(saves) AS saves,
      SUM(follows) AS follows,
      SUM(interactions) AS interactions,
      SUM(engagement) AS engagement,
      MIN(publish_time) AS earliest_post,
      MAX(publish_time) AS latest_post,
      CASE
        WHEN COUNT(*) > 1 AND julianday(MAX(publish_time)) > julianday(MIN(publish_time))
        THEN ROUND(CAST(COUNT(*) AS REAL) / (julianday(MAX(publish_time)) - julianday(MIN(publish_time)) + 1), 2)
        ELSE CAST(COUNT(*) AS REAL)
      END AS posts_per_day
    FROM posts
    ${whereClause}
    GROUP BY account_id, platform
    ORDER BY ${sort} ${order}
  `;

  const accounts = db.prepare(query).all(...params);

  // Compute totals across all returned accounts
  const totalsQuery = `
    SELECT
      SUM(views) AS views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS reach,
      SUM(likes) AS likes,
      SUM(comments) AS comments,
      SUM(shares) AS shares,
      SUM(total_clicks) AS total_clicks,
      SUM(link_clicks) AS link_clicks,
      SUM(other_clicks) AS other_clicks,
      SUM(saves) AS saves,
      SUM(follows) AS follows,
      SUM(interactions) AS interactions,
      SUM(engagement) AS engagement,
      COUNT(*) AS post_count
    FROM posts
    ${whereClause}
  `;
  const totals = db.prepare(totalsQuery).get(...params) || {};

  // Fetch account-level reach data for the selected period.
  // Reach values are per-month and must never be summed or aggregated.
  // Only show reach columns matching the user's selected months.
  let reachData = [];

  let reachMonths = [];
  if (req.query.months) {
    reachMonths = req.query.months.split(',').map(m => m.trim());
  } else if (req.query.dateFrom && req.query.dateTo) {
    const start = req.query.dateFrom.slice(0, 7);
    const end = req.query.dateTo.slice(0, 7);
    let current = start;
    while (current <= end) {
      reachMonths.push(current);
      const [y, m] = current.split('-').map(Number);
      const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      current = next;
    }
  }

  if (reachMonths.length > 0) {
    const placeholders = reachMonths.map(() => '?').join(',');
    reachData = db.prepare(`
      SELECT account_name, month, reach
      FROM account_reach
      WHERE month IN (${placeholders})
      ORDER BY account_name, month
    `).all(...reachMonths);
  } else {
    // No period filter — get all reach data
    reachData = db.prepare(`
      SELECT account_name, month, reach
      FROM account_reach
      ORDER BY account_name, month
    `).all();
  }

  // Group reach by account_name → { month: reach }
  const reachByAccount = {};
  for (const row of reachData) {
    if (!reachByAccount[row.account_name]) {
      reachByAccount[row.account_name] = {};
    }
    reachByAccount[row.account_name][row.month] = row.reach;
  }

  // Available reach months (only months that actually have data)
  const reachMonthsAvailable = [...new Set(reachData.map(r => r.month))].sort();

  // Include reach-only accounts (accounts in account_reach but not in posts)
  if (req.query.includeReachOnly === 'true' && reachMonthsAvailable.length > 0) {
    const reachPlaceholders = reachMonthsAvailable.map(() => '?').join(',');
    const reachOnlyAccounts = db.prepare(`
      SELECT DISTINCT ar.account_name
      FROM account_reach ar
      WHERE ar.month IN (${reachPlaceholders})
      AND ar.account_name NOT IN (
        SELECT DISTINCT account_name FROM posts
        ${whereClause}
      )
      AND ar.account_name NOT LIKE 'srholder%'
    `).all(...reachMonthsAvailable, ...params);

    for (const row of reachOnlyAccounts) {
      accounts.push({
        account_id: null,
        account_name: row.account_name,
        account_username: null,
        platform: 'facebook',
        is_collab: 0,
        post_count: 0,
        views: 0, reach: 0, likes: 0, comments: 0, shares: 0,
        total_clicks: 0, link_clicks: 0, other_clicks: 0,
        saves: 0, follows: 0, interactions: 0, engagement: 0,
        posts_per_day: 0,
        _reachOnly: true,
      });
    }
  }

  res.json({ accounts, totals, reachByAccount, reachMonths: reachMonthsAvailable });
});

export default router;
