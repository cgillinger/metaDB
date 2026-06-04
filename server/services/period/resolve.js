/**
 * period/resolve.js — enhetlig periodhantering (en sanningskälla).
 *
 * Normaliserar de tre periodformerna en route kan få in i query:
 *   - months:   komma-separerad lista 'YYYY-MM,YYYY-MM'
 *   - dateFrom/dateTo: exakt datumintervall 'YYYY-MM-DD'
 *   - (inget):  hela datासetet
 *
 * Upplösning per källa (vad varje datakälla faktiskt kan filtreras på):
 *   - posts:          full dagsupplösning (publish_time, dateFrom/dateTo eller months)
 *   - account_reach:  hel månad (en rad per konto och månad)
 *   - ga_listens:     hel månad
 *   - ga_site_visits: hel månad
 * För månadsbaserade källor projiceras ett dateFrom/dateTo ned till de månader det rör.
 *
 * Routes ska anropa dessa istället för att duplicera månadslogik. Funktionerna är
 * avsiktligt byte-identiska med de tidigare inline-varianterna (trends.js
 * buildMonthSpan, accounts.js reachMonths) så att inkopplingen är en ren no-op.
 */

import { periodDays, daysInMonth } from '../../utils/dateHelpers.js';

/** Steg en månad framåt: '2025-12' → '2026-01'. */
export function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Inkluderande månadslista mellan två 'YYYY-MM' (start ≤ end antas). */
export function monthRange(start, end) {
  const months = [];
  let current = start;
  while (current <= end) {
    months.push(current);
    current = nextMonth(current);
  }
  return months;
}

/**
 * Full månadsaxel för perioden, eller null när inget periodfilter finns.
 * Byte-identisk med tidigare trends.js:buildMonthSpan (months sorteras).
 */
export function resolveMonthAxis(query) {
  if (query.months) {
    return query.months.split(',').map(m => m.trim()).filter(Boolean).sort();
  }
  if (query.dateFrom && query.dateTo) {
    return monthRange(query.dateFrom.slice(0, 7), query.dateTo.slice(0, 7));
  }
  return null;
}

/**
 * Månadslista för månadsbaserade källor (account_reach/GA), [] när inget filter.
 * Byte-identisk med tidigare accounts.js:reachMonths (months sorteras INTE).
 */
export function resolveMonthList(query) {
  if (query.months) {
    return query.months.split(',').map(m => m.trim());
  }
  if (query.dateFrom && query.dateTo) {
    return monthRange(query.dateFrom.slice(0, 7), query.dateTo.slice(0, 7));
  }
  return [];
}

/** Totalt antal dagar i perioden (null när inget filter). Wrapper kring dateHelpers. */
export function resolvePeriodDays(query) {
  return periodDays(query);
}

/**
 * Samlad periodbeskrivning för en route.
 * @returns {{ dateFrom: string|null, dateTo: string|null, monthAxis: string[]|null,
 *             monthList: string[], days: number|null, hasFilter: boolean }}
 */
export function resolvePeriod(query = {}) {
  const monthAxis = resolveMonthAxis(query);
  const monthList = resolveMonthList(query);
  return {
    dateFrom: query.dateFrom || null,
    dateTo: query.dateTo || null,
    monthAxis,
    monthList,
    days: resolvePeriodDays(query),
    hasFilter: Boolean(query.months || (query.dateFrom && query.dateTo)),
  };
}

export { daysInMonth };
