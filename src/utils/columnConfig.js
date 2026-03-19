/**
 * Unified Column Config for Meta Analytics
 *
 * Maps Swedish CSV column names from Meta Business Suite to internal field names.
 * Supports both Facebook and Instagram CSV formats with normalized field names.
 *
 * Key normalization decisions:
 * - "Räckvidd" → reach (both platforms)
 * - "Reaktioner, kommentarer och delningar" → interactions (FB)
 * - likes + comments + shares → interactions (IG, calculated)
 * - FB Meta "Engagemang" concept → engagement (interactions + clicks for FB)
 * - IG engagement_total_extended → engagement (likes+comments+shares+saves+follows for IG)
 */

// Facebook CSV column mappings
export const FB_COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Sid-id": "account_id",
  "Sidnamn": "account_name",
  "Titel": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "reach",
  "Reaktioner, kommentarer och delningar": "interactions",
  "Reaktioner": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Totalt antal klick": "total_clicks",
  "Länkklick": "link_clicks",
  "Övriga klick": "other_clicks"
};

// Instagram CSV column mappings
export const IG_COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Konto-id": "account_id",
  "Kontots användarnamn": "account_username",
  "Kontonamn": "account_name",
  "Beskrivning": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "reach",
  "Gilla-markeringar": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Följer": "follows",
  "Sparade objekt": "saves"
};

// Display names for UI (Swedish)
export const DISPLAY_NAMES = {
  'post_id': 'Publicerings-ID',
  'account_id': 'Konto-ID',
  'account_name': 'Kontonamn',
  'account_username': 'Användarnamn',
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'post_type': 'Typ',
  'permalink': 'Länk',
  'views': 'Visningar',
  'reach': 'Räckvidd',
  'average_reach': 'Genomsnittlig räckvidd',
  'interactions': 'Interaktioner',
  'engagement': 'Engagemang',
  'likes': 'Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'total_clicks': 'Totalt antal klick',
  'other_clicks': 'Övriga klick',
  'link_clicks': 'Länkklick',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

// Info tooltips explaining what engagement means per platform
export const ENGAGEMENT_INFO = {
  facebook: 'Engagemang enligt Meta: reaktioner, kommentarer, delningar och klick',
  instagram: 'Engagemang: gilla, kommentarer, delningar, sparade och följare'
};

export const INTERACTIONS_INFO = {
  facebook: 'Interaktioner: reaktioner + kommentarer + delningar',
  instagram: 'Interaktioner: gilla-markeringar + kommentarer + delningar'
};

/**
 * Detect platform from CSV headers
 * Returns 'facebook', 'instagram', or null
 */
export function detectPlatform(headers) {
  if (!headers || !Array.isArray(headers)) return null;
  const headerSet = new Set(headers.map(h => normalizeText(h)));

  // Facebook-specific columns
  if (headerSet.has(normalizeText('Sid-id')) || headerSet.has(normalizeText('Sidnamn'))) {
    return 'facebook';
  }
  // Instagram-specific columns
  if (headerSet.has(normalizeText('Konto-id')) || headerSet.has(normalizeText('Kontots användarnamn'))) {
    return 'instagram';
  }
  return null;
}

/**
 * Get column mappings for a detected platform
 */
export function getMappingsForPlatform(platform) {
  if (platform === 'facebook') return FB_COLUMN_MAPPINGS;
  if (platform === 'instagram') return IG_COLUMN_MAPPINGS;
  return { ...FB_COLUMN_MAPPINGS, ...IG_COLUMN_MAPPINGS };
}

/**
 * Normalize text for consistent comparison
 */
export function normalizeText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * Safe parsing of numeric values
 */
export function safeParseValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
    const numValue = parseFloat(value);
    return isNaN(numValue) ? value : numValue;
  }
  return value;
}

/**
 * Find matching internal field name for a CSV column name
 */
export function findMatchingColumnKey(columnName, mappings) {
  if (!columnName || !mappings) return null;
  const normalizedColumnName = normalizeText(columnName);
  for (const [original, internal] of Object.entries(mappings)) {
    if (normalizeText(original) === normalizedColumnName) {
      return internal;
    }
  }
  return null;
}

/**
 * Get field value from a data object, with calculated field support
 */
export function getValue(dataObject, targetField) {
  if (!dataObject || !targetField) return null;

  // Direct access
  if (dataObject[targetField] !== undefined) {
    return dataObject[targetField];
  }

  // Calculate interactions if not stored directly
  if (targetField === 'interactions') {
    const likes = safeParseValue(dataObject.likes) || 0;
    const comments = safeParseValue(dataObject.comments) || 0;
    const shares = safeParseValue(dataObject.shares) || 0;
    return likes + comments + shares;
  }

  // Calculate engagement based on platform
  if (targetField === 'engagement') {
    const platform = dataObject._platform;
    const likes = safeParseValue(dataObject.likes) || 0;
    const comments = safeParseValue(dataObject.comments) || 0;
    const shares = safeParseValue(dataObject.shares) || 0;

    if (platform === 'facebook') {
      // FB engagement = interactions + clicks
      const totalClicks = safeParseValue(dataObject.total_clicks) || 0;
      return likes + comments + shares + totalClicks;
    } else {
      // IG engagement = likes + comments + shares + saves + follows
      const saves = safeParseValue(dataObject.saves) || 0;
      const follows = safeParseValue(dataObject.follows) || 0;
      return likes + comments + shares + saves + follows;
    }
  }

  // All our data uses exact field names after CSV mapping.
  // If we get here, the field genuinely doesn't exist.
  return null;
}

/**
 * Format values for display in UI
 */
export function formatValue(value) {
  if (value === null || value === undefined) return 'Saknas';
  if (value === 0) return '0';
  if (typeof value === 'number') return value.toLocaleString('sv-SE');
  return value || '-';
}

/**
 * Format date for display
 */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return dateStr;
  }
}
