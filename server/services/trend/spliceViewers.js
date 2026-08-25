/**
 * trend/spliceViewers.js — skarvad "unika personer"-serie (en sanningskälla).
 *
 * Meta bytte mått i juni 2026: legacy reach (page_impressions_unique, fryst i
 * account_reach t.o.m. 2026-05) ersattes av viewers (page_total_media_view_unique,
 * account_viewers). Måtten är OLIKA definierade och slås aldrig ihop numeriskt —
 * den här modulen bygger enbart en VISUELL skarv av råvärden, där varje månad bär
 * med sig vilket mått värdet kom från så att UI:t kan rita brytpunkten.
 *
 * Inget skalas, viktas eller räknas om. Saknad månad blir null (hål i linjen),
 * aldrig 0 — en nolla skulle läsas som "noll personer nåddes".
 */

// 'YYYY-MM' → löpande månadsindex, för kalenderintilliggande jämförelser.
const monthOrdinal = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return y * 12 + mo;
};

/**
 * Första månaden i den AVSLUTANDE sammanhängande viewers-sviten (kalendermånader
 * utan lucka, räknat bakifrån). Det är där det nya måttet tagit över för gott.
 * @param {string[]} viewersMonths - sorterade 'YYYY-MM'
 * @returns {string|null}
 */
function trailingViewersRunStart(viewersMonths) {
  if (!viewersMonths.length) return null;
  let start = viewersMonths[viewersMonths.length - 1];
  for (let i = viewersMonths.length - 2; i >= 0; i--) {
    if (monthOrdinal(start) - monthOrdinal(viewersMonths[i]) !== 1) break;
    start = viewersMonths[i];
  }
  return start;
}

/**
 * Provenance-regel: viewers vinner alltid där viewers finns. Legacy bär linjen för
 * månader utan viewers FRAM TILL den avslutande viewers-sviten — så en månadsvis
 * backfill av viewers (som kan landa i godtycklig ordning och lämna luckor) aldrig
 * blankar legacy-historiken. Legacy-rader som dyker upp INUTI eller EFTER den
 * avslutande sviten (t.ex. en sen ombackfill) hamnar i `ghost`, aldrig i linjen —
 * annars kan kurvan växla tillbaka till den gamla måttdefinitionen efter bytet.
 *
 * @param {string[]} axis - månadsaxel 'YYYY-MM', sorterad
 * @param {Object<string, number>} legacyMap - { 'YYYY-MM': reach }
 * @param {Object<string, number>} viewersMap - { 'YYYY-MM': viewers }
 * @returns {{data: Array<{value: number|null, source: 'legacy'|'viewers'|null, ghost: number|null}>,
 *            breakpoint_month: string|null, splice_status: string,
 *            legacy_last_month: string|null, viewers_first_month: string|null,
 *            overlap_months: string[]}}
 */
export function spliceAccountSeries(axis, legacyMap, viewersMap) {
  const legacy = legacyMap || {};
  const viewers = viewersMap || {};
  const legacyMonths = Object.keys(legacy).sort();
  const viewersMonths = Object.keys(viewers).sort();

  const legacy_last_month = legacyMonths.length ? legacyMonths[legacyMonths.length - 1] : null;
  const viewers_first_month = viewersMonths.length ? viewersMonths[0] : null;
  const overlap_months = legacyMonths.filter(m => viewers[m] !== undefined);

  // Viewers always wins where it exists — the new measure is what counts going
  // forward, and legacy becomes the shadow.
  //
  // This rule must not depend on what the period filter happens to include. An
  // earlier version required a legacy month *before* the first viewers month,
  // which made a filtered view (e.g. 2026 only) silently fall back to legacy for
  // the overlap and draw it as one unmarked line — the exact mixing this metric
  // exists to prevent.
  //
  // Legacy-only months keep carrying the line up to the final contiguous viewers
  // run. An earlier version blanked every legacy-only month after the FIRST
  // viewers month, which meant a partial month-by-month backfill (one early month
  // landed, the rest not yet) collapsed years of legacy history into gaps.
  const switchMonth = trailingViewersRunStart(viewersMonths);
  const data = (axis || []).map(m => {
    const l = legacy[m];
    const v = viewers[m];

    if (v !== undefined) return { value: v, source: 'viewers', ghost: l ?? null };
    // From the final switch onward, a stray legacy row is shadow only — never a
    // continuation of the line, or the curve would flip back to the old measure.
    if (switchMonth !== null && m >= switchMonth) return { value: null, source: null, ghost: l ?? null };
    if (l !== undefined) return { value: l, source: 'legacy', ghost: null };
    return { value: null, source: null, ghost: null };
  });

  // Visual breakpoint: the month on THIS axis where the final viewers run takes
  // over from a legacy stretch. Backfilled viewers months before the switch never
  // move the marker. Null when the axis holds only one of the measures.
  let breakpoint_month = null;
  let sawLegacy = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i].source === 'legacy') { sawLegacy = true; continue; }
    if (data[i].source === 'viewers' && sawLegacy && switchMonth !== null && axis[i] >= switchMonth) {
      breakpoint_month = axis[i];
      break;
    }
  }

  let splice_status = 'empty';
  if (legacyMonths.length && viewersMonths.length) splice_status = 'spliced';
  else if (legacyMonths.length) splice_status = 'legacy_only';
  else if (viewersMonths.length) splice_status = 'viewers_only';

  return { data, breakpoint_month, splice_status, legacy_last_month, viewers_first_month, overlap_months };
}

/**
 * Montera hela svaret: unionen av konton och månader ur båda tabellerna.
 * @param {{axis: string[], legacyRows: Array, viewersRows: Array}} input
 *   rader har formen { period, account_name, value }
 */
export function buildSplicedSeries({ axis, legacyRows, viewersRows }) {
  const byAccount = {};
  const ensure = (name) => {
    if (!byAccount[name]) byAccount[name] = { legacy: {}, viewers: {} };
    return byAccount[name];
  };

  for (const row of legacyRows || []) ensure(row.account_name).legacy[row.period] = row.value;
  for (const row of viewersRows || []) ensure(row.account_name).viewers[row.period] = row.value;

  const series = Object.keys(byAccount)
    .sort((a, b) => a.localeCompare(b, 'sv'))
    .map(name => {
      const spliced = spliceAccountSeries(axis, byAccount[name].legacy, byAccount[name].viewers);
      return {
        account_id: name,
        account_name: name,
        platform: 'facebook',
        is_collab: false,
        ...spliced,
      };
    });

  return { months: axis, series };
}

/** Alla månader som förekommer i endera tabellen. */
export function collectMonths(legacyRows, viewersRows) {
  const set = new Set();
  for (const row of legacyRows || []) set.add(row.period);
  for (const row of viewersRows || []) set.add(row.period);
  return set;
}
