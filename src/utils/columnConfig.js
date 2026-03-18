/**
 * columnConfig.js
 *
 * Hårdkodade kolumnmappningar för Instagram-statistik-appen.
 * Mappar svenska CSV-kolumnnamn från Meta Business Suite till interna fältnamn.
 * Ingen caching, ingen localStorage, ingen editor-logik, ingen async.
 */

// Mappning: Svenska CSV-kolumnnamn → interna fältnamn
export const COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Konto-id": "account_id",
  "Kontots användarnamn": "account_username",
  "Kontonamn": "account_name",
  "Beskrivning": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "post_reach",
  "Gilla-markeringar": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Följer": "follows",
  "Sparade objekt": "saves"
};

// Svenska visningsnamn för interna fält
export const DISPLAY_NAMES = {
  'post_id': 'Post ID',
  'account_id': 'Konto-ID',
  'account_name': 'Kontonamn',
  'account_username': 'Användarnamn',
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'post_type': 'Typ',
  'permalink': 'Länk',
  'views': 'Visningar',
  'post_reach': 'Räckvidd',
  'average_reach': 'Genomsnittlig räckvidd',
  'engagement_total': 'Interaktioner',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

/**
 * Normalisera text för konsistent jämförelse
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
 * Säker parsning av numeriska värden
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
 * Hitta matchande internt fältnamn för ett CSV-kolumnnamn
 */
export function findMatchingColumnKey(columnName) {
  if (!columnName) return null;
  const normalizedColumnName = normalizeText(columnName);
  for (const [original, internal] of Object.entries(COLUMN_MAPPINGS)) {
    if (normalizeText(original) === normalizedColumnName) {
      return internal;
    }
  }
  return null;
}

/**
 * Hjälpfunktion: hämtar värde för ett internt fältnamn från ett dataobjekt
 */
export function getFieldValue(dataObject, fieldName) {
  if (!dataObject) return null;

  // 1. Direkt åtkomst
  if (dataObject[fieldName] !== undefined) {
    return safeParseValue(dataObject[fieldName]);
  }

  // 2. Sök via mappning (inverst: internt → original CSV-namn)
  for (const [original, internal] of Object.entries(COLUMN_MAPPINGS)) {
    if (internal === fieldName && dataObject[original] !== undefined) {
      return safeParseValue(dataObject[original]);
    }
  }

  // 3. Normaliserad sökning
  const normalizedFieldName = normalizeText(fieldName);
  for (const [key, value] of Object.entries(dataObject)) {
    if (normalizeText(key) === normalizedFieldName) {
      return safeParseValue(value);
    }
  }

  return null;
}

/**
 * Central funktion för att hämta värden från ett dataobjekt.
 * Hanterar specialfall för engagement_total och engagement_total_extended.
 */
export function getValue(dataObject, targetField) {
  if (!dataObject || !targetField) return null;

  if (dataObject[targetField] !== undefined) {
    return dataObject[targetField];
  }

  if (targetField === 'engagement_total') {
    const likes = getFieldValue(dataObject, 'likes') || 0;
    const comments = getFieldValue(dataObject, 'comments') || 0;
    const shares = getFieldValue(dataObject, 'shares') || 0;
    return likes + comments + shares;
  }

  if (targetField === 'engagement_total_extended') {
    const likes = getFieldValue(dataObject, 'likes') || 0;
    const comments = getFieldValue(dataObject, 'comments') || 0;
    const shares = getFieldValue(dataObject, 'shares') || 0;
    const saves = getFieldValue(dataObject, 'saves') || 0;
    const follows = getFieldValue(dataObject, 'follows') || 0;
    return likes + comments + shares + saves + follows;
  }

  return getFieldValue(dataObject, targetField);
}

/**
 * Formaterar värden för visning i UI
 */
export function formatValue(value) {
  if (value === null || value === undefined) return 'Saknas';
  if (value === 0) return '0';
  if (typeof value === 'number') return value.toLocaleString();
  return value || '-';
}

/**
 * Formaterar datum till svenskt format
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

// Alias for backward compatibility
export const DEFAULT_MAPPINGS = COLUMN_MAPPINGS;
