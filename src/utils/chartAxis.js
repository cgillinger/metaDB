/**
 * Compute a "nice" y-axis (min, max, evenly spaced ticks) for a given data max.
 * Shared by the custom SVG charts (PostScatter, ComparisonChart, TrendAnalysisView)
 * so the tick rounding stays identical across all of them.
 *
 * @param {number} maxValue The largest value that must fit on the axis.
 * @returns {{min: number, max: number, ticks: number[], tickInterval?: number}}
 */
export const calculateNiceYAxis = (maxValue) => {
  if (maxValue <= 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
  let tickInterval;
  const normalizedMax = maxValue / magnitude;
  if (normalizedMax <= 1) tickInterval = magnitude * 0.25;
  else if (normalizedMax <= 2) tickInterval = magnitude * 0.5;
  else if (normalizedMax <= 5) tickInterval = magnitude * 1;
  else if (normalizedMax <= 10) tickInterval = magnitude * 2;
  else tickInterval = magnitude * 5;
  const niceMax = Math.ceil(maxValue / tickInterval) * tickInterval;
  const ticks = [];
  if (tickInterval >= 1) {
    for (let i = 0; i <= niceMax; i += tickInterval) ticks.push(Math.round(i));
  } else {
    // Fractional interval: rounding to integers would duplicate ticks
    // (0,0,0,1,1). Keep decimal values, rounded to the interval's precision
    // to strip floating-point noise, and iterate by step count so the last
    // tick never gets lost to accumulated float error.
    const decimals = Math.min(6, Math.ceil(-Math.log10(tickInterval)) + 1);
    const steps = Math.round(niceMax / tickInterval);
    for (let s = 0; s <= steps; s++) ticks.push(Number((s * tickInterval).toFixed(decimals)));
  }
  return { min: 0, max: niceMax, ticks, tickInterval };
};
