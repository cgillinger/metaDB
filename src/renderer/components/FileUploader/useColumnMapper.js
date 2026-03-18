import { useMemo } from 'react';
import Papa from 'papaparse';
import { COLUMN_MAPPINGS, DISPLAY_NAMES, normalizeText, findMatchingColumnKey } from '@/utils/columnConfig';

/**
 * Hook för att validera CSV-kolumner mot hårdkodade Instagram-mappningar
 */
export function useColumnMapper() {
  /**
   * Validerar CSV-innehåll mot hårdkodade mappningar
   */
  const validateColumns = (csvContent) => {
    try {
      const result = Papa.parse(csvContent, {
        header: true,
        preview: 1,
        skipEmptyLines: true
      });

      if (!result.meta || !result.meta.fields) {
        throw new Error('Kunde inte läsa kolumnnamn från CSV');
      }

      return validateHeaders(result.meta.fields);
    } catch (error) {
      console.error('Fel vid validering av CSV:', error);
      return { isValid: false, missing: [], found: [], unknown: [] };
    }
  };

  /**
   * Validerar headers mot hårdkodade mappningar
   */
  const validateHeaders = (headers) => {
    if (!headers || !Array.isArray(headers)) {
      return { isValid: false, missing: [], found: [], unknown: [] };
    }

    const foundInternalNames = new Set();
    const missing = [];
    const found = [];
    const unknown = [];

    headers.forEach(header => {
      const internalName = findMatchingColumnKey(header);
      if (internalName) {
        foundInternalNames.add(internalName);
        found.push({
          header,
          internalName,
          displayName: DISPLAY_NAMES[internalName]
        });
      } else {
        unknown.push(header);
      }
    });

    const requiredFields = new Set(Object.values(COLUMN_MAPPINGS));
    requiredFields.forEach(internalName => {
      if (!foundInternalNames.has(internalName)) {
        const originalName = Object.entries(COLUMN_MAPPINGS)
          .find(([_, internal]) => internal === internalName)?.[0];
        missing.push({
          original: originalName,
          internal: internalName,
          displayName: DISPLAY_NAMES[internalName]
        });
      }
    });

    return {
      isValid: missing.length === 0,
      missing,
      found,
      unknown
    };
  };

  return useMemo(() => ({
    validateHeaders,
    validateColumns,
    columnMappings: COLUMN_MAPPINGS,
    displayNames: DISPLAY_NAMES,
    missingColumns: [],
    isLoading: false
  }), []);
}
