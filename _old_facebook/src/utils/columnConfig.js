/**
 * Hårdkodade kolumnmappningar för Facebook CSV-filer
 *
 * Mappar svenska kolumnnamn från Meta Business Suite till interna fältnamn.
 * Om Meta ändrar kolumnnamn, uppdatera mappningen här.
 */

// Mappning från CSV-kolumnnamn till interna fältnamn
export const COLUMN_MAPPINGS = {
  "Publicerings-id": "post_id",
  "Sid-id": "account_id",
  "Sidnamn": "account_name",
  "Titel": "description",
  "Publiceringstid": "publish_time",
  "Inläggstyp": "post_type",
  "Permalänk": "permalink",
  "Visningar": "views",
  "Räckvidd": "reach",
  "Reaktioner, kommentarer och delningar": "total_engagement",
  "Reaktioner": "likes",
  "Kommentarer": "comments",
  "Delningar": "shares",
  "Totalt antal klick": "total_clicks",
  "Länkklick": "link_clicks",
  "Övriga klick": "other_clicks"
};

// Bakåtkompatibilitet - gamla fältnamn -> nya fältnamn
export const FIELD_ALIASES = {
  'page_id': 'account_id',
  'page_name': 'account_name',
  'reactions': 'likes',
  'engagement_total': 'total_engagement',
  'post_reach': 'reach',
  'impressions': 'views'
};

// Visningsnamn för fält i UI
export const DISPLAY_NAMES = {
  'post_id': 'Inläggs-ID',
  'account_id': 'Sido-ID',
  'account_name': 'Sidnamn',
  'account_username': 'Sidkonto',
  'description': 'Beskrivning',
  'publish_time': 'Publiceringstid',
  'post_type': 'Typ',
  'permalink': 'Länk',
  'views': 'Sidvisningar',
  'reach': 'Räckvidd',
  'average_reach': 'Genomsnittlig räckvidd',
  'total_engagement': 'Interaktioner',
  'likes': 'Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'other_clicks': 'Övriga klick',
  'link_clicks': 'Länkklick'
};

/**
 * Normaliserar text för konsistent jämförelse
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
 * Hämtar värde från dataobjekt via internt fältnamn
 * Stöder direktåtkomst, FIELD_ALIASES och normaliserad sökning
 */
export function getValue(dataObject, targetField) {
  if (!dataObject || !targetField) return null;

  // Direkt åtkomst
  if (dataObject[targetField] !== undefined) {
    return dataObject[targetField];
  }

  // Sök via FIELD_ALIASES (gammalt fältnamn -> nytt)
  for (const [oldField, newField] of Object.entries(FIELD_ALIASES)) {
    if (newField === targetField && dataObject[oldField] !== undefined) {
      return dataObject[oldField];
    }
  }

  // Sök via FIELD_ALIASES (om targetField är ett gammalt namn)
  const alias = FIELD_ALIASES[targetField];
  if (alias && dataObject[alias] !== undefined) {
    return dataObject[alias];
  }

  // Normaliserad sökning som sista utväg
  const normalizedTarget = normalizeText(targetField);
  for (const [key, value] of Object.entries(dataObject)) {
    if (normalizeText(key) === normalizedTarget) {
      return value;
    }
  }

  return null;
}

/**
 * Hitta matchning mellan ett kolumnnamn och ett internt fältnamn
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
 * Formaterar värden för visning i UI
 */
export function formatValue(value) {
  if (value === null || value === undefined) return 'Saknas';
  if (value === 0) return '0';
  if (typeof value === 'number') return value.toLocaleString();
  return value || '-';
}

/**
 * Formaterar datum för visning
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
    console.error('Error formatting date:', error);
    return dateStr;
  }
}
