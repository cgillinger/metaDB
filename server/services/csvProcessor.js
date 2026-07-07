import Papa from 'papaparse';
import { resolveAccountFromPermalink } from './permalinkResolver.js';
import {
  detectPlatform,
  getMappingsForPlatform,
  normalizeText,
  parseTikTokVideoUrl,
} from '../../shared/columnConfig.js';

// Intl.DateTimeFormat construction is the expensive part of the Intl API, so
// cache one formatter per time zone. Only two fixed zones are ever used here,
// but an import can call zoneWallClockAsUtcMs thousands of times per run.
const zoneFormatters = new Map();
function zoneFormatter(timeZone) {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    zoneFormatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Format an instant (ms since epoch) as wall-clock components in a time zone,
 * re-encoded as a UTC timestamp. Used to derive the zone's UTC offset without
 * depending on the process time zone.
 */
function zoneWallClockAsUtcMs(ms, timeZone) {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const o = {};
  for (const part of parts) o[part.type] = part.value;
  const hour = o.hour === '24' ? '00' : o.hour;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +hour, +o.minute, +o.second);
}

/**
 * Convert a Pacific Time datetime string to Stockholm time (Europe/Stockholm).
 * Meta CSV exports use PST/PDT. We store Stockholm time in the database.
 *
 * Must be independent of the process time zone: the wall-clock components are
 * parsed manually and anchored via Date.UTC, never via `new Date(string)`
 * (which parses in local time and made re-imports shift posts between months
 * depending on the importing machine's TZ).
 */
function convertPacificToStockholm(dateStr) {
  if (!dateStr) return null;
  try {
    const m = String(dateStr).trim().replace(/\//g, '-')
      .match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return dateStr;
    const [, y, mo, d, h, mi, s = '0'] = m;

    // The input wall clock, encoded as a UTC timestamp (TZ-independent anchor)
    const wallMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);

    // Pacific offset (utc - wall) — two passes so DST transitions between the
    // wall-clock anchor and the actual instant resolve correctly
    const guess = wallMs + (wallMs - zoneWallClockAsUtcMs(wallMs, 'America/Los_Angeles'));
    const actualUtcMs = wallMs + (guess - zoneWallClockAsUtcMs(guess, 'America/Los_Angeles'));

    // Format that instant as Stockholm wall clock
    const sthlmMs = zoneWallClockAsUtcMs(actualUtcMs, 'Europe/Stockholm');
    const iso = new Date(sthlmMs).toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  } catch {
    return dateStr;
  }
}

/**
 * Strip HTML-significant characters from free-text fields imported from CSV.
 * Prevents stored XSS if values are ever rendered without escaping.
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, '');
}

/**
 * Map a single raw CSV row to internal field names using column mappings.
 */
function mapRow(rawRow, columnMappings, platform) {
  const mapped = {};

  for (const [originalCol, value] of Object.entries(rawRow)) {
    const normalizedCol = normalizeText(originalCol);
    let internalName = null;
    for (const [mapKey, mapValue] of Object.entries(columnMappings)) {
      if (normalizeText(mapKey) === normalizedCol) {
        internalName = mapValue;
        break;
      }
    }
    const key = internalName || originalCol;
    // First-non-empty-wins: skip overwriting a valid mapped value with null/empty.
    // Handles CSVs with duplicate SV+EN columns where the English column may be
    // empty (null via dynamicTyping).
    if (internalName && key in mapped && mapped[key] != null && mapped[key] !== '') {
      if (value == null || value === '') continue;
    }
    mapped[key] = value;
  }

  // Fallback for account fields that sometimes appear in English
  if (!mapped.account_id || mapped.account_id === '') {
    const fallback = mapped['Account ID'] || rawRow['Account ID'];
    if (fallback) mapped.account_id = fallback;
  }
  if (!mapped.account_name || mapped.account_name === '') {
    const fallback = mapped['Account name'] || rawRow['Account name'];
    if (fallback) mapped.account_name = fallback;
  }
  if (!mapped.account_username || mapped.account_username === '') {
    const fallback = mapped['Account username'] || rawRow['Account username'];
    if (fallback) mapped.account_username = fallback;
  }

  // Facebook: ensure description from Titel
  if (platform === 'facebook' && mapped.description === undefined && rawRow['Titel'] !== undefined) {
    mapped.description = rawRow['Titel'];
  }

  return mapped;
}

/**
 * Parse a CSV buffer/string and return structured post data.
 * Returns { platform, month, posts[], stats }.
 */
/**
 * @param {string} csvContent
 * @param {string} filename
 * @param {{slugMap?: Map, overrides?: object}} [opts] - permalink-based account
 *        resolution for rows with empty Sidnamn (self-healing import). See
 *        services/permalinkResolver.js. Without a slugMap, no resolution is attempted.
 */
export function parseCSV(csvContent, filename, opts = {}) {
  const result = Papa.parse(csvContent, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (!result.data || result.data.length === 0) {
    throw new Error('Ingen data hittades i CSV-filen.');
  }

  const headers = Object.keys(result.data[0]);
  const platform = detectPlatform(headers);

  if (!platform) {
    throw new Error('Kunde inte identifiera plattform (Facebook eller Instagram) från CSV-kolumnerna.');
  }

  const columnMappings = getMappingsForPlatform(platform);
  const posts = [];
  const dates = [];

  for (const rawRow of result.data) {
    const mapped = mapRow(rawRow, columnMappings, platform);

    if (platform === 'tiktok') {
      // TikTok-tider exporteras redan i kontots lokala tidszon (Stockholm för SR-konton).
      // Konvertera bara slash → dash så Date.parse fungerar: "2026/04/30 15:25:02" → "2026-04-30 15:25:02".
      if (mapped.publish_time) {
        mapped.publish_time = String(mapped.publish_time).replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3');
      }
    } else if (mapped.publish_time) {
      // FB/IG: Meta exporterar i Pacific Time → konvertera till Stockholm.
      mapped.publish_time = convertPacificToStockholm(String(mapped.publish_time));
    }

    // TikTok: extrahera handle + post_id ur Videolänk-URL. Permalink är kanonisk identifierare.
    if (platform === 'tiktok' && mapped.permalink) {
      const parsed = parseTikTokVideoUrl(String(mapped.permalink));
      if (parsed) {
        if (!mapped.post_id) mapped.post_id = parsed.post_id;
        if (!mapped.account_username) mapped.account_username = parsed.handle;
      }
    }

    // Parse numeric values
    const safeInt = (v) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : n;
    };

    const likes = safeInt(mapped.likes);
    const comments = safeInt(mapped.comments);
    const shares = safeInt(mapped.shares);
    const interactions = likes + comments + shares;

    let engagement;
    if (platform === 'facebook') {
      const totalClicks = safeInt(mapped.total_clicks);
      engagement = interactions + totalClicks;
    } else if (platform === 'tiktok') {
      // TikTok per-inlägg: gilla + kommentarer + delningar + favoriter (saves).
      // Inga "follows" per inlägg på TikTok — det är ett kontomått i Översikt-CSV.
      const saves = safeInt(mapped.saves);
      engagement = interactions + saves;
    } else {
      const saves = safeInt(mapped.saves);
      const follows = safeInt(mapped.follows);
      engagement = interactions + saves + follows;
    }

    // Normalize English post type names to Swedish
    const POST_TYPE_MAP = {
      'Photos': 'Foton', 'Photo': 'Foton',
      'Videos': 'Videor', 'Video': 'Videor',
      'Links': 'Länkar', 'Link': 'Länkar',
      'Text': 'Status', 'Live': 'Live',
    };
    let normalizedType;
    if (platform === 'tiktok') {
      // TikTok-CSV saknar typkolumn — alla inlägg är videor per definition.
      normalizedType = 'Videor';
    } else {
      const rawType = mapped.post_type || null;
      normalizedType = rawType && POST_TYPE_MAP[rawType] ? POST_TYPE_MAP[rawType] : rawType;
    }

    // Collect date for month derivation. publish_time is a Stockholm wall-clock
    // string at this point — use it directly instead of round-tripping through
    // Date (which is TZ-dependent and shifted range/month at month boundaries).
    if (mapped.publish_time) {
      const dm = String(mapped.publish_time).match(/^(\d{4}-\d{2}-\d{2})/);
      if (dm) dates.push(dm[1]);
    }

    posts.push({
      post_id: String(mapped.post_id || ''),
      account_id: mapped.account_id ? String(mapped.account_id) : null,
      account_name:     sanitizeText(mapped.account_name || null),
      account_username: sanitizeText(mapped.account_username || null),
      description:      sanitizeText(mapped.description || null),
      publish_time: mapped.publish_time || null,
      post_type: normalizedType,
      permalink: mapped.permalink || null,
      platform,
      views: safeInt(mapped.views),
      reach: safeInt(mapped.reach),
      likes,
      comments,
      shares,
      total_clicks: safeInt(mapped.total_clicks),
      link_clicks: safeInt(mapped.link_clicks),
      other_clicks: safeInt(mapped.other_clicks),
      saves: safeInt(mapped.saves),
      follows: safeInt(mapped.follows),
      interactions,
      engagement,
    });
  }

  // --- Deduplicate by post_id: keep the row with highest interactions ---
  const postMap = new Map();
  let dupCount = 0;
  for (const post of posts) {
    if (!post.post_id) continue;
    const existing = postMap.get(post.post_id);
    if (existing) {
      dupCount++;
      if (post.interactions > existing.interactions) {
        postMap.set(post.post_id, post);
      }
    } else {
      postMap.set(post.post_id, post);
    }
  }
  const dedupedPosts = [...postMap.values()];
  const noIdPosts = posts.filter(p => !p.post_id);
  const finalPosts = [...dedupedPosts, ...noIdPosts];

  // Self-healing: rows where Meta exported an empty Sidnamn but a permalink is present
  // get their account derived from the permalink's page handle (shared resolver +
  // optional override map). Order: existing name → DB slug-map → override → leave empty.
  // Generic/denylisted URL segments never attribute — leave empty (export-guarded).
  let attributedViaPermalink = 0;
  if (opts.slugMap) {
    for (const p of finalPosts) {
      if (p.account_name && p.account_name !== '') continue;
      if (!p.permalink) continue;
      const res = resolveAccountFromPermalink(p, opts.slugMap, opts.overrides || {});
      if (res && res.account_name) {
        p.account_name = res.account_name;
        if (!p.account_id && res.account_id) p.account_id = String(res.account_id);
        attributedViaPermalink++;
      }
    }
  }

  // Derive month from post dates
  let month = 'unknown';
  let dateRangeStart = null;
  let dateRangeEnd = null;

  if (dates.length > 0) {
    // 'YYYY-MM-DD' strings sort lexicographically = chronologically
    dates.sort();
    dateRangeStart = dates[0];
    dateRangeEnd = dates[dates.length - 1];

    // Use the most common month among the posts
    const monthCounts = {};
    for (const d of dates) {
      const m = d.slice(0, 7);
      monthCounts[m] = (monthCounts[m] || 0) + 1;
    }
    month = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Count unique accounts
  const uniqueAccounts = new Set(
    finalPosts.map(p => p.account_id).filter(Boolean)
  );

  return {
    platform,
    month,
    dateRangeStart,
    dateRangeEnd,
    posts: finalPosts,
    stats: {
      totalRows: result.data.length,
      parsedPosts: finalPosts.length,
      duplicatesRemoved: dupCount,
      accountCount: uniqueAccounts.size || 1,
      attributedViaPermalink,
    },
  };
}
