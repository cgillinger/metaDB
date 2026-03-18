/**
 * Web Storage Service
 * 
 * Ersätter Electrons filsystemåtkomst med webbaserade lösningar:
 * - localStorage för konfiguration och små datamängder
 * - IndexedDB för större datauppsättningar
 * - Web File API för filhantering
 */
import { calculateMemoryUsage } from './memoryUtils';

// Konstanter
const STORAGE_KEYS = {
  PROCESSED_DATA: 'facebook_stats_processed_data',
  ACCOUNT_VIEW_DATA: 'facebook_stats_account_view',
  POST_VIEW_DATA: 'facebook_stats_post_view',
  LAST_EXPORT_PATH: 'facebook_stats_last_export_path',
  UPLOADED_FILES_METADATA: 'facebook_stats_uploaded_files',
  MEMORY_USAGE: 'facebook_stats_memory_usage',
};

// IndexedDB konfiguration
const DB_CONFIG = {
  name: 'FacebookStatisticsDB',
  version: 1,
  stores: {
    csvData: { keyPath: 'id', autoIncrement: true },
    fileMetadata: { keyPath: 'id', autoIncrement: true }
  }
};

/**
 * Initierar och öppnar IndexedDB
 */
const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);
    
    request.onerror = (event) => {
      console.error('IndexedDB-fel:', event.target.error);
      reject(event.target.error);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Skapa object stores om de inte existerar
      if (!db.objectStoreNames.contains('csvData')) {
        db.createObjectStore('csvData', { keyPath: 'id', autoIncrement: true });
        console.log('Created csvData object store');
      }
      
      // Lägg till store för filmetadata om den inte finns
      if (!db.objectStoreNames.contains('fileMetadata')) {
        db.createObjectStore('fileMetadata', { keyPath: 'id', autoIncrement: true });
        console.log('Created fileMetadata object store');
      }
    };
    
    request.onsuccess = (event) => {
      const db = event.target.result;
      
      // Validera att object stores verkligen existerar
      if (!db.objectStoreNames.contains('csvData') || !db.objectStoreNames.contains('fileMetadata')) {
        console.error('Required object stores missing. Deleting database and recreating...');
        
        // Stäng den aktuella databasen
        db.close();
        
        // Ta bort databasen och skapa om den
        const deleteRequest = indexedDB.deleteDatabase(DB_CONFIG.name);
        
        deleteRequest.onsuccess = () => {
          console.log('Database deleted successfully. Reopening...');
          // Försök öppna igen rekursivt, men begränsa för att undvika oändlig loop
          resolve(openDatabase());
        };
        
        deleteRequest.onerror = (err) => {
          console.error('Failed to delete database:', err);
          reject(new Error('Failed to recreate database'));
        };
      } else {
        resolve(db);
      }
    };
  });
};

/**
 * Sparar data i IndexedDB
 */
const saveToIndexedDB = async (storeName, data) => {
  try {
    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.add(data);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (err) => {
          console.error('Error saving to IndexedDB:', err);
          reject(err);
        };
        
        // Lyssna även på transaktionsfel
        transaction.onerror = (err) => {
          console.error('Transaction error:', err);
          reject(err);
        };
      } catch (err) {
        console.error('Error creating transaction:', err);
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error opening database:', err);
    throw err;
  }
};

/**
 * Uppdaterar data i IndexedDB
 */
const updateInIndexedDB = async (storeName, id, data) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    
    // Hämta befintlig post först
    const getRequest = store.get(id);
    
    getRequest.onsuccess = () => {
      const existingData = getRequest.result;
      if (!existingData) {
        reject(new Error(`Post med ID ${id} hittades inte`));
        return;
      }
      
      // Sammanfoga befintlig data med ny data
      const updatedData = { ...existingData, ...data };
      
      // Spara den uppdaterade posten
      const updateRequest = store.put(updatedData);
      updateRequest.onsuccess = () => resolve(updateRequest.result);
      updateRequest.onerror = (err) => reject(err);
    };
    
    getRequest.onerror = (err) => reject(err);
    
    // Lyssna även på transaktionsfel
    transaction.onerror = (err) => {
      console.error('Transaction error in update:', err);
      reject(err);
    };
  });
};

/**
 * Tar bort data från IndexedDB
 */
const deleteFromIndexedDB = async (storeName, id) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve(true);
    request.onerror = (err) => reject(err);
    
    // Lyssna även på transaktionsfel
    transaction.onerror = (err) => {
      console.error('Transaction error in delete:', err);
      reject(err);
    };
  });
};

/**
 * Rensar alla data från en specifik store i IndexedDB
 */
const clearStoreInIndexedDB = async (storeName) => {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        
        request.onsuccess = () => resolve(true);
        request.onerror = (err) => {
          console.error('Error clearing store:', err);
          reject(err);
        };
        
        // Lyssna även på transaktionsfel
        transaction.onerror = (err) => {
          console.error('Transaction error in clear:', err);
          reject(err);
        };
      } catch (err) {
        console.error('Error creating transaction for clear:', err);
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error opening database for clear:', err);
    throw err;
  }
};

/**
 * Hämtar data från IndexedDB
 */
const getFromIndexedDB = async (storeName, key) => {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = key ? store.get(key) : store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = (err) => {
          console.error('Error getting from IndexedDB:', err);
          reject(err);
        };
        
        // Lyssna även på transaktionsfel
        transaction.onerror = (err) => {
          console.error('Transaction error in get:', err);
          reject(err);
        };
      } catch (err) {
        console.error('Error creating transaction for get:', err);
        reject(err);
      }
    });
  } catch (err) {
    console.error('Error opening database for get:', err);
    throw err;
  }
};

/**
 * Sparar konfigurationsdata i localStorage
 */
const saveConfig = (key, data) => {
  try {
    // Hantera stora objekt med chunking-metod
    const jsonData = JSON.stringify(data);
    
    // Om data är mindre än 2MB, spara direkt
    if (jsonData.length < 2 * 1024 * 1024) {
      localStorage.setItem(key, jsonData);
      return true;
    } 
    
    // För större data, försök med chunking
    console.warn(`Large data for ${key}, attempting chunking`);
    const chunkSize = 500 * 1024; // 500KB per chunk
    const chunks = Math.ceil(jsonData.length / chunkSize);
    
    // Rensa eventuella befintliga chunks
    for (let i = 0; i < localStorage.length; i++) {
      const existingKey = localStorage.key(i);
      if (existingKey.startsWith(`${key}_chunk_`)) {
        localStorage.removeItem(existingKey);
      }
    }
    
    // Spara meta-information
    localStorage.setItem(`${key}_meta`, JSON.stringify({ chunks, totalSize: jsonData.length }));
    
    // Spara data i chunks
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, jsonData.length);
      const chunk = jsonData.substring(start, end);
      localStorage.setItem(`${key}_chunk_${i}`, chunk);
    }
    
    return true;
  } catch (error) {
    console.error(`Fel vid sparande av ${key}:`, error);
    
    // Om lagringsutrymmet är slut, rensa och försök med IndexedDB istället
    if (error.name === 'QuotaExceededError') {
      console.warn('Storage quota exceeded, clearing old data');
      // Rensa icke-kritiska data
      localStorage.removeItem(STORAGE_KEYS.POST_VIEW_DATA);
      localStorage.removeItem(`${STORAGE_KEYS.POST_VIEW_DATA}_meta`);
      
      // Rensa alla chunk-data för POST_VIEW_DATA
      for (let i = 0; i < localStorage.length; i++) {
        const existingKey = localStorage.key(i);
        if (existingKey.startsWith(`${STORAGE_KEYS.POST_VIEW_DATA}_chunk_`)) {
          localStorage.removeItem(existingKey);
        }
      }
    }
    
    return false;
  }
};

/**
 * Hämtar konfigurationsdata från localStorage
 */
const getConfig = (key, defaultValue = null) => {
  try {
    // Kontrollera om data är sparad som chunks
    const metaStr = localStorage.getItem(`${key}_meta`);
    
    if (metaStr) {
      // Data finns som chunks, samla ihop dem
      const meta = JSON.parse(metaStr);
      let fullData = '';
      
      for (let i = 0; i < meta.chunks; i++) {
        const chunk = localStorage.getItem(`${key}_chunk_${i}`);
        if (chunk) {
          fullData += chunk;
        } else {
          console.error(`Chunk ${i} missing for ${key}`);
          return defaultValue;
        }
      }
      
      return JSON.parse(fullData);
    }
    
    // Normal data retrieval
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (error) {
    console.error(`Fel vid hämtning av ${key}:`, error);
    return defaultValue;
  }
};

/**
 * Hanterar uppladdning av CSV-fil
 */
const handleFileUpload = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      resolve(event.target.result);
    };
    
    reader.onerror = (error) => {
      console.error('Filläsningsfel:', error);
      reject(error);
    };
    
    reader.readAsText(file);
  });
};

/**
 * Hanterar nedladdning av data som fil
 */
const downloadFile = (data, filename, type = 'text/csv') => {
  // Skapa blob och nedladdningslänk
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  
  // Skapa och klicka på en tillfällig länk
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  
  // Städa upp
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(link);
  }, 100);
  
  return { success: true, filePath: filename };
};

/**
 * Hanterar nedladdning av data som Excel-fil
 */
const downloadExcel = async (data, filename) => {
  try {
    // Importera XLSX dynamiskt när funktionen anropas
    const XLSX = await import('xlsx');
    
    // Skapa arbetsbok
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Facebook Statistik');
    
    // Konvertera till binärdata
    const excelData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // Skapa och ladda ner filen
    const blob = new Blob([excelData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    
    // Städa upp
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(link);
    }, 100);
    
    return { success: true, filePath: filename };
  } catch (error) {
    console.error('Excel-nedladdningsfel:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Sparar bearbetad data till localStorage eller IndexedDB beroende på storlek
 */
const saveProcessedData = async (accountViewData, postViewData, fileInfo = null) => {
  try {
    // Spara account view data
    saveConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA, accountViewData);
    
    // Spara post view data
    const postViewString = JSON.stringify(postViewData);
    if (postViewString.length < 4 * 1024 * 1024) { // ~4MB gräns (under localStorage 5MB-gränsen)
      saveConfig(STORAGE_KEYS.POST_VIEW_DATA, postViewData);
    } else {
      // För större datamängder, använd IndexedDB
      console.log('Data too large for localStorage, using IndexedDB');
      await saveToIndexedDB('csvData', { 
        timestamp: Date.now(), 
        postViewData: postViewData 
      });
    }
    
    // Om filinformation tillhandahålls, spara metadata om uppladdad fil
    if (fileInfo) {
      await addFileMetadata(fileInfo);
    }
    
    // Uppdatera minnesanvändningsstatistik
    await updateMemoryUsageStats();
    
    return true;
  } catch (error) {
    console.error('Fel vid sparande av bearbetad data:', error);
    return false;
  }
};

/**
 * Sparar metadata om uppladdad fil
 */
const addFileMetadata = async (fileInfo) => {
  try {
    // Hämta befintlig filmetadata
    const existingFiles = await getUploadedFilesMetadata();
    
    // Lägg till den nya filen
    const updatedFiles = [...existingFiles, {
      ...fileInfo,
      uploadedAt: new Date().toISOString()
    }];
    
    // Spara uppdaterad lista
    saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, updatedFiles);
    
    return true;
  } catch (error) {
    console.error('Fel vid sparande av filmetadata:', error);
    return false;
  }
};

/**
 * Hämtar metadata om uppladdade filer
 */
const getUploadedFilesMetadata = async () => {
  return getConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, []);
};

/**
 * Tar bort en uppladdad fil från metadata
 */
const removeFileMetadata = async (fileIndex) => {
  try {
    // Hämta befintlig filmetadata
    const existingFiles = await getUploadedFilesMetadata();
    
    // Ta bort filen med angivet index
    if (fileIndex >= 0 && fileIndex < existingFiles.length) {
      existingFiles.splice(fileIndex, 1);
      
      // Spara uppdaterad lista
      saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, existingFiles);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Fel vid borttagning av filmetadata:', error);
    return false;
  }
};

/**
 * Rensar all filmetadata
 */
const clearFileMetadata = async () => {
  try {
    saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, []);
    return true;
  } catch (error) {
    console.error('Fel vid rensning av filmetadata:', error);
    return false;
  }
};

/**
 * Uppdaterar minnesanvändningsstatistik
 */
const updateMemoryUsageStats = async () => {
  try {
    const accountViewData = await getAccountViewData();
    const postViewData = await getPostViewData();
    const fileMetadata = await getUploadedFilesMetadata();
    
    const memoryUsage = calculateMemoryUsage(fileMetadata, postViewData, accountViewData);
    saveConfig(STORAGE_KEYS.MEMORY_USAGE, memoryUsage);
    
    return memoryUsage;
  } catch (error) {
    console.error('Fel vid uppdatering av minnesstatistik:', error);
    return null;
  }
};

/**
 * Hämtar aktuell minnesanvändningsstatistik
 */
const getMemoryUsageStats = async () => {
  try {
    // Försök hämta befintlig statistik
    const savedStats = getConfig(STORAGE_KEYS.MEMORY_USAGE);
    
    // Om ingen statistik finns, beräkna den
    if (!savedStats) {
      return await updateMemoryUsageStats();
    }
    
    return savedStats;
  } catch (error) {
    console.error('Fel vid hämtning av minnesstatistik:', error);
    return null;
  }
};

/**
 * Rensar all data från lagringen
 */
const clearAllData = async () => {
  try {
    // Rensa localStorage
    localStorage.removeItem(STORAGE_KEYS.POST_VIEW_DATA);
    localStorage.removeItem(STORAGE_KEYS.ACCOUNT_VIEW_DATA);
    localStorage.removeItem(STORAGE_KEYS.UPLOADED_FILES_METADATA);
    localStorage.removeItem(STORAGE_KEYS.MEMORY_USAGE);
    
    // Rensa alla chunks
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.includes('_chunk_') || key.includes('_meta')) {
        localStorage.removeItem(key);
      }
    }
    
    // Rensa IndexedDB
    try {
      await clearStoreInIndexedDB('csvData');
    } catch (dbError) {
      console.warn('Fel vid rensning av csvData:', dbError);
      // Fortsätt ändå
    }
    
    try {
      await clearStoreInIndexedDB('fileMetadata');
    } catch (dbError) {
      console.warn('Fel vid rensning av fileMetadata:', dbError);
      // Fortsätt ändå
    }
    
    return true;
  } catch (error) {
    console.error('Fel vid rensning av all data:', error);
    return false;
  }
};

/**
 * Hämtar bearbetad account view data
 */
const getAccountViewData = () => {
  return getConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA, []);
};

/**
 * Hämtar bearbetad post view data
 */
const getPostViewData = async () => {
  try {
    // Försök hämta från localStorage först
    const localData = getConfig(STORAGE_KEYS.POST_VIEW_DATA);
    if (localData) return localData;
    
    // Annars hämta från IndexedDB
    try {
      const dbData = await getFromIndexedDB('csvData');
      if (dbData && Array.isArray(dbData) && dbData.length > 0) {
        // Returnera den senaste (sortera efter timestamp)
        const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
        return sortedData[0].postViewData;
      }
    } catch (dbError) {
      console.warn('Fel vid hämtning från IndexedDB:', dbError);
      // Fortsätt med tom array
    }
    
    return [];
  } catch (error) {
    console.error('Fel vid hämtning av bearbetad data:', error);
    return [];
  }
};

/**
 * Öppnar extern URL i en ny flik
 */
const openExternalLink = (url) => {
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
};

// Hjälpfunktion för att återställa databasen
const resetDatabase = async () => {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(DB_CONFIG.name);
    
    deleteRequest.onsuccess = () => {
      console.log('Database successfully deleted');
      resolve(true);
    };
    
    deleteRequest.onerror = (err) => {
      console.error('Error deleting database:', err);
      reject(err);
    };
  });
};

export {
  STORAGE_KEYS,
  handleFileUpload,
  downloadFile,
  downloadExcel,
  saveProcessedData,
  getAccountViewData,
  getPostViewData,
  openExternalLink,
  getUploadedFilesMetadata,
  addFileMetadata,
  removeFileMetadata,
  clearFileMetadata,
  getMemoryUsageStats,
  updateMemoryUsageStats,
  clearAllData,
  resetDatabase // Exportera denna för debugging
};