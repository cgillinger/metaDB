import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';
import { hiddenPostsFilter, hiddenReachFilter, hiddenIGReachFilter } from '../services/hiddenAccounts.js';
import { periodDays } from '../utils/dateHelpers.js';

const router = Router();

/**
 * Maps every accepted ?sort= value to the exact SQL column name produced by
 * the GROUP BY query. Any value absent from this map falls back to 'views'.
 */
const SORT_SQL_MAP = {
  views:          'views',
  likes:          'likes',
  comments:       'comments',
  shares:         'shares',
  total_clicks:   'total_clicks',
  link_clicks:    'link_clicks',
  other_clicks:   'other_clicks',
  saves:          'saves',
  follows:        'follows',
  interactions:   'interactions',
  engagement:     'engagement',
  reach:          'reach',
  account_name:   'account_name',
  post_count:     'post_count',
  posts_per_day:  'post_count',
};

// GET /api/accounts?fields=views,reach,likes&sort=views&order=desc&platform=facebook
router.get('/', (req, res) => {
  const db = getDb();

  const sort = SORT_SQL_MAP[req.query.sort] ?? 'views';
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

  // Hidden accounts filter
  conditions.push(hiddenPostsFilter().slice(4));

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
      SUM(engagement) AS engagement
    FROM posts
    ${whereClause}
    GROUP BY account_name, platform
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
      ${hiddenReachFilter()} -- Hidden accounts filter
      ORDER BY account_name, month
    `).all(...reachMonths);
  } else {
    // No period filter — get all reach data
    reachData = db.prepare(`
      SELECT account_name, month, reach
      FROM account_reach
      WHERE 1=1
      ${hiddenReachFilter()} -- Hidden accounts filter
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

  // Estimated unique clicks for Facebook accounts (period total)
  const estPeriodFilter = buildPeriodConditions(req.query);
  const estConditions = [
    "p.platform = 'facebook'",
    ...estPeriodFilter.conditions,
    hiddenPostsFilter('p').slice(4),
  ];
  if (req.query.excludeCollab === 'true') {
    estConditions.push('p.is_collab = 0');
  }

  const estRows = db.prepare(`
    SELECT
      p.account_name,
      COUNT(*) AS post_count,
      SUM(p.link_clicks) AS total_link_clicks,
      SUM(p.reach) AS sum_post_reach,
      SUM(ar.reach) AS sum_account_reach
    FROM posts p
    LEFT JOIN account_reach ar
      ON p.account_name = ar.account_name
      AND strftime('%Y-%m', p.publish_time) = ar.month
    WHERE ${estConditions.join(' AND ')}
    GROUP BY p.account_name
  `).all(...estPeriodFilter.params);

  const estimatedClicksByAccount = {};
  for (const row of estRows) {
    const { post_count, total_link_clicks, sum_post_reach, sum_account_reach } = row;
    if (!sum_account_reach || sum_account_reach <= 0 || !sum_post_reach || sum_post_reach <= 0) {
      estimatedClicksByAccount[row.account_name] = { upper: null, lower: null, quality: 'suppressed' };
      continue;
    }
    const overlap_factor = sum_post_reach / sum_account_reach;
    if (overlap_factor < 1 || post_count < 5) {
      estimatedClicksByAccount[row.account_name] = { upper: null, lower: null, quality: 'suppressed' };
      continue;
    }
    const upper = Math.round(total_link_clicks / overlap_factor);
    const lower = Math.round(upper / 1.5);
    estimatedClicksByAccount[row.account_name] = {
      upper,
      lower,
      quality: overlap_factor > 5 ? 'uncertain' : 'ok',
    };
  }

  // IG account reach — same pattern as FB reach but from ig_account_reach
  let igReachData = [];
  if (reachMonths.length > 0) {
    const igPlaceholders = reachMonths.map(() => '?').join(',');
    igReachData = db.prepare(`
      SELECT account_name, month, reach
      FROM ig_account_reach
      WHERE month IN (${igPlaceholders})
      ${hiddenIGReachFilter()}
      ORDER BY account_name, month
    `).all(...reachMonths);
  } else {
    igReachData = db.prepare(`
      SELECT account_name, month, reach
      FROM ig_account_reach
      WHERE 1=1
      ${hiddenIGReachFilter()}
      ORDER BY account_name, month
    `).all();
  }

  const igReachByAccount = {};
  for (const row of igReachData) {
    if (!igReachByAccount[row.account_name]) igReachByAccount[row.account_name] = {};
    igReachByAccount[row.account_name][row.month] = row.reach;
  }
  const igReachMonthsAvailable = [...new Set(igReachData.map(r => r.month))].sort();

  // Available reach months (only months that actually have data)
  const reachMonthsAvailable = [...new Set(reachData.map(r => r.month))].sort();

  // Include reach-only accounts (accounts in account_reach but not in posts).
  // Auto-include when there are no post-based accounts but reach data exists,
  // or when explicitly requested via includeReachOnly toggle.
  const hasPostAccounts = accounts.length > 0;
  const shouldIncludeReachOnly = req.query.includeReachOnly === 'true' || !hasPostAccounts;
  if (shouldIncludeReachOnly && reachMonthsAvailable.length > 0) {
    const existingAccountKeys = new Set(accounts.map(a => `${a.account_name}::${a.platform}`));
    const reachPlaceholders = reachMonthsAvailable.map(() => '?').join(',');
    const reachOnlyAccounts = db.prepare(`
      SELECT DISTINCT ar.account_name
      FROM account_reach ar
      WHERE ar.month IN (${reachPlaceholders})
      AND LOWER(ar.account_name) NOT LIKE 'srholder%'
      ${hiddenReachFilter('ar')} -- Hidden accounts filter
    `).all(...reachMonthsAvailable);

    for (const row of reachOnlyAccounts) {
      if (existingAccountKeys.has(`${row.account_name}::facebook`)) continue;
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

  // Include IG reach-only accounts (in ig_account_reach but not in posts)
  if (igReachMonthsAvailable.length > 0) {
    const existingIGKeys = new Set(accounts.map(a => `${a.account_name}::instagram`));
    const igPlaceholders2 = igReachMonthsAvailable.map(() => '?').join(',');
    const igReachOnlyAccounts = db.prepare(`
      SELECT DISTINCT ar.account_name
      FROM ig_account_reach ar
      WHERE ar.month IN (${igPlaceholders2})
      AND LOWER(ar.account_name) NOT LIKE 'srholder%'
      ${hiddenIGReachFilter('ar')}
    `).all(...igReachMonthsAvailable);

    for (const row of igReachOnlyAccounts) {
      if (existingIGKeys.has(`${row.account_name}::instagram`)) continue;
      accounts.push({
        account_id: null,
        account_name: row.account_name,
        account_username: null,
        platform: 'instagram',
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

  // Compute avg_daily_link_clicks for each account and totals
  const days = periodDays(req.query);
  if (days && days > 0) {
    for (const row of accounts) {
      row.avg_daily_link_clicks = Math.round(((row.link_clicks || 0) / days) * 10) / 10;
      row.posts_per_day = Math.round(((row.post_count || 0) / days) * 100) / 100;
    }
    totals.avg_daily_link_clicks = Math.round(((totals.link_clicks || 0) / days) * 10) / 10;
  } else {
    for (const row of accounts) {
      row.posts_per_day = 0;
    }
  }

  res.json({ accounts, totals, reachByAccount, reachMonths: reachMonthsAvailable, igReachByAccount, igReachMonths: igReachMonthsAvailable, estimatedClicksByAccount, totalPeriodDays: days || 0 });
});

export default router;
