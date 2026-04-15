/**
 * Return number of days in a 'YYYY-MM' month string.
 */
export function daysInMonth(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
