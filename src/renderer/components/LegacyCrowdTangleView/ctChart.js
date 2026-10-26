/**
 * ctChart.js — pure helpers for the Legacy CrowdTangle chart (no React, no DOM).
 */

export const CT_SOURCE_LABEL = { crowdtangle: 'CrowdTangle', metadb: 'metaDB' };

const MONTH_NAMES_SV = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** 'YYYY-MM' → 'mars 2019' */
export function ctMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES_SV[m - 1]} ${y}`;
}

/** Y axis from 0 to a rounded-up max with ~5 ticks. Ignores null/undefined values. */
export function niceYAxis(values) {
  const max = Math.max(0, ...(values || []).filter(v => typeof v === 'number'));
  if (max === 0) return { max: 1, ticks: [0, 1] };
  const rough = max / 5;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(f => f * pow).find(s => s >= rough);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(Math.round(t));
  return { max: top, ticks };
}

/**
 * Line segments between neighbouring months that both have a value. A gap
 * (null) breaks the line, so nothing is drawn across missing months. The
 * segment takes the source of its right-hand point.
 */
export function ctSegments(points) {
  const segs = [];
  for (let i = 1; i < (points || []).length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.y !== null && b.y !== null) segs.push({ a, b, source: b.d.source });
  }
  return segs;
}

/** Tooltip source text for the yearly view. */
export const CT_YEAR_SOURCE_LABEL = {
  metadb: 'metaDB',
  crowdtangle_months: 'CrowdTangle, summa av 12 månader',
  crowdtangle_year: 'CrowdTangle, helårsexport',
};

/** True for every CrowdTangle-sourced point (drawn dashed and faded). */
export const isCtYearSource = (source) => source === 'crowdtangle_months' || source === 'crowdtangle_year';

/** Year tick label; the current year is marked as year-to-date when partial. */
export function ctYearLabel(year, partial) {
  return partial ? `${year} (hittills i år)` : String(year);
}

/** ['2024-07', '2024-11'] → 'juli och november 2024' (months must share a year or are listed with years). */
export function ctMissingMonthsText(months) {
  const list = months || [];
  const years = new Set(list.map(m => m.slice(0, 4)));
  const names = list.map(m => (years.size === 1 ? MONTH_NAMES_SV[Number(m.slice(5)) - 1] : ctMonthLabel(m)));
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} och ${names.at(-1)}` : (names[0] ?? '');
  return years.size === 1 ? `${joined} ${[...years][0]}` : joined;
}

/** Tooltip lines for a yearly point: partial and/or missing months, in that order. */
export function ctYearNotes(d) {
  const notes = [];
  if (d?.incomplete && d.missing_months?.length) notes.push(`Ofullständigt: saknar data för ${ctMissingMonthsText(d.missing_months)}`);
  if (d?.partial) notes.push('Ofullständigt: hittills i år');
  return notes;
}

/** Legend entries: one per selected account, in series order; greyed when it has no value in the range. */
export function ctLegendEntries(lines) {
  return (lines || []).map(l => ({
    key: l.account_key, name: l.account_name, color: l.color,
    empty: !l.data.some(d => d.value !== null && d.value !== undefined),
  }));
}

/** Selected accounts first (keeping the given order inside both groups). */
export function selectedFirst(accounts, selected) {
  const on = new Set(selected);
  return [...accounts.filter(a => on.has(a.account_key)), ...accounts.filter(a => !on.has(a.account_key))];
}
