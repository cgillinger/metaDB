/**
 * Phase-0 baseline capture for the metrics-service consolidation (v2.14.0).
 *
 * Boots against a running server (default http://127.0.0.1:3001) and records the
 * CURRENT displayed numbers for known fixtures into baseline.json. Phases 1-2 must
 * reproduce these exactly. Client-side derived metrics (PlatformTrend YoY/barometer,
 * AccountView group SBS) are recomputed here with the SAME formula the views use,
 * so the JSON reflects what the user actually sees — not just the raw API payload.
 *
 * Run via scripts/baseline/run-capture.sh (boots + tears down the server).
 */

const BASE = process.env.BASE || 'http://127.0.0.1:3001';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

// --- Exact copies of the client-side formulas (do not "improve"; must match) ---

// PlatformTrendView.jsx:62-79
function calcYearOverYear(months) {
  if (months.length < 2) return null;
  const current = months[months.length - 1];
  const [year, mon] = current.month.split('-');
  const lastYearMonth = `${parseInt(year, 10) - 1}-${mon}`;
  const previous = months.find(m => m.month === lastYearMonth);
  if (!previous || previous.avg_views === 0) return null;
  const delta = (current.avg_views - previous.avg_views) / previous.avg_views;
  const status = delta > 0.10 ? 'rising' : delta < -0.10 ? 'falling' : 'stable';
  return {
    delta, status,
    currentMonth: current.month, previousMonth: lastYearMonth,
    currentValue: current.avg_views, previousValue: previous.avg_views,
  };
}

// PlatformTrendView.jsx:46-56
function calcBarometer(months, window) {
  if (months.length < window * 2) return null;
  const recent = months.slice(-window);
  const previous = months.slice(-window * 2, -window);
  const recentAvg = recent.reduce((s, m) => s + (m.avg_views ?? 0), 0) / window;
  const prevAvg = previous.reduce((s, m) => s + (m.avg_views ?? 0), 0) / window;
  if (prevAvg === 0) return null;
  const delta = (recentAvg - prevAvg) / prevAvg;
  const status = delta > 0.10 ? 'rising' : delta < -0.10 ? 'falling' : 'stable';
  return { delta, status, recentAvg, prevAvg };
}

const round1 = v => Math.round(v * 10) / 10; // AccountView snitt/dag rounding

// Exact reproduction of the AccountView estimate cell (AccountView.jsx:742-759).
// Returns the structured pieces plus the rendered display string. sv-SE grouping
// uses a (narrow) no-break space whose codepoint differs by ICU version, so we also
// expose a whitespace-normalized form for stable Phase-2 assertions.
function renderEstimate(est) {
  if (!est || est.upper === null || est.quality === 'suppressed') {
    return { quality: est ? est.quality : 'suppressed', upper: est ? est.upper : null,
      lower: est ? est.lower : null, rangeText: null, display: '—', display_normalized: '—' };
  }
  const upper = Math.round(est.upper).toLocaleString('sv-SE');
  const lower = est.lower !== null ? Math.round(est.lower).toLocaleString('sv-SE') : null;
  const rangeText = `~${lower !== null ? `${lower} – ${upper}` : upper}`;
  const display = est.quality === 'uncertain' ? `${rangeText} ⚠` : rangeText;
  return { quality: est.quality, upper: est.upper, lower: est.lower, rangeText,
    display, display_normalized: display.replace(/\s+/g, ' ').trim() };
}

async function main() {
  const out = { meta: {}, fixtures: {} };

  // ===== Fixture A + D: AccountView snitt/dag + estimated unique clicks =====
  // GET /api/accounts?months=2026-02  (server computes avg_daily_*, posts_per_day,
  // and estimated_unique_* via services/estimatedUniqueClicks.js)
  const accFeb = await get('/api/accounts?months=2026-02');
  const accRows = accFeb.accounts || accFeb.data || accFeb.rows || [];
  const totalPeriodDays = accFeb.totalPeriodDays;

  const pick = (name, platform = 'facebook') =>
    accRows.find(r => r.account_name === name && r.platform === platform) ||
    accRows.find(r => r.account_name === name);

  const slim = r => r && {
    account_name: r.account_name, platform: r.platform,
    post_count: r.post_count, link_clicks: r.link_clicks,
    posts_per_day: r.posts_per_day,                 // server-computed (accounts.js)
    avg_daily_link_clicks: r.avg_daily_link_clicks, // server-computed (accounts.js)
  };

  // Two real accounts with FB posts in 2026-02 (Ekot has none in production).
  out.fixtures.A_snitt_per_dag_feb2026 = {
    endpoint: '/api/accounts?months=2026-02',
    totalPeriodDays,
    accounts: {
      'P4 Göteborg, Sveriges Radio': slim(pick('P4 Göteborg, Sveriges Radio')),
      'P4 Stockholm Sveriges Radio': slim(pick('P4 Stockholm Sveriges Radio')),
    },
  };

  // ===== Fixture D: estimated unique clicks — SERVICE path (the F≈3.x anchor) =====
  // TrendAnalysisView reads this via /api/trends?metric=estimated_unique_clicks, which
  // calls services/estimatedUniqueClicks.js (overlap_factor = sum_post_reach/account_reach).
  // This is the "already server-side, must NOT change" anchor.
  const estQs = new URLSearchParams({
    metric: 'estimated_unique_clicks',
    accountKeys: 'P4 Göteborg, Sveriges Radio::facebook',
    granularity: 'month',
    months: '2026-02',
  });
  const estTr = await get(`/api/trends?${estQs}`);
  const estSeries = (estTr.series || [])[0] || null;
  out.fixtures.D_estimated_unique_clicks_gbg_feb2026 = {
    endpoint: `/api/trends?${estQs}`,
    note: 'SERVICE path (services/estimatedUniqueClicks.js) — anchor, must NOT change.',
    months: estTr.months,
    data: estSeries ? estSeries.data : null,
  };
  // D2: AccountView estimate column AFTER the bugfix — now sourced from the same
  // service as TrendAnalysisView. The divergent inline path in accounts.js was removed,
  // so the column went from "suppressed for all" to showing real values (INTENTIONAL
  // empty→value change, approved). Anchors the display string of all three render
  // branches (ok / uncertain F>5 / suppressed) so a future change can't silently break
  // guardrail rendering, plus a cross-check that AccountView == the service path.
  const estMap = accFeb.estimatedClicksByAccount || {};
  const qualityDist = Object.values(estMap).reduce((m, v) => {
    m[v.quality] = (m[v.quality] || 0) + 1; return m;
  }, {});
  out.fixtures.D2_accountview_estimate_display = {
    endpoint: '/api/accounts?months=2026-02',
    note: 'Post-fix: AccountView estimate now via services/estimatedUniqueClicks.js.',
    qualityDistribution: qualityDist,
    totalAccountsWithEstimate: Object.keys(estMap).length,
    matchesServicePath:
      estSeries && estMap['P4 Göteborg, Sveriges Radio']
        ? estMap['P4 Göteborg, Sveriges Radio'].upper === estSeries.data[0].value &&
          estMap['P4 Göteborg, Sveriges Radio'].lower === estSeries.data[0].lower &&
          estMap['P4 Göteborg, Sveriges Radio'].quality === estSeries.data[0].quality
        : null,
    branches: {
      ok: { account: 'P4 Göteborg, Sveriges Radio',
        ...renderEstimate(estMap['P4 Göteborg, Sveriges Radio']) },
      uncertain: { account: 'P4 Jämtland Sveriges Radio',
        ...renderEstimate(estMap['P4 Jämtland Sveriges Radio']) },
      suppressed: { account: 'Barnradion Sveriges Radio',
        ...renderEstimate(estMap['Barnradion Sveriges Radio']) },
    },
  };

  // ===== Fixture E: AccountView group SBS (sum-before-scale) =====
  // Group "Alla P4" (source=posts). avg_daily_link_clicks recomputed exactly as
  // AccountView.jsx:618-626 — sum member link_clicks first, then divide by days.
  const groupsResp = await get('/api/account-groups?source=posts');
  const groups = groupsResp.groups || [];
  const allP4 = groups.find(g => g.name === 'Alla P4' && g.source === 'posts');
  let sbs = null;
  if (allP4) {
    const accMap = {};
    for (const a of accRows) accMap[`${a.account_name}::${a.platform}`] = a;
    const memberRows = allP4.members.map(k => accMap[k]).filter(Boolean);
    const sumLinkClicks = memberRows.reduce((s, a) => s + (a.link_clicks || 0), 0);
    const sumPosts = memberRows.reduce((s, a) => s + (a.post_count || 0), 0);
    sbs = {
      groupId: allP4.id, name: allP4.name,
      memberCount: allP4.members.length, matchedCount: memberRows.length,
      sum_link_clicks: sumLinkClicks, sum_post_count: sumPosts, totalPeriodDays,
      avg_daily_link_clicks: totalPeriodDays > 0 ? round1(sumLinkClicks / totalPeriodDays) : null,
    };
  }
  out.fixtures.E_group_sbs_alla_p4_feb2026 = {
    endpoint: '/api/accounts?months=2026-02 + /api/account-groups?source=posts',
    note: 'SBS invariant: sum raw link_clicks across members, then divide by days.',
    group: sbs,
  };

  // ===== Fixtures F & G: AccountView GA group SBS (snitt/dag) =====
  // Group avg_daily_* for GA listens / site-visits, anchored as the client computes
  // them today: sum members' total over the period, divide by the period-wide
  // totalPeriodDays (NOT per-account), round to 1 decimal. AccountView.jsx:463-491,534-562.
  async function gaGroupFixture(source, summaryPath, totalField, avgField) {
    const groups = (await get(`/api/account-groups?source=${source}`)).groups || [];
    const sum = await get(summaryPath);
    const progMap = {};
    for (const p of sum.programmes || []) progMap[p.account_name] = p;
    const out = { endpoint: summaryPath, totalPeriodDays: sum.totalPeriodDays, groups: {} };
    for (const g of groups) {
      const names = g.members.map(k => k.split('::')[0]);
      const rows = names.map(n => progMap[n]).filter(Boolean);
      const total = rows.reduce((s, p) => s + (p[totalField] || 0), 0);
      const avg = sum.totalPeriodDays > 0 ? round1(total / sum.totalPeriodDays) : 0;
      out.groups[g.id] = {
        name: g.name, memberCount: names.length, matchedCount: rows.length,
        [`sum_${totalField}`]: total, [avgField]: avg,
      };
    }
    return out;
  }
  out.fixtures.F_ga_listens_group_sbs_feb2026 =
    await gaGroupFixture('ga_listens', '/api/ga-listens/summary?months=2026-02',
      'total_listens', 'avg_daily_listens');
  out.fixtures.G_ga_site_visits_group_sbs_feb2026 =
    await gaGroupFixture('ga_site_visits', '/api/ga-site-visits/summary?months=2026-02',
      'total_visits', 'avg_daily_visits');

  // ===== Fixture B: PlatformTrend YoY + barometer (P4, facebook) =====
  const pt = await get('/api/platform-trends?platform=facebook&group=p4');
  const ptMonths = pt.months || [];
  out.fixtures.B_platform_yoy_p4_fb = {
    endpoint: '/api/platform-trends?platform=facebook&group=p4',
    monthsCount: ptMonths.length,
    lastMonth: ptMonths.length ? ptMonths[ptMonths.length - 1].month : null,
    yoy: calcYearOverYear(ptMonths),
    barometer_window4: calcBarometer(ptMonths, 4),
  };

  // ===== Fixture C: TrendAnalysisView series with an empty month (zero-fill) =====
  // P4 DANS, metric=views, full month span 2024-01..2026-05. The view passes a
  // months list, so trends.js builds a full axis and zero-fills 2025-11 (no posts).
  const months = [];
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (k >= '2024-01' && k <= '2026-05') months.push(k);
    }
  }
  const qs = new URLSearchParams({
    metric: 'views',
    accountKeys: 'P4 DANS::facebook',
    granularity: 'month',
    months: months.join(','),
  });
  const tr = await get(`/api/trends?${qs}`);
  const trMonths = tr.months || [];
  const series = (tr.series || tr.accounts || tr.lines || [])[0] || null;
  const data = series ? (series.data || series.points || []) : [];
  const idxNov = trMonths.indexOf('2025-11');
  out.fixtures.C_trend_series_zero_fill = {
    endpoint: `/api/trends?${qs}`,
    account: 'P4 DANS', metric: 'views',
    monthsCount: trMonths.length,
    emptyMonth: '2025-11',
    emptyMonthIndex: idxNov,
    emptyMonthValue: idxNov >= 0 ? data[idxNov] : null,
    neighbours: idxNov >= 0
      ? { before: { month: trMonths[idxNov - 1], value: data[idxNov - 1] },
          at: { month: '2025-11', value: data[idxNov] },
          after: { month: trMonths[idxNov + 1], value: data[idxNov + 1] } }
      : null,
    fullSeries: trMonths.map((m, i) => ({ month: m, value: data[i] })),
  };

  // ===== Fixture C2: no-filter zero-fill (INTENTIONAL empty→0 change) =====
  // Same series WITHOUT a period filter. Before: interior empty months were absent.
  // After (trend/series.js full min..max axis): 2025-11 is present as an explicit 0.
  const qs2 = new URLSearchParams({
    metric: 'views', accountKeys: 'P4 DANS::facebook', granularity: 'month',
  });
  const tr2 = await get(`/api/trends?${qs2}`);
  const tr2Months = tr2.months || [];
  const series2 = (tr2.series || [])[0] || null;
  const data2 = series2 ? (series2.data || []) : [];
  const idxNov2 = tr2Months.indexOf('2025-11');
  out.fixtures.C2_trend_series_zero_fill_no_filter = {
    endpoint: `/api/trends?${qs2}`,
    note: 'No period filter. INTENTIONAL: empty month 2025-11 absent → 0-point.',
    account: 'P4 DANS', metric: 'views',
    monthsCount: tr2Months.length,
    firstMonth: tr2Months[0], lastMonth: tr2Months[tr2Months.length - 1],
    emptyMonth: '2025-11',
    emptyMonthPresent: idxNov2 >= 0,
    emptyMonthValue: idxNov2 >= 0 ? data2[idxNov2] : null,
    neighbours: idxNov2 >= 0
      ? { before: { month: tr2Months[idxNov2 - 1], value: data2[idxNov2 - 1] },
          at: { month: '2025-11', value: data2[idxNov2] },
          after: { month: tr2Months[idxNov2 + 1], value: data2[idxNov2 + 1] } }
      : null,
  };

  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('CAPTURE-ERR', e.stack || e.message); process.exit(1); });
