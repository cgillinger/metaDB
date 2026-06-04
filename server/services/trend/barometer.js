/**
 * trend/barometer.js — plattformstrendens barometrar (en sanningskälla).
 *
 * Lyft ordagrant från PlatformTrendView.jsx (calcBarometer:46-56,
 * calcYearOverYear:62-79) så att klient och server ger exakt samma omdöme. Rena
 * funktioner över en `months`-array av formen { month: 'YYYY-MM', avg_views, ... }.
 *
 * Tröskel: ±10 % skiljer 'rising'/'falling' från 'stable'.
 */

/**
 * Rullande korttrend: snittet av de senaste `window` månaderna mot de `window`
 * månaderna dessförinnan. Returnerar null om underlaget är för tunt eller prevAvg=0.
 * @param {Array<{avg_views?: number}>} months
 * @param {number} window - antal månader per fönster (UI-default 4)
 */
export function calcBarometer(months, window) {
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

/**
 * År-över-år: sista månaden mot samma kalendermånad föregående år. Returnerar null
 * om motsvarande månad saknas eller dess avg_views=0.
 * @param {Array<{month: string, avg_views: number}>} months
 */
export function calcYearOverYear(months) {
  if (months.length < 2) return null;
  const current = months[months.length - 1];
  const [year, mon] = current.month.split('-');
  const lastYearMonth = `${parseInt(year, 10) - 1}-${mon}`;
  const previous = months.find(m => m.month === lastYearMonth);
  if (!previous || previous.avg_views === 0) return null;
  const delta = (current.avg_views - previous.avg_views) / previous.avg_views;
  const status = delta > 0.10 ? 'rising' : delta < -0.10 ? 'falling' : 'stable';
  return {
    delta,
    status,
    currentMonth: current.month,
    previousMonth: lastYearMonth,
    currentValue: current.avg_views,
    previousValue: previous.avg_views,
  };
}
