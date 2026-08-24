/**
 * splicedLine.js — ren geometrilogik för den skarvade "unika personer"-linjen.
 *
 * Bryts ut ur TrendAnalysisView för att kunna testas utan DOM, samma mönster som
 * yearOverYear.js. Innehåller ingen React och ingen SVG — bara index och körningar.
 */

/**
 * Index för brytmånaden på den visade axeln.
 * Returnerar -1 när månaden saknas (t.ex. periodfilter som klipper bort den) eller
 * när den ligger först — en markering i vänsterkanten säger inget.
 * @returns {number}
 */
export function breakpointIndex(months, breakpointMonth) {
  if (!breakpointMonth || !Array.isArray(months)) return -1;
  const i = months.indexOf(breakpointMonth);
  return i > 0 ? i : -1;
}

/**
 * Sammanhängande körningar av punkter som har ett spökvärde. Hål bryter en körning,
 * så skuggan aldrig ritar en bro över månader som saknar äldre mätvärde.
 * @param {Array<{ghostY: number|null}>} pathPoints
 * @returns {Array<Array<object>>}
 */
export function ghostRuns(pathPoints) {
  const runs = [];
  let current = [];
  for (const p of pathPoints || []) {
    if (p && p.ghostY !== null && p.ghostY !== undefined) {
      current.push(p);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs;
}

/**
 * Sorterade, deduplicerade brytpunktsindex över alla synliga linjer. Brytmånaden är
 * per konto, så flera konton kan bryta i olika månader.
 * @returns {number[]}
 */
export function distinctBreakpointIndexes(lines, months) {
  const set = new Set();
  for (const line of lines || []) {
    const i = breakpointIndex(months, line && line.breakpointMonth);
    if (i > 0) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}
