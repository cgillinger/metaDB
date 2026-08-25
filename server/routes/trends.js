import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { buildPeriodConditions } from '../utils/periodFilter.js';
import { hiddenPostsFilter, hiddenReachFilter, hiddenIGReachFilter } from '../services/hiddenAccounts.js';
import { getEstimatedUniqueClicks } from '../services/estimatedUniqueClicks.js';
import { resolveMonthAxis } from '../services/period/resolve.js';
import { fullMonthAxis } from '../services/trend/series.js';
import { buildSplicedSeries, collectMonths } from '../services/trend/spliceViewers.js';

const router = Router();

/**
 * Resolve the month/week axis for a series. With a period filter, use the requested
 * span. WITHOUT one, build a full min..max month axis (trend/series.js) so empty
 * months become explicit zero/null points instead of being absent. Week granularity
 * keeps the plain sorted list of present weeks.
 */
function resolveSeriesMonths(spanMonths, monthSet, granularity) {
  if (spanMonths) return spanMonths;
  if (granularity === 'month') return fullMonthAxis([...monthSet]);
  return [...monthSet].sort();
}

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

/**
 * Build a complete 'YYYY-MM' month span from period filter query params.
 * Returns the full list of months covered by the period filter so that the
 * client can render zero-value months that have no matching posts.
 * Returns null when no period filter is set — callers should then fall back
 * to the months that actually have data.
 */
// Delegerar till period/resolve (en sanningskälla). Byte-identisk med tidigare
// inline-logik: months trimmas/sorteras, dateFrom/dateTo → inkluderande månadsspann.
function buildMonthSpan(query) {
  return resolveMonthAxis(query);
}

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

// The hidden*Filter fragments start with 'AND ' for template interpolation;
// strip that when composing a conditions array instead.
const stripAnd = (fragment) => fragment.replace(/^AND\s+/, '');

/**
 * Read a monthly account-level table (account_reach / account_viewers /
 * ig_account_reach) with shared filtering: optional account names, hidden-account
 * exclusion, optional month list. Serves both the dedicated metric branches and
 * the spliced metric, so the spliced line can never read the same tables through
 * different filtering than its source metrics.
 *
 * table/valueColumn/alias are hardcoded literals from the call site; only names and
 * months come from the request, and both are bound as parameters.
 */
function queryMonthlyAccountTable(db, { table, valueColumn, alias, hiddenFilter, names, monthsParam }) {
  const conditions = [];
  const params = [];

  if (names && names.length > 0) {
    conditions.push(`${alias}.account_name IN (${names.map(() => '?').join(',')})`);
    params.push(...names);
  }

  conditions.push(stripAnd(hiddenFilter(alias)));

  if (monthsParam) {
    const monthList = monthsParam.split(',').map(m => m.trim()).filter(Boolean);
    if (monthList.length > 0) {
      conditions.push(`${alias}.month IN (${monthList.map(() => '?').join(',')})`);
      params.push(...monthList);
    }
  }

  return db.prepare(`
    SELECT ${alias}.month AS period, ${alias}.account_name, ${alias}.${valueColumn} AS value
    FROM ${table} ${alias}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${alias}.month ASC, ${alias}.account_name ASC
  `).all(...params);
}

/**
 * Serve one monthly account-level table as a complete trends response.
 * account_reach, account_viewers and ig_account_reach all share this shape:
 * one raw value per account and month, missing months rendered as 0.
 */
function monthlyAccountTableResponse(req, res, { metric, table, valueColumn, alias, hiddenFilter, platform }) {
  const db = getDb();
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';
  const accountPairs = parseAccountKeys(req.query.accountKeys);
  const names = accountPairs.map(p => p.name);

  const rows = queryMonthlyAccountTable(db, {
    table, valueColumn, alias, hiddenFilter, names, monthsParam: req.query.months,
  });

  const monthSet = new Set();
  const byAccount = {};
  for (const row of rows) {
    monthSet.add(row.period);
    if (!byAccount[row.account_name]) {
      byAccount[row.account_name] = {
        account_name: row.account_name,
        platform,
        is_collab: false,
        dataMap: {},
      };
    }
    byAccount[row.account_name].dataMap[row.period] = row.value;
  }

  // Prefer the full period span so months without data still appear on the
  // x-axis as zero values. Fall back to months with data when no period filter
  // was supplied.
  const spanMonths = buildMonthSpan(req.query);
  const months = resolveSeriesMonths(spanMonths, monthSet, granularity);
  const series = Object.values(byAccount).map(account => ({
    account_id: account.account_name,
    account_name: account.account_name,
    platform: account.platform,
    is_collab: account.is_collab,
    data: months.map(m => account.dataMap[m] || 0),
  }));

  return res.json({ metric, granularity: 'month', months, series });
}

// GET /api/trends?metric=interactions&accountKeys=name1::facebook||name2::instagram&granularity=month
router.get('/', (req, res) => {
  const db = getDb();

  const metric = req.query.metric;
  const granularity = req.query.granularity === 'week' ? 'week' : 'month';

  const accountPairs = parseAccountKeys(req.query.accountKeys);

  // account_reach is served from a separate table (FB only) — handle early
  if (metric === 'account_reach') {
    return monthlyAccountTableResponse(req, res, {
      metric, table: 'account_reach', valueColumn: 'reach', alias: 'ar',
      hiddenFilter: hiddenReachFilter, platform: 'facebook',
    });
  }

  // account_viewers: FB unique viewers from account_viewers table (successor to
  // legacy account_reach — mirrors its logic, always a separate series)
  if (metric === 'account_viewers') {
    return monthlyAccountTableResponse(req, res, {
      metric, table: 'account_viewers', valueColumn: 'viewers', alias: 'av',
      hiddenFilter: hiddenReachFilter, platform: 'facebook',
    });
  }

  // account_viewers_spliced: FB unique people across the June 2026 measure switch.
  // Draws legacy reach and viewers as ONE line with per-month provenance so the UI can
  // mark the breakpoint. Raw values only — nothing is merged, scaled or aggregated.
  if (metric === 'account_viewers_spliced') {
    const names = accountPairs.map(p => p.name);
    const monthsParam = req.query.months;

    const legacyRows = queryMonthlyAccountTable(db, {
      table: 'account_reach', valueColumn: 'reach', alias: 'ar',
      hiddenFilter: hiddenReachFilter, names, monthsParam,
    });
    const viewersRows = queryMonthlyAccountTable(db, {
      table: 'account_viewers', valueColumn: 'viewers', alias: 'av',
      hiddenFilter: hiddenReachFilter, names, monthsParam,
    });

    // The axis is the union of both tables — neither measure alone spans the series.
    const monthSet = collectMonths(legacyRows, viewersRows);
    const spanMonths = buildMonthSpan(req.query);
    const axis = resolveSeriesMonths(spanMonths, monthSet, 'month');

    const { months, series } = buildSplicedSeries({ axis, legacyRows, viewersRows });
    return res.json({ metric, granularity: 'month', months, series });
  }

  // ig_account_reach: IG reach from ig_account_reach table (mirrors account_reach logic)
  if (metric === 'ig_account_reach') {
    return monthlyAccountTableResponse(req, res, {
      metric, table: 'ig_account_reach', valueColumn: 'reach', alias: 'ar',
      hiddenFilter: hiddenIGReachFilter, platform: 'instagram',
    });
  }

  // estimated_unique_clicks: computed from posts + account_reach join
  if (metric === 'estimated_unique_clicks') {
    const accountNames = accountPairs.map(p => p.name);
    const spanMonths = buildMonthSpan(req.query);

    let filterMonths = null;
    if (req.query.months) {
      filterMonths = req.query.months.split(',').map(m => m.trim()).filter(Boolean);
    } else if (spanMonths) {
      filterMonths = spanMonths;
    }

    const rows = getEstimatedUniqueClicks({
      accountNames: accountNames.length > 0 ? accountNames : undefined,
      months: filterMonths || undefined,
      excludeCollab: req.query.excludeCollab === 'true',
    });

    const monthSet = new Set();
    const byAccount = {};

    for (const row of rows) {
      monthSet.add(row.month);
      const key = row.account_name;
      if (!byAccount[key]) {
        byAccount[key] = {
          account_name: row.account_name,
          platform: 'facebook',
          is_collab: false,
          dataMap: {},
        };
      }
      byAccount[key].dataMap[row.month] = {
        value: row.estimated_unique_upper !== null ? Math.round(row.estimated_unique_upper) : null,
        lower: row.estimated_unique_lower !== null ? Math.round(row.estimated_unique_lower) : null,
        quality: row.quality || 'suppressed',
      };
    }

    const months = resolveSeriesMonths(spanMonths, monthSet, granularity);
    const series = Object.values(byAccount).map(account => ({
      account_id: account.account_name,
      account_name: account.account_name,
      platform: 'facebook',
      is_collab: account.is_collab,
      data: months.map(m => account.dataMap[m] ?? null),
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
      let dayCount;
      if (/^\d{4}-W\d{2}$/.test(row.period)) {
        // Week periods have 7 days — parsing 'Wnn' as a month gave NaN
        // and nulled the whole series.
        dayCount = 7;
      } else {
        const [year, month] = row.period.split('-').map(Number);
        dayCount = new Date(year, month, 0).getDate();
      }
      value = Math.round((row.post_count / dayCount) * 10) / 10;
    }

    byAccount[key].dataMap[row.period] = value;
  }

  // With a period filter, use its complete span so months without posts render as
  // zero. WITHOUT a filter, build a full min..max month axis (resolveSeriesMonths →
  // trend/series.js) so interior empty months become explicit 0 points instead of
  // being absent. Week granularity keeps the legacy behaviour (present weeks only).
  const spanMonths = granularity === 'month' ? buildMonthSpan(req.query) : null;
  const months = resolveSeriesMonths(spanMonths, monthSet, granularity);

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
