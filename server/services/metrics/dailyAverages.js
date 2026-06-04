/**
 * metrics/dailyAverages.js — snitt/dag och SBS-gruppaggregering (en sanningskälla).
 *
 * Konsoliderar snitt/dag-beräkningen som idag bor på tre ställen med två olika
 * granulariteter (server konto i accounts.js/gaListens.js/gaSiteVisits.js, klient
 * grupprad i AccountView, klient per-månad i TrendAnalysisView). Råvärden lagras —
 * snitt beräknas vid hämtning.
 *
 * SBS-invariant (sum-before-scale): vid gruppaggregering summeras råvärden FÖRST,
 * därefter delas summan på dagar. Aldrig medelvärde av medelvärden.
 *
 * Rundningskontrakt (måste matcha nuvarande visade siffror):
 *   - avg_daily_link_clicks / avg_daily_listens / avg_daily_visits: 1 decimal
 *   - posts_per_day: 2 decimaler
 */

import { daysInMonth } from '../../utils/dateHelpers.js';

/**
 * Snitt per dag, avrundat till `decimals` decimaler. Returnerar 0 när dagar saknas
 * (≤ 0), vilket matchar nuvarande beteende i routes/grupprader.
 * @param {number} total
 * @param {number} days
 * @param {number} [decimals=1]
 */
export function avgPerDay(total, days, decimals = 1) {
  if (!days || days <= 0) return 0;
  const f = 10 ** decimals;
  return Math.round(((total || 0) / days) * f) / f;
}

/**
 * Konto-snitt/dag för posts-läget (matchar accounts.js:307-308).
 * @returns {{ avg_daily_link_clicks: number, posts_per_day: number }}
 */
export function accountDailyAverages(row, days) {
  return {
    avg_daily_link_clicks: avgPerDay(row.link_clicks, days, 1),
    posts_per_day: avgPerDay(row.post_count, days, 2),
  };
}

/**
 * SBS-gruppsnitt: summera ett råfält över medlemsrader FÖRST, dela sedan på dagar.
 * Matchar AccountView.jsx:618-626 (link_clicks) och GA-gruppraderna.
 * @param {object[]} memberRows
 * @param {string} field - råfält att summera, t.ex. 'link_clicks' / 'total_listens'
 * @param {number} days
 * @param {number} [decimals=1]
 */
export function groupAvgPerDay(memberRows, field, days, decimals = 1) {
  const total = memberRows.reduce((sum, a) => sum + (a[field] || 0), 0);
  return avgPerDay(total, days, decimals);
}

/**
 * Summera kalenderdagar över en uppsättning 'YYYY-MM'-månader (GA-mönstret:
 * gaListens.js/gaSiteVisits.js summerar daysInMonth över kontots datamånader).
 * @param {string[]} months
 * @param {number|null} [fallback=null] - värde när months är tom
 */
export function daysOverMonths(months, fallback = null) {
  if (!months || months.length === 0) return fallback;
  return months.reduce((sum, m) => sum + daysInMonth(m), 0);
}
