/**
 * yearOverYear.js — pure helpers for the "År över år" (year-over-year) mode in
 * TrendAnalysisView.
 *
 * In YoY mode the x-axis collapses to the 12 calendar months (Jan–Dec) and each
 * calendar year present in the data becomes its own coloured line, laid on top of
 * each other so seasonal patterns can be compared.
 *
 * Design decisions (see project discussion):
 *  - One account/series at a time → the year set is unambiguous.
 *  - "Complete" year = the data span covers all of Jan–Dec that year (span-based,
 *    robust to interior zero-months).
 *  - The latest year is offered even when partial ("hittills"), so year-to-date
 *    can be compared against full previous years.
 *  - Missing months render as gaps (value === null), never as a crash to zero.
 *    The caller feeds a dataMap where absent keys mean "no data"; interior zeros
 *    that come back from the backend (genuine 0) stay as 0 and sit on the
 *    baseline.
 */

/** Synthetic 12-month x-axis: '01'..'12'. */
export const YOY_MONTH_AXIS = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, '0')
);

/** 'YYYY-MM' key for the current calendar month. */
export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Drop the in-progress current calendar month (and any future months) from a
 * value map. The current month is never complete, so in YoY it renders as a
 * misleading crash toward zero — made worse by timezone spillover, where a few
 * late posts from the previous month (exported in US/Pacific time) land in the
 * current month after conversion. Excluding it makes the latest line end at the
 * last completed month, and it self-heals once the month is over.
 * @param {Object<string, number|null>} dataMap
 * @param {Date} [now]
 * @returns {Object<string, number|null>}
 */
export function stripCurrentMonth(dataMap, now = new Date()) {
  const cutoff = currentMonthKey(now);
  const out = {};
  for (const [m, v] of Object.entries(dataMap || {})) {
    if (m < cutoff) out[m] = v;
  }
  return out;
}

/**
 * Derive the candidate calendar years from a value map.
 * @param {Object<string, number|null>} dataMap - { 'YYYY-MM': value }
 * @param {object} [opts]
 * @param {Date}   [opts.now] - injectable "today" for testing
 * @returns {Array<{year:number, complete:boolean, partial:boolean, isLatest:boolean, isCurrent:boolean}>}
 */
export function deriveYears(dataMap, { now = new Date() } = {}) {
  const months = Object.keys(dataMap || {})
    .filter((k) => dataMap[k] !== null && dataMap[k] !== undefined)
    .sort();
  if (months.length === 0) return [];

  const min = months[0];
  const max = months[months.length - 1];
  const minYear = Number(min.slice(0, 4));
  const maxYear = Number(max.slice(0, 4));
  const currentYear = now.getFullYear();

  const years = [];
  for (let y = minYear; y <= maxYear; y++) {
    const complete = min <= `${y}-01` && max >= `${y}-12`;
    years.push({
      year: y,
      complete,
      partial: !complete,
      isLatest: y === maxYear,
      isCurrent: y === currentYear,
    });
  }
  return years;
}

/**
 * Legend/label for a year line.
 * Complete year → "2025". Latest partial → "2026 (hittills)".
 * Earlier partial (leading stub) → "2023 (delvis)".
 */
export function yearLabel(yearInfo) {
  if (yearInfo.complete) return String(yearInfo.year);
  if (yearInfo.isLatest) return `${yearInfo.year} (hittills)`;
  return `${yearInfo.year} (delvis)`;
}

/**
 * Default year selection: complete years + the latest year (even if partial).
 * If that yields fewer than two lines but at least two candidate years exist,
 * fall back to selecting every candidate year so the default is always useful.
 * @param {ReturnType<typeof deriveYears>} years
 * @returns {number[]}
 */
export function defaultSelectedYears(years) {
  const preferred = years.filter((y) => y.complete || y.isLatest).map((y) => y.year);
  if (preferred.length >= 2 || years.length < 2) return preferred;
  return years.map((y) => y.year);
}

/**
 * Build the YoY chart lines — one per selected year, each with 12 points laid on
 * the Jan–Dec axis. Months absent from dataMap become value: null (a gap).
 * @param {Object<string, number|null>} dataMap - { 'YYYY-MM': value }
 * @param {ReturnType<typeof deriveYears>} yearInfos
 * @param {Set<number>|number[]} selectedYears
 * @param {string[]} colors - palette, indexed by selection order
 * @returns {Array<{key:string, year:number, account_name:string, _isYoYYear:true, color:string, points:Array<{month:string, monthNum:number, value:number|null}>}>}
 */
export function buildYoYLines(dataMap, yearInfos, selectedYears, colors) {
  const selectedSet = selectedYears instanceof Set ? selectedYears : new Set(selectedYears);
  const selected = yearInfos.filter((y) => selectedSet.has(y.year));
  return selected.map((yi, idx) => ({
    key: `yoy-${yi.year}`,
    year: yi.year,
    account_name: yearLabel(yi),
    _isYoYYear: true,
    color: colors[idx % colors.length],
    points: YOY_MONTH_AXIS.map((mm, i) => {
      const month = `${yi.year}-${mm}`;
      const v = dataMap?.[month];
      return { month, monthNum: i + 1, value: v === null || v === undefined ? null : v };
    }),
  }));
}
