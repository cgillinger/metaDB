/**
 * Return number of days in a 'YYYY-MM' month string.
 */
export function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Calculate total days covered by period params.
 * Accepts the same query object as buildPeriodConditions.
 * Returns null if no period filter is set (= all data, days unknown).
 */
export function periodDays(query) {
  if (query.months) {
    const monthList = query.months.split(',').map(m => m.trim()).filter(Boolean);
    return monthList.reduce((sum, m) => sum + daysInMonth(m), 0);
  }
  if (query.dateFrom && query.dateTo) {
    // Inclusive day count: whole-day midnight anchors, +1 for the end day.
    // (Anchoring `to` at 23:59:59 AND adding 1 double-counted — a single-day
    // range came out as 2 days and skewed every avg/day metric.)
    const from = new Date(query.dateFrom + 'T00:00:00');
    const to = new Date(query.dateTo + 'T00:00:00');
    return Math.round((to - from) / 86400000) + 1;
  }
  return null;
}
