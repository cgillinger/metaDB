/**
 * Memory Utilities
 * 
 * Verktyg för att övervaka och hantera minneanvändning i webbläsaren
 * när appen hanterar flera CSV-filer.
 */

// Konstantvärden för varningsnivåer
export const MEMORY_THRESHOLDS = {
  WARNING: 70, // 70% av tillgängligt minne
  CRITICAL: 90  // 90% av tillgängligt minne
};

// Standardvärden för lagringsstorlekar
const STORAGE_LIMITS = {
  LOCALSTORAGE: 5 * 1024 * 1024, // 5MB typisk localStorage-gräns
  INDEXEDDB: 200 * 1024 * 1024   // 200MB konservativ uppskattning för IndexedDB
};

/**
 * Beräknar storlek för JavaScript-objekt (ungefärlig)
 * @param {*} object - Objektet att beräkna storlek för
 * @returns {number} - Storlek i bytes
 */
export function calculateObjectSize(object) {
  if (object === null || object === undefined) return 0;
  
  // Om det är en sträng, returnera längden * 2 (approximation för UTF-16)
  if (typeof object === 'string') {
    return object.length * 2;
  }
  
  // För primitiva typer, returnera en standardstorlek
  if (typeof object !== 'object') {
    return 8;
  }
  
  // Använd JSON stringification för att uppskatta storlek för objekt
  // Detta är en förenklad uppskattning och inte 100% exakt
  try {
    const json = JSON.stringify(object);
    return json.length * 2; // Ungefärlig storlek för JSON-sträng i UTF-16
  } catch (e) {
    console.warn('Kunde inte beräkna objektstorlek:', e);
    return 0;
  }
}

/**
 * Beräknar aktuell minnesanvändning för lagrad data
 * @param {Array} fileMetadataList - Lista med info om uppladdade filer
 * @param {Array} postViewData - Inläggsdata
 * @param {Array} accountViewData - Kontodata
 * @returns {Object} - Information om minnesanvändning
 */
export function calculateMemoryUsage(fileMetadataList, postViewData, accountViewData) {
  // Beräkna storlek för varje datatyp
  const postViewSize = calculateObjectSize(postViewData);
  const accountViewSize = calculateObjectSize(accountViewData);
  const metadataSize = calculateObjectSize(fileMetadataList);
  
  // Total datamängd i bytes
  const totalDataSize = postViewSize + accountViewSize + metadataSize;
  
  // Uppskattad procent av localStorage använt (max 5MB)
  const localStoragePercent = Math.min(100, (accountViewSize / STORAGE_LIMITS.LOCALSTORAGE) * 100);
  
  // Uppskattad procent av IndexedDB använt (baserat på postViewData)
  const indexedDBPercent = Math.min(100, (postViewSize / STORAGE_LIMITS.INDEXEDDB) * 100);
  
  // Beräkna total procent (viktat genomsnitt baserat på var data lagras)
  const totalPercent = Math.max(localStoragePercent, indexedDBPercent);
  
  // Fastställ status baserat på tröskelvärden
  let status = 'safe';
  if (totalPercent >= MEMORY_THRESHOLDS.CRITICAL) {
    status = 'critical';
  } else if (totalPercent >= MEMORY_THRESHOLDS.WARNING) {
    status = 'warning';
  }
  
  return {
    totalSize: totalDataSize,
    totalSizeMB: (totalDataSize / (1024 * 1024)).toFixed(2),
    postViewSize,
    accountViewSize,
    metadataSize,
    percentUsed: totalPercent.toFixed(1),
    status,
    canAddMoreData: totalPercent < MEMORY_THRESHOLDS.CRITICAL,
    isNearLimit: totalPercent >= MEMORY_THRESHOLDS.WARNING
  };
}

/**
 * Beräknar uppskattad tillgänglig minneskapacitet 
 * @returns {Object} - Uppskattad kapacitet för olika lagringstyper
 */
export function estimateAvailableCapacity() {
  let localStorageAvailable = 0;
  
  // Testa tillgängligt localStorage (approximativt)
  try {
    const testKey = '_memory_test_';
    const step = 250 * 1024; // 250KB per steg
    let testData = '';
    let maxIterations = 20; // Max 5MB (typisk gräns)
    
    // Försök lägga till data tills lagringen är full
    for (let i = 0; i < maxIterations; i++) {
      testData += new Array(step).join('a');
      try {
        localStorage.setItem(testKey, testData);
        localStorageAvailable = testData.length;
      } catch (e) {
        break;
      }
    }
    
    // Rensa testdata
    localStorage.removeItem(testKey);
  } catch (e) {
    console.warn('Kunde inte testa localStorage-kapacitet:', e);
  }
  
  return {
    localStorageAvailable: localStorageAvailable || STORAGE_LIMITS.LOCALSTORAGE,
    indexedDBAvailable: STORAGE_LIMITS.INDEXEDDB,
    totalAvailableMB: ((localStorageAvailable + STORAGE_LIMITS.INDEXEDDB) / (1024 * 1024)).toFixed(2)
  };
}

/**
 * Uppskatta ungefärlig filstorlek baserat på radantal och kolumnantal
 * @param {number} rows - Antal rader
 * @param {number} columns - Antal kolumner
 * @returns {number} - Uppskattad storlek i bytes
 */
export function estimateCSVSize(rows, columns) {
  // Anta genomsnittlig längd per fält (~15 tecken)
  const avgFieldLength = 15;
  
  // Uppskatta storlek: rader * kolumner * genomsnittlig fältstorlek
  // Lägg till 20% för struktur overhead
  const estimatedSize = rows * columns * avgFieldLength * 1.2;
  
  return Math.round(estimatedSize);
}

/**
 * Gör minnesberäkningar för bedömning av om en ny CSV kan laddas
 * @param {Object} newFileStats - Statistik för den nya filen (rader, kolumner)
 * @param {Object} currentMemoryUsage - Aktuell minnesanvändning
 * @returns {Object} - Beräkning av hur mycket minne som kommer användas efter import
 */
export function calculateMemoryWithNewFile(newFileStats, currentMemoryUsage) {
  // Uppskatta storlek för ny fil
  const estimatedNewSize = estimateCSVSize(
    newFileStats.rows || 0, 
    newFileStats.columns || 0
  );
  
  // Extrapolera från befintlig användning
  const currentSize = parseFloat(currentMemoryUsage.totalSize) || 0;
  const projectedSize = currentSize + estimatedNewSize;
  
  // Beräkna procent av tillgängligt minne
  const capacity = estimateAvailableCapacity();
  const totalCapacity = parseFloat(capacity.localStorageAvailable) + parseFloat(capacity.indexedDBAvailable);
  const projectedPercent = (projectedSize / totalCapacity) * 100;
  
  // Fastställ status
  let status = 'safe';
  if (projectedPercent >= MEMORY_THRESHOLDS.CRITICAL) {
    status = 'critical';
  } else if (projectedPercent >= MEMORY_THRESHOLDS.WARNING) {
    status = 'warning';
  }
  
  return {
    currentSize,
    estimatedNewSize,
    projectedSize,
    projectedSizeMB: (projectedSize / (1024 * 1024)).toFixed(2),
    projectedPercent: projectedPercent.toFixed(1),
    status,
    canAddFile: projectedPercent < MEMORY_THRESHOLDS.CRITICAL
  };
}