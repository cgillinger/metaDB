import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { hiddenPostsFilter } from '../services/hiddenAccounts.js';
import { P4_REGIONS } from '../../shared/p4Regions.js';
import { calcBarometer, calcYearOverYear } from '../services/trend/barometer.js';

// Default rolling-trend window — mirrors PlatformTrendView's baroWindow default.
const DEFAULT_BAROMETER_WINDOW = 4;

const router = Router();

/**
 * Build a SQL fragment restricting results to the 25 active local P4 stations.
 * Match: account_name starts with "P4 " + region name.
 */
function buildP4Filter(alias) {
  const prefix = alias ? `${alias}.` : '';
  const clauses = P4_REGIONS.map(r => `${prefix}account_name LIKE 'P4 ${r}%'`);
  return `AND (${clauses.join(' OR ')})`;
}

/**
 * Build a SQL fragment excluding the 25 active local P4 stations ("Riks").
 */
function buildP4ExcludeFilter(alias) {
  const prefix = alias ? `${alias}.` : '';
  const clauses = P4_REGIONS.map(r => `${prefix}account_name LIKE 'P4 ${r}%'`);
  return `AND NOT (${clauses.join(' OR ')})`;
}

/**
 * GET /api/platform-trends
 *
 * Query params:
 *   platform  — 'facebook' | 'instagram' (required)
 *   group     — 'all' | 'p4' | 'riks' (default: 'all')
 *   months    — comma-separated 'YYYY-MM' (optional; if omitted, all months)
 *
 * Returns:
 *   { months: [ { month, post_count, avg_views, avg_reach, account_count } ],
 *     totalPosts, accountCount, platform, group }
 */
router.get('/', (req, res) => {
  try {
    const { platform, group = 'all', months } = req.query;
    if (!platform || !['facebook', 'instagram'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be facebook or instagram' });
    }

    const db = getDb();
    const params = [platform];
    let monthFilter = '';
    let groupFilter = '';

    // Month filter
    if (months) {
      const monthList = months.split(',').map(m => m.trim()).filter(Boolean);
      if (monthList.length > 0) {
        monthFilter = `AND strftime('%Y-%m', publish_time) IN (${monthList.map(() => '?').join(',')})`;
        params.push(...monthList);
      }
    }

    // Group filter
    if (group === 'p4') {
      groupFilter = buildP4Filter();
    } else if (group === 'riks') {
      groupFilter = buildP4ExcludeFilter();
    }

    // Hidden accounts filter
    const hiddenFilter = hiddenPostsFilter();

    const sql = `
      SELECT
        strftime('%Y-%m', publish_time) AS month,
        COUNT(*) AS post_count,
        ROUND(AVG(views), 0) AS avg_views,
        ROUND(AVG(reach), 0) AS avg_reach,
        COUNT(DISTINCT account_name) AS account_count
      FROM posts
      WHERE platform = ?
        ${hiddenFilter}
        ${groupFilter}
        ${monthFilter}
      GROUP BY month
      ORDER BY month
    `;

    const rows = db.prepare(sql).all(...params);

    // Total posts across all months (for footer)
    const totalPosts = rows.reduce((sum, r) => sum + r.post_count, 0);

    // Max account count across months (accounts may vary by month)
    const maxAccounts = rows.length > 0
      ? Math.max(...rows.map(r => r.account_count))
      : 0;

    res.json({
      months: rows,
      totalPosts,
      accountCount: maxAccounts,
      platform,
      group,
      // Server-side barometrar (Fas 1, additivt). PlatformTrendView räknar fortfarande
      // sina egna värden klientsidigt — dessa fält finns för att Fas 2 ska kunna byta
      // till dem. Samma rena funktioner som klienten använder (trend/barometer.js).
      barometer: calcBarometer(rows, DEFAULT_BAROMETER_WINDOW),
      barometerWindow: DEFAULT_BAROMETER_WINDOW,
      yoy: calcYearOverYear(rows),
    });
  } catch (err) {
    console.error('Platform trends error:', err);
    res.status(500).json({ error: 'Failed to fetch platform trends' });
  }
});

export default router;
