/**
 * Return number of days in a 'YYYY-MM' month string.
 */
export function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Calculate total days covered by period params.
 * Accepts the same query object shape as buildPeriodConditions.
 * Returns null if no period filter is set (= all data, days unknown).
 */
export function periodDays(query) {
  if (query.months) {
    const monthList = query.months.split(',').map(m => m.trim()).filter(Boolean);
    return monthList.reduce((sum, m) => sum + daysInMonth(m), 0);
  }
  if (query.dateFrom && query.dateTo) {
    const from = new Date(query.dateFrom + 'T00:00:00');
    const to = new Date(query.dateTo + 'T23:59:59');
    return Math.round((to - from) / 86400000) + 1;
  }
  return null;
}
