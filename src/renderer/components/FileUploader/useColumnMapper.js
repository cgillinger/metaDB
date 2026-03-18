import { useState, useMemo } from 'react';
import Papa from 'papaparse';
import {
  FB_COLUMN_MAPPINGS,
  IG_COLUMN_MAPPINGS,
  DISPLAY_NAMES,
  findMatchingColumnKey,
  detectPlatform,
  getMappingsForPlatform
} from '@/utils/columnConfig';

/**
 * Hook för att hantera kolumnmappningar för CSV-data
 * Stöder både Facebook och Instagram genom plattformsdetektering
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
      return {
        isValid: false,
        missing: [],
        found: [],
        unknown: [],
        platform: null
      };
    }
  };

  /**
   * Validerar headers mot de hårdkodade mappningarna
   * Detekterar automatiskt plattform (Facebook eller Instagram)
   */
  const validateHeaders = (headers) => {
    if (!headers || !Array.isArray(headers)) {
      return {
        isValid: false,
        missing: [],
        found: [],
        unknown: [],
        platform: null
      };
    }

    const platform = detectPlatform(headers);
    if (!platform) {
      return {
        isValid: false,
        missing: [{
          original: 'Platform',
          internal: 'platform',
          displayName: 'Kunde inte identifiera plattform'
        }],
        found: [],
        unknown: headers,
        platform: null
      };
    }

    const mappings = getMappingsForPlatform(platform);
    const foundInternalNames = new Set();
    const missing = [];
    const found = [];
    const unknown = [];

    headers.forEach(header => {
      const internalName = findMatchingColumnKey(header, mappings);
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
    const requiredFields = new Set(Object.values(mappings));
    requiredFields.forEach(internalName => {
      if (!foundInternalNames.has(internalName)) {
        const originalName = Object.entries(mappings)
          .find(([_, internal]) => internal === internalName)?.[0];

        missing.push({
          original: originalName,
          internal: internalName,
          displayName: DISPLAY_NAMES[internalName]
        });
      }
    });

    setMissingColumns(missing);

    return {
      isValid: missing.length === 0,
      missing,
      found,
      unknown,
      platform
    };
  };

  return useMemo(() => ({
    validateHeaders,
    validateColumns,
    columnMappings: { ...FB_COLUMN_MAPPINGS, ...IG_COLUMN_MAPPINGS },
    displayNames: DISPLAY_NAMES,
    missingColumns,
    isLoading: false
  }), [missingColumns]);
}
