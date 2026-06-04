/**
 * trend/series.js — serielogik med korrekt zero-fill (en sanningskälla).
 *
 * Problemet idag: trends.js bygger full månadsaxel ENBART när ett periodfilter finns
 * (buildMonthSpan). Utan filter blir axeln bara de månader som har rader i DB:n →
 * tomma månader saknas helt, och klientens `|| 0`-fallback har inget hål att fylla.
 *
 * Den här modulen bygger en FULLSTÄNDIG månadsaxel mellan periodens min och max och
 * zero-fillar saknade månader med 0 för ALLA metrics — oavsett om ett periodfilter
 * angavs eller inte.
 */

import { nextMonth, monthRange } from '../period/resolve.js';

export { nextMonth, monthRange };

/**
 * Full inkluderande månadsaxel som täcker alla månader i `presentMonths`.
 * Tom indata → []. En enda månad → den månaden.
 * @param {string[]} presentMonths - 'YYYY-MM'-värden (osorterade ok)
 * @returns {string[]}
 */
export function fullMonthAxis(presentMonths) {
  const valid = (presentMonths || []).filter(Boolean);
  if (valid.length === 0) return [];
  let min = valid[0];
  let max = valid[0];
  for (const m of valid) {
    if (m < min) min = m;
    if (m > max) max = m;
  }
  return monthRange(min, max);
}

/**
 * Projicera en värdekarta över en månadsaxel och fyll saknade månader med 0.
 * @param {string[]} axis
 * @param {Object<string, number>} dataMap - { 'YYYY-MM': value }
 * @param {number} [fill=0]
 * @returns {number[]}
 */
export function zeroFill(axis, dataMap, fill = 0) {
  return axis.map(m => (dataMap[m] ?? fill));
}

/**
 * Bygg en zero-fillad serie. Om `axis` ges (t.ex. resolveMonthAxis från ett
 * periodfilter) används den; annars härleds full axel från datamånaderna.
 * @param {Object<string, number>} dataMap - { 'YYYY-MM': value }
 * @param {object} [opts]
 * @param {string[]|null} [opts.axis] - explicit månadsaxel (vinner)
 * @param {number} [opts.fill=0]
 * @returns {{ months: string[], data: number[] }}
 */
export function buildZeroFilledSeries(dataMap, { axis = null, fill = 0 } = {}) {
  const months = axis && axis.length ? axis : fullMonthAxis(Object.keys(dataMap || {}));
  return { months, data: zeroFill(months, dataMap || {}, fill) };
}
