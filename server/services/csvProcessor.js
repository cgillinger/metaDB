import Papa from 'papaparse';
import {
  detectPlatform,
  getMappingsForPlatform,
  normalizeText,
} from '../../shared/columnConfig.js';

/**
 * Convert a Pacific Time datetime string to Stockholm time (Europe/Stockholm).
 * Meta CSV exports use PST/PDT. We store Stockholm time in the database.
 */
function convertPacificToStockholm(dateStr) {
  if (!dateStr) return null;
  try {
    // Parse the date string. Meta exports format: "2026-01-15 14:30:00" or similar
    // Treat it as Pacific Time by appending the timezone
    const pacificDate = new Date(dateStr);
    if (isNaN(pacificDate.getTime())) return dateStr;

    // Format in Pacific to get a proper date, then convert to Stockholm
    const pacificStr = pacificDate.toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
    const stockholmStr = pacificDate.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

    // We need to figure out the actual instant. The input IS in Pacific Time.
    // So we construct a Date that represents the Pacific interpretation.
    // Parse the input as if it's in Pacific Time:
    const parts = dateStr.replace(/[/]/g, '-').trim();

    // Try to create a date object assuming the string IS Pacific Time
    // by using Intl to figure out the UTC offset for Los Angeles at that date
    const naiveDate = new Date(parts);
    if (isNaN(naiveDate.getTime())) return dateStr;

    // Get the Pacific offset at this date (handles DST)
    const pacificFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    // Use a round-trip: format naiveDate as Pacific, then as Stockholm
    // Since naiveDate was parsed from the string (browser interprets as local/UTC),
    // we need to find the actual UTC instant where Pacific Time shows the given value.

    // Method: Use the difference between what the date shows in Pacific vs UTC
    const utcStr = naiveDate.toISOString();
    const pacificParts = pacificFormatter.formatToParts(naiveDate);
    const pacificObj = {};
    for (const part of pacificParts) {
      pacificObj[part.type] = part.value;
    }
    const pacificReconstructed = `${pacificObj.year}-${pacificObj.month}-${pacificObj.day}T${pacificObj.hour}:${pacificObj.minute}:${pacificObj.second}`;
    const naiveStr = naiveDate.toISOString().slice(0, 19);

    // The offset between UTC and Pacific at this moment
    const utcMs = new Date(naiveStr + 'Z').getTime();
    const pacificMs = new Date(pacificReconstructed + 'Z').getTime();
    const offsetMs = utcMs - pacificMs;

    // The input IS in Pacific, so the actual UTC instant is: input + offset
    const inputMs = naiveDate.getTime();
    // If naiveDate was parsed as UTC, inputMs is what we want to interpret as Pacific
    // Actual UTC = inputMs + offsetMs
    const actualUtcMs = inputMs + offsetMs;

    // Now format that UTC instant in Stockholm time
    const stockholmFormatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    const actualDate = new Date(actualUtcMs);
    const sthlmParts = stockholmFormatter.formatToParts(actualDate);
    const s = {};
    for (const part of sthlmParts) {
      s[part.type] = part.value;
    }

    return `${s.year}-${s.month}-${s.day} ${s.hour}:${s.minute}:${s.second}`;
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
    mapped[internalName || originalCol] = value;
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
export function parseCSV(csvContent, filename) {
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

    // Convert publish_time from Pacific to Stockholm
    if (mapped.publish_time) {
      mapped.publish_time = convertPacificToStockholm(String(mapped.publish_time));
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
    const rawType = mapped.post_type || null;
    const normalizedType = rawType && POST_TYPE_MAP[rawType] ? POST_TYPE_MAP[rawType] : rawType;

    // Collect date for month derivation
    if (mapped.publish_time) {
      const d = new Date(mapped.publish_time);
      if (!isNaN(d.getTime())) dates.push(d);
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

  // Derive month from post dates
  let month = 'unknown';
  let dateRangeStart = null;
  let dateRangeEnd = null;

  if (dates.length > 0) {
    dates.sort((a, b) => a - b);
    dateRangeStart = dates[0].toISOString().slice(0, 10);
    dateRangeEnd = dates[dates.length - 1].toISOString().slice(0, 10);

    // Use the most common month among the posts
    const monthCounts = {};
    for (const d of dates) {
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[m] = (monthCounts[m] || 0) + 1;
    }
    month = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Count unique accounts
  const uniqueAccounts = new Set(
    posts.map(p => p.account_id).filter(Boolean)
  );

  return {
    platform,
    month,
    dateRangeStart,
    dateRangeEnd,
    posts,
    stats: {
      totalRows: result.data.length,
      parsedPosts: posts.length,
      accountCount: uniqueAccounts.size || 1,
    },
  };
}
