import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import {
  COLUMN_MAPPINGS,
  DISPLAY_NAMES,
  findMatchingColumnKey
} from '@/utils/columnConfig';

/**
 * Hook för att hantera kolumnmappningar för CSV-data
 * Använder hårdkodade mappningar från columnConfig.js
 */
export function useColumnMapper() {
  const [missingColumns, setMissingColumns] = useState([]);

  /**
   * Validerar CSV-innehåll mot de hårdkodade mappningarna
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
      return {
        isValid: false,
        missing: [],
        found: [],
        unknown: []
      };
    }
  };

  /**
   * Validerar headers mot de hårdkodade mappningarna
   */
  const validateHeaders = (headers) => {
    console.log('Validerar headers:', headers);

    if (!headers || !Array.isArray(headers)) {
      console.error('Ogiltiga headers:', headers);
      return {
        isValid: false,
        missing: [],
        found: [],
        unknown: []
      };
    }

    const foundInternalNames = new Set();
    const missing = [];
    const found = [];
    const unknown = [];

    headers.forEach(header => {
      const internalName = findMatchingColumnKey(header, COLUMN_MAPPINGS);
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

    // Hitta saknade obligatoriska fält
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

    setMissingColumns(missing);

    console.log('Valideringsresultat:', {
      hittadeKolumner: found.map(f => f.internalName),
      saknadKolumner: missing.map(m => m.internal),
      isValid: missing.length === 0
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
    missingColumns,
    isLoading: false
  }), [missingColumns]);
}
