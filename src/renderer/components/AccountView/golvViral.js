// Rena funktioner för golvanalys och viralitet.
// Inga React-/UI-/alias-imports – kan köras direkt av node:test.

export const VIRAL_PARAMS = {
  FB: { bas: 85000, k: 4.2 },
  IG: { bas: 40000, k: 4.2 },
};

export const TUNT = { minPoster: 20, minVeckor: 6 };

export const VIRAL_SHARE_HIGH = 0.40; // viralandel >= detta ≈ "bygger på viraler"

export const MIN_PEERS = 5; // minst antal jämförbara konton för golvnivå-klassning

// Golvband via percentil mot jämförbara kontons golv. Topp-tredjedel = högt,
// botten-tredjedel = lågt, mitten = normalt. Höjer ribban för "högt" så att inte
// halva fältet (allt över medianen) automatiskt kvalificerar.
export const FLOOR_HIGH_PCT = 0.66;
export const FLOOR_LOW_PCT = 0.34;

// Kadens = inlägg/dag (inte totalt antal, så en lång period inte "fuskar" förbi).
// Under MIN går golvet inte att bedöma (räckvidden styrs av enstaka inlägg);
// vid NORMAL+ delas de positiva omdömena ut fullt ut, däremellan hedgas de.
export const CADENCE_MIN = 0.3;     // ≲ 2 inlägg/vecka → för glest för ett golv
export const CADENCE_NORMAL = 1.0;  // ≥ 1 inlägg/dag → uthållig produktion

// Intern hjälpfunktion: beräknar ISO-år och ISO-veckonummer (ISO-8601).
function isoWeekParts(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;        // Mån=0 ... Sön=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);  // flytta till veckans torsdag
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
  const isoWeek = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return { isoYear: date.getUTCFullYear(), isoWeek };
}

/**
 * Median av en numerisk array.
 * Tom array → 0. Vid jämnt antal: medel av de två mittersta.
 */
export function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median av alla posters reach (ALLA posttyper poolade).
 * Tom → 0.
 */
export function periodMedian(posts) {
  if (!posts || posts.length === 0) return 0;
  return median(posts.map((p) => p.reach));
}

/**
 * Grupperar poster per ISO-vecka och returnerar array sorterad STIGANDE efter veckans datum.
 * Hoppar över poster med ogiltigt publish_time.
 */
export function weeklyFloor(posts) {
  if (!posts || posts.length === 0) return [];

  // Bygg upp en map: weekKey → { isoYear, isoWeek, weekKey, reachArr, earliestMs }
  const map = new Map();

  for (const post of posts) {
    const d = new Date(post.publish_time);
    if (isNaN(d.getTime())) continue;

    const { isoYear, isoWeek } = isoWeekParts(d);
    const weekKey = `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
    const ms = d.getTime();

    if (!map.has(weekKey)) {
      map.set(weekKey, {
        isoYear,
        isoWeek,
        weekKey,
        reachArr: [],
        earliestMs: ms,
      });
    }
    const entry = map.get(weekKey);
    entry.reachArr.push(post.reach);
    if (ms < entry.earliestMs) {
      entry.earliestMs = ms;
    }
  }

  // Bygg resultatarray och sortera stigande efter veckans datum (earliestMs).
  const result = [];
  for (const entry of map.values()) {
    result.push({
      isoYear: entry.isoYear,
      isoWeek: entry.isoWeek,
      weekKey: entry.weekKey,
      median: median(entry.reachArr),
      date: entry.earliestMs,
      count: entry.reachArr.length,
    });
  }

  result.sort((a, b) => a.date - b.date);
  return result;
}

/**
 * Additiv tröskel: params.bas + params.k * median.
 */
export function viralThreshold(med, params) {
  return params.bas + params.k * med;
}

/**
 * Returnerar true om post.reach >= viralThreshold(median, params).
 * Gränsfall reach == tröskeln räknas som VIRAL.
 */
export function isViral(post, med, params) {
  return post.reach >= viralThreshold(med, params);
}

/**
 * Returnerar { n, weeks, thin, message }.
 */
export function reliability(posts, tunt = TUNT) {
  const n = posts ? posts.length : 0;

  // Räkna distinkta ISO-veckor med ≥1 inlägg.
  const weekSet = new Set();
  for (const post of (posts || [])) {
    const d = new Date(post.publish_time);
    if (isNaN(d.getTime())) continue;
    const { isoYear, isoWeek } = isoWeekParts(d);
    weekSet.add(`${isoYear}-W${String(isoWeek).padStart(2, '0')}`);
  }
  const weeks = weekSet.size;

  const thin = n < tunt.minPoster || weeks < tunt.minVeckor;
  const message = thin
    ? 'Få inlägg i vald period – golvet blir osäkert. Välj en längre period för en stabilare bild.'
    : null;

  return { n, weeks, thin, message };
}

/**
 * Andel av total reach som kommer från virala poster.
 * Inga poster eller total reach 0 → 0. Noll virala → 0.
 */
export function viralShare(posts, med, params) {
  if (!posts || posts.length === 0) return 0;
  const totalReach = posts.reduce((sum, p) => sum + p.reach, 0);
  if (totalReach === 0) return 0;
  const viralReach = posts
    .filter((p) => isViral(p, med, params))
    .reduce((sum, p) => sum + p.reach, 0);
  if (viralReach === 0) return 0;
  return viralReach / totalReach;
}

/**
 * Returnerar median(peerMedians) om peerMedians.length >= MIN_PEERS, annars null.
 */
export function peerMedianOfMedians(peerMedians) {
  if (!peerMedians || peerMedians.length < MIN_PEERS) return null;
  return median(peerMedians);
}

/**
 * Golvband via percentil mot jämförbara kontons golv (peerMedians-arrayen).
 * Returnerar 'högt' | 'normalt' | 'lågt', eller null om < MIN_PEERS jämförbara.
 *
 * 'högt'  = kontots golv slår minst FLOOR_HIGH_PCT av jämförbara konton.
 * 'lågt'  = slår högst FLOOR_LOW_PCT av dem.
 * 'normalt' = däremellan (i nivå med fältet).
 */
export function floorBand(accountMedian, peerMedians) {
  if (!peerMedians || peerMedians.length < MIN_PEERS) return null;
  const below = peerMedians.filter((m) => m < accountMedian).length;
  const pct = below / peerMedians.length;
  if (pct >= FLOOR_HIGH_PCT) return 'högt';
  if (pct <= FLOOR_LOW_PCT) return 'lågt';
  return 'normalt';
}

/**
 * Returnerar '↑' | '↓' | '→'.
 * Jämför golvets median i början mot slutet (tredjedelar).
 */
export function floorTrend(weeklyFloorArr) {
  if (!weeklyFloorArr || weeklyFloorArr.length < 2) return '→';
  const len = weeklyFloorArr.length;
  const third = Math.ceil(len / 3);

  const firstSlice = weeklyFloorArr.slice(0, third);
  const lastSlice = weeklyFloorArr.slice(len - third);

  const firstAvg = firstSlice.reduce((sum, w) => sum + w.median, 0) / firstSlice.length;
  const lastAvg = lastSlice.reduce((sum, w) => sum + w.median, 0) / lastSlice.length;

  if (lastAvg > firstAvg * 1.05) return '↑';
  if (lastAvg < firstAvg * 0.95) return '↓';
  return '→';
}

/**
 * Statustext utifrån golvband, viralandel och kadens (inlägg/dag).
 *
 * Kadensen är en faktor, inte en golvhöjare:
 *  - < cadenceMin       → spärr: golvet går inte att bedöma (oavsett band).
 *  - cadenceMin..normal → de positiva omdömena (högt golv) hedgas.
 *  - >= cadenceNormal   → fulla omdömen.
 * postsPerDay = null/undefined → kadens okänd, behandlas som normal (ingen spärr).
 *
 * Returnerar statussträng, eller null när golvet inte kan klassas (för få
 * jämförbara konton men tillräcklig kadens) – då visar anroparen egen text.
 */
export function statusVerdict(
  floorBandValue,
  viralShareValue,
  postsPerDay,
  {
    highShare = VIRAL_SHARE_HIGH,
    cadenceMin = CADENCE_MIN,
    cadenceNormal = CADENCE_NORMAL,
  } = {}
) {
  // Spärr: för gles publicering → inget golvomdöme, oavsett band.
  if (postsPerDay != null && postsPerDay < cadenceMin) {
    return 'För gles publicering för att bedöma golvet – räckvidden bygger på enstaka inlägg.';
  }
  if (floorBandValue == null) return null;

  const manyViral = viralShareValue >= highShare;
  const normalCadence = postsPerDay == null || postsPerDay >= cadenceNormal;

  if (floorBandValue === 'högt') {
    if (!manyViral) {
      return normalCadence
        ? 'Golvbyggt – levererar stabilt och brett, oberoende av viraler'
        : 'Lovande golv – högt, men för gles publicering för att vara säker';
    }
    return normalCadence
      ? 'Toppform – stark bas och stort genomslag'
      : 'Stort genomslag, men golvet vilar på få inlägg';
  }
  if (floorBandValue === 'normalt') {
    return manyViral
      ? 'Räckvidd med tydligt inslag av viraler – golvet i nivå med andra'
      : 'Stabilt golv – i nivå med liknande konton';
  }
  if (floorBandValue === 'lågt') {
    return manyViral
      ? 'Räckvidden vilar på enstaka viraler – ostadig bas'
      : 'Lägre golv än liknande konton – utrymme att lyfta basen';
  }
  return null;
}
