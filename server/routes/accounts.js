import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';
import { hiddenPostsFilter, hiddenReachFilter, hiddenIGReachFilter } from '../services/hiddenAccounts.js';
import { getEstimatedUniqueClicksByAccount } from '../services/estimatedUniqueClicks.js';
import { accountDailyAverages, avgPerDay, groupAvgPerDay } from '../services/metrics/dailyAverages.js';
import { resolveMonthList } from '../services/period/resolve.js';
import { getAccountGroups } from '../services/accountGroupService.js';
import { periodDays } from '../utils/dateHelpers.js';

// Raw post fields that may be summed across members of a posts group (SBS numerator).
// Mirror of AccountView's GROUP_SUMMABLE — the client no longer sums these itself.
const GROUP_SUMMABLE = [
  'views', 'likes', 'comments', 'shares', 'saves', 'follows',
  'total_clicks', 'link_clicks', 'other_clicks', 'interactions', 'engagement', 'post_count',
];

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

  // Månadslista för månadsbaserade källor (account_reach/ig_account_reach) — en
  // sanningskälla i period/resolve. Byte-identisk med tidigare inline-logik.
  const reachMonths = resolveMonthList(req.query);

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

  // Estimated unique clicks per account (period total) — single source of truth is
  // services/estimatedUniqueClicks.js (same F-math as TrendAnalysisView). Period is
  // expressed as the monthly list `reachMonths` since account_reach is monthly.
  const estimatedClicksByAccount = getEstimatedUniqueClicksByAccount({
    months: reachMonths.length > 0 ? reachMonths : undefined,
    excludeCollab: req.query.excludeCollab === 'true',
  });

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

  // FB unique viewers ("Unika tittare (API)") — successor to legacy account_reach.
  // Same monthly, never-summed semantics; kept as a separate series (different
  // measure definition, must not be merged with legacy reach).
  let viewersData = [];
  if (reachMonths.length > 0) {
    const vPlaceholders = reachMonths.map(() => '?').join(',');
    viewersData = db.prepare(`
      SELECT account_name, month, viewers
      FROM account_viewers
      WHERE month IN (${vPlaceholders})
      ${hiddenReachFilter()}
      ORDER BY account_name, month
    `).all(...reachMonths);
  } else {
    viewersData = db.prepare(`
      SELECT account_name, month, viewers
      FROM account_viewers
      WHERE 1=1
      ${hiddenReachFilter()}
      ORDER BY account_name, month
    `).all();
  }

  const viewersByAccount = {};
  for (const row of viewersData) {
    if (!viewersByAccount[row.account_name]) viewersByAccount[row.account_name] = {};
    viewersByAccount[row.account_name][row.month] = row.viewers;
  }
  const viewersMonthsAvailable = [...new Set(viewersData.map(r => r.month))].sort();

  // Available reach months (only months that actually have data)
  const reachMonthsAvailable = [...new Set(reachData.map(r => r.month))].sort();

  // Include reach-only accounts (accounts in account_reach but not in posts).
  // Auto-include when there are no post-based accounts but reach data exists,
  // or when explicitly requested via includeReachOnly toggle.
  const hasPostAccounts = accounts.length > 0;
  // Reach-only accounts are platform-specific (FB/IG). When a specific platform
  // is requested, only fold in reach-only accounts of THAT platform — otherwise a
  // TikTok (or FB) view would list every IG reach-only account with zeroed metrics.
  const reqPlatform = req.query.platform;
  const shouldIncludeReachOnly = req.query.includeReachOnly === 'true' || !hasPostAccounts;
  if (shouldIncludeReachOnly && reachMonthsAvailable.length > 0 && (!reqPlatform || reqPlatform === 'facebook')) {
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

  // Include viewers-only FB accounts (in account_viewers but not in posts) —
  // same rule as reach-only accounts, so post-less pages keep appearing after
  // the legacy reach series ended (2026-05).
  if (shouldIncludeReachOnly && viewersMonthsAvailable.length > 0 && (!reqPlatform || reqPlatform === 'facebook')) {
    const existingFBKeys = new Set(accounts.map(a => `${a.account_name}::${a.platform}`));
    const vPlaceholders2 = viewersMonthsAvailable.map(() => '?').join(',');
    const viewersOnlyAccounts = db.prepare(`
      SELECT DISTINCT av.account_name
      FROM account_viewers av
      WHERE av.month IN (${vPlaceholders2})
      AND LOWER(av.account_name) NOT LIKE 'srholder%'
      ${hiddenReachFilter('av')}
    `).all(...viewersMonthsAvailable);

    for (const row of viewersOnlyAccounts) {
      if (existingFBKeys.has(`${row.account_name}::facebook`)) continue;
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
  if (igReachMonthsAvailable.length > 0 && (!reqPlatform || reqPlatform === 'instagram')) {
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

  // Compute avg_daily_link_clicks + posts_per_day per account and totals.
  // Single source of truth for the snitt/dag-math is metrics/dailyAverages.js.
  const days = periodDays(req.query);
  if (days && days > 0) {
    for (const row of accounts) {
      Object.assign(row, accountDailyAverages(row, days));
    }
    totals.avg_daily_link_clicks = avgPerDay(totals.link_clicks, days, 1);
  } else {
    for (const row of accounts) {
      row.posts_per_day = 0;
    }
  }

  // Server-side posts-group aggregates (SBS). Group rows stay DISPLAY-ONLY: they are
  // returned in a separate map keyed by group id, never injected into `accounts`, so
  // they never enter totals/pagination/export. Summing the same per-account rows the
  // client would, then avg_daily_link_clicks via metrics/dailyAverages (single source
  // of truth). Replaces the client-side SBS in AccountView.jsx:597-631.
  const accountMap = {};
  for (const a of accounts) accountMap[`${a.account_name}::${a.platform}`] = a;
  const groupAggregates = {};
  for (const group of getAccountGroups('posts')) {
    const memberRows = group.members.map(k => accountMap[k]).filter(Boolean);
    const agg = {
      groupId: group.id,
      memberCount: group.members.length,
      matchedCount: memberRows.length,
    };
    for (const field of GROUP_SUMMABLE) {
      agg[field] = memberRows.reduce((sum, a) => sum + (a[field] || 0), 0);
    }
    if (days && days > 0) {
      agg.avg_daily_link_clicks = groupAvgPerDay(memberRows, 'link_clicks', days, 1);
    }
    groupAggregates[group.id] = agg;
  }

  res.json({ accounts, totals, reachByAccount, reachMonths: reachMonthsAvailable, igReachByAccount, igReachMonths: igReachMonthsAvailable, viewersByAccount, viewersMonths: viewersMonthsAvailable, estimatedClicksByAccount, groupAggregates, totalPeriodDays: days || 0 });
});

export default router;
