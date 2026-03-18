/**
 * Memory Utilities
 * 
 * Verktyg för att övervaka och hantera minnesanvändning i webbläsaren
 * när appen hanterar flera CSV-filer.
 */

// Konstantvärden för varningsnivåer
export const MEMORY_THRESHOLDS = {
  WARNING: 70, // 70% av tillgängligt minne
  CRITICAL: 90  // 90% av tillgängligt minne
};

// Standardvärden för lagringsstorlekar - uppskattningar baserade på typiska webbläsare
// Moderna webbläsare stöder vanligtvis flera GB IndexedDB-lagring:
// Chrome: upp till 80% av diskutrymmet, Firefox: upp till 50%, Safari: minst 1GB
const STORAGE_LIMITS = {
  LOCALSTORAGE: 5 * 1024 * 1024, // 5MB typisk localStorage-gräns
  INDEXEDDB: 2 * 1024 * 1024 * 1024,  // 2GB realistisk uppskattning för IndexedDB
  UNIFIED: 2 * 1024 * 1024 * 1024 + 5 * 1024 * 1024  // ~2GB total kapacitet
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
  
  // Beräkna procent av total tillgänglig lagringskapacitet
  // I stället för att visa separata procentandelar för localStorage och IndexedDB
  // visar vi en enda procent som representerar total minnesanvändning
  const totalPercent = Math.min(100, (totalDataSize / STORAGE_LIMITS.UNIFIED) * 100);
  
  // Fastställ status baserat på tröskelvärden
  let status = 'safe';
  if (totalPercent >= MEMORY_THRESHOLDS.CRITICAL) {
    status = 'critical';
  } else if (totalPercent >= MEMORY_THRESHOLDS.WARNING) {
    status = 'warning';
  }
  
  // Beräkna ungefärlig återstående kapacitet
  const remainingBytes = STORAGE_LIMITS.UNIFIED - totalDataSize;
  const remainingMB = remainingBytes / (1024 * 1024);
  
  // Beräkna uppskattning av hur många fler filer som kan laddas
  const filesInfo = estimateAdditionalFileCapacity(fileMetadataList, remainingBytes);
  
  return {
    totalSize: totalDataSize,
    totalSizeMB: (totalDataSize / (1024 * 1024)).toFixed(2),
    remainingMB: remainingMB.toFixed(2),
    postViewSize,
    accountViewSize,
    metadataSize,
    percentUsed: totalPercent.toFixed(1),
    status,
    canAddMoreData: totalPercent < MEMORY_THRESHOLDS.CRITICAL,
    isNearLimit: totalPercent >= MEMORY_THRESHOLDS.WARNING,
    estimatedAdditionalFiles: filesInfo.estimatedAdditionalFiles,
    averageFileSizeKB: filesInfo.averageFileSizeKB
  };
}

/**
 * Uppskattar hur många fler liknande filer som kan läggas till
 * @param {Array} fileMetadataList - Lista med info om uppladdade filer
 * @param {number} remainingBytes - Återstående byte tillgängliga
 * @returns {Object} - Information om uppskattad kapacitet
 */
function estimateAdditionalFileCapacity(fileMetadataList, remainingBytes) {
  // Om det inte finns några filer ännu, anta en standardstorlek per fil
  if (!fileMetadataList || fileMetadataList.length === 0) {
    // Anta 500KB som standardstorlek för en fil om ingen fil finns
    const defaultFileSizeKB = 500;
    const estimatedAdditionalFiles = Math.floor(remainingBytes / (defaultFileSizeKB * 1024));
    return {
      estimatedAdditionalFiles: Math.max(0, estimatedAdditionalFiles),
      averageFileSizeKB: defaultFileSizeKB
    };
  }
  
  // Beräkna genomsnittlig filstorlek från befintliga filer
  let totalRows = 0;
  for (const file of fileMetadataList) {
    totalRows += (file.rowCount || 0);
  }
  
  // Uppskatta storlek per rad (använd en konservativ uppskattning)
  // Anta att varje inlägg använder cirka 1-2KB data (med alla fält och bearbetning)
  const bytesPerRow = 1500; // 1.5KB per rad i genomsnitt
  const totalEstimatedBytes = totalRows * bytesPerRow;
  
  // Beräkna genomsnittlig filstorlek
  const averageFileSize = fileMetadataList.length > 0 
    ? totalEstimatedBytes / fileMetadataList.length 
    : 500 * 1024; // Anta 500KB om inga filer finns
  
  // Beräkna hur många fler filer som kan läggas till
  const estimatedAdditionalFiles = Math.floor(remainingBytes / averageFileSize);
  
  return {
    estimatedAdditionalFiles: Math.max(0, estimatedAdditionalFiles),
    averageFileSizeKB: Math.round(averageFileSize / 1024)
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
  
  // Returnera en kombinerad uppskattning av tillgänglig lagringskapacitet
  const totalAvailable = localStorageAvailable + STORAGE_LIMITS.INDEXEDDB;
  
  return {
    totalAvailableBytes: totalAvailable,
    totalAvailableMB: (totalAvailable / (1024 * 1024)).toFixed(2)
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
  const totalCapacity = capacity.totalAvailableBytes;
  const projectedPercent = (projectedSize / totalCapacity) * 100;
  
  // Fastställ status
  let status = 'safe';
  if (projectedPercent >= MEMORY_THRESHOLDS.CRITICAL) {
    status = 'critical';
  } else if (projectedPercent >= MEMORY_THRESHOLDS.WARNING) {
    status = 'warning';
  }
  
  // Beräkna uppskattad påverkan på antalet ytterligare filer som kan laddas
  const remainingAfterNewFile = totalCapacity - projectedSize;
  const filesInfo = estimateAdditionalFileCapacity(
    currentMemoryUsage.filesMetadata || [], 
    remainingAfterNewFile
  );
  
  return {
    currentSize,
    estimatedNewSize,
    projectedSize,
    projectedSizeMB: (projectedSize / (1024 * 1024)).toFixed(2),
    projectedPercent: projectedPercent.toFixed(1),
    status,
    canAddFile: projectedPercent < MEMORY_THRESHOLDS.CRITICAL,
    estimatedRemainingFiles: filesInfo.estimatedAdditionalFiles
  };
}