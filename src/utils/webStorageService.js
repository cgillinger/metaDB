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
  PROCESSED_DATA: 'instagram_stats_processed_data',
  ACCOUNT_VIEW_DATA: 'instagram_stats_account_view',
  POST_VIEW_DATA: 'instagram_stats_post_view', // Används nu endast som fallback
  LAST_EXPORT_PATH: 'instagram_stats_last_export_path',
  UPLOADED_FILES_METADATA: 'instagram_stats_uploaded_files',
  MEMORY_USAGE: 'instagram_stats_memory_usage',
};

// IndexedDB konfiguration
const DB_CONFIG = {
  name: 'InstagramStatisticsDB',
  version: 1,
  stores: {
    csvData: { keyPath: 'id', autoIncrement: true },
    fileMetadata: { keyPath: 'id', autoIncrement: true },
    accountData: { keyPath: 'id', autoIncrement: true } // Ny store för kontodata
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
      }
      
      // Lägg till store för filmetadata om den inte finns
      if (!db.objectStoreNames.contains('fileMetadata')) {
        db.createObjectStore('fileMetadata', { keyPath: 'id', autoIncrement: true });
      }
      
      // Lägg till store för kontodata (account view data)
      if (!db.objectStoreNames.contains('accountData')) {
        db.createObjectStore('accountData', { keyPath: 'id', autoIncrement: true });
      }
    };
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
  });
};

/**
 * Sparar data i IndexedDB
 */
const saveToIndexedDB = async (storeName, data) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(data);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
      updateRequest.onerror = () => reject(updateRequest.error);
    };
    
    getRequest.onerror = () => reject(getRequest.error);
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
    request.onerror = () => reject(request.error);
  });
};

/**
 * Rensar alla data från en specifik store i IndexedDB
 */
const clearStoreInIndexedDB = async (storeName) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Hämtar data från IndexedDB
 */
const getFromIndexedDB = async (storeName, key) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = key ? store.get(key) : store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Sparar konfigurationsdata i localStorage med felhantering
 */
const saveConfig = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return { success: true };
  } catch (error) {
    console.error(`Fel vid sparande av ${key}:`, error);
    return { success: false, error };
  }
};

/**
 * Hämtar konfigurationsdata från localStorage
 */
const getConfig = (key, defaultValue = null) => {
  try {
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
    XLSX.utils.book_append_sheet(wb, ws, 'Instagram Statistik');
    
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
 * Sparar bearbetad data - anpassad för att alltid använda IndexedDB för postViewData
 * för att undvika problem med localStorage-kvoter.
 */
const saveProcessedData = async (accountViewData, postViewData, fileInfo = null) => {
  try {
    // Spara account view data
    // Försök först med localStorage, men använd IndexedDB som fallback
    const accountResult = saveConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA, accountViewData);
    if (!accountResult.success && accountResult.error instanceof DOMException && 
        accountResult.error.name === 'QuotaExceededError') {
      // Använd IndexedDB för account view data om localStorage-kvoten överskrids
      console.log('localStorage kvot överskriden för account data, använder IndexedDB istället.');
      await clearStoreInIndexedDB('accountData');  // Rensa befintlig data först
      await saveToIndexedDB('accountData', { 
        timestamp: Date.now(), 
        accountViewData: accountViewData 
      });
    }
    
    // Spara post view data - ALLTID i IndexedDB för att undvika localStorage-kvoter
    await clearStoreInIndexedDB('csvData');  // Rensa befintlig data för att undvika duplicering
    await saveToIndexedDB('csvData', { 
      timestamp: Date.now(), 
      postViewData: postViewData 
    });
    
    // Ta bort eventuell gammal post view data från localStorage
    try {
      localStorage.removeItem(STORAGE_KEYS.POST_VIEW_DATA);
    } catch (e) {
      // Ignorera eventuella fel vid rensning av localStorage
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
 * Sparar metadata om uppladdad fil - förbättrad med fel-tolerans
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
    
    // Försök spara i localStorage först
    const result = saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, updatedFiles);
    
    // Om localStorage-kvoten överskrids, använd IndexedDB som fallback
    if (!result.success && result.error instanceof DOMException && 
        result.error.name === 'QuotaExceededError') {
      console.log('localStorage kvot överskriden för filmetadata, använder IndexedDB istället.');
      await clearStoreInIndexedDB('fileMetadata');
      await saveToIndexedDB('fileMetadata', { 
        timestamp: Date.now(),
        files: updatedFiles 
      });
    }
    
    return true;
  } catch (error) {
    console.error('Fel vid sparande av filmetadata:', error);
    return false;
  }
};

/**
 * Hämtar metadata om uppladdade filer med stöd för både localStorage och IndexedDB
 */
const getUploadedFilesMetadata = async () => {
  // Försök hämta från localStorage först
  const localData = getConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA);
  if (localData && Array.isArray(localData) && localData.length > 0) {
    return localData;
  }
  
  // Fallback till IndexedDB
  try {
    const dbData = await getFromIndexedDB('fileMetadata');
    if (dbData && dbData.length > 0) {
      // Returnera den senaste (sortera efter timestamp)
      const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
      return sortedData[0].files || [];
    }
  } catch (error) {
    console.warn('Kunde inte hämta filmetadata från IndexedDB:', error);
  }
  
  return [];
};

/**
 * Tar bort en uppladdad fil från metadata
 */
const removeFileMetadata = async (fileIndex) => {
  try {
    // Försök hämta från localStorage först
    let existingFiles = getConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, []);
    let fromLocalStorage = true;
    
    // Om den inte finns i localStorage, försök IndexedDB
    if (!existingFiles || existingFiles.length === 0) {
      const dbData = await getFromIndexedDB('fileMetadata');
      if (dbData && dbData.length > 0) {
        const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
        existingFiles = sortedData[0].files || [];
        fromLocalStorage = false;
      }
    }
    
    // Ta bort filen med angivet index
    if (fileIndex >= 0 && fileIndex < existingFiles.length) {
      existingFiles.splice(fileIndex, 1);
      
      // Spara uppdaterad lista på rätt ställe
      if (fromLocalStorage) {
        saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, existingFiles);
      } else {
        await clearStoreInIndexedDB('fileMetadata');
        await saveToIndexedDB('fileMetadata', { 
          timestamp: Date.now(),
          files: existingFiles 
        });
      }
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
    // Rensa från både localStorage och IndexedDB
    localStorage.removeItem(STORAGE_KEYS.UPLOADED_FILES_METADATA);
    await clearStoreInIndexedDB('fileMetadata');
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
    
    // Rensa IndexedDB
    await clearStoreInIndexedDB('csvData');
    await clearStoreInIndexedDB('fileMetadata');
    await clearStoreInIndexedDB('accountData');
    
    return true;
  } catch (error) {
    console.error('Fel vid rensning av all data:', error);
    return false;
  }
};

/**
 * Hämtar bearbetad account view data - stödjer nu både localStorage och IndexedDB
 */
const getAccountViewData = async () => {
  // Försök hämta från localStorage först
  const localData = getConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA);
  if (localData) return localData;
  
  // Fallback till IndexedDB för account view data
  try {
    const dbData = await getFromIndexedDB('accountData');
    if (dbData && dbData.length > 0) {
      // Returnera den senaste (sortera efter timestamp)
      const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
      return sortedData[0].accountViewData || [];
    }
  } catch (error) {
    console.warn('Kunde inte hämta account view data från IndexedDB:', error);
  }
  
  return [];
};

/**
 * Hämtar bearbetad post view data - nu alltid från IndexedDB
 */
const getPostViewData = async () => {
  try {
    // Hämta från IndexedDB
    const dbData = await getFromIndexedDB('csvData');
    if (dbData && dbData.length > 0) {
      // Returnera den senaste (sortera efter timestamp)
      const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
      return sortedData[0].postViewData || [];
    }
    
    // Fallback till localStorage om data saknas i IndexedDB
    // Detta är bara för bakåtkompatibilitet
    const localData = getConfig(STORAGE_KEYS.POST_VIEW_DATA);
    if (localData) return localData;
    
    return [];
  } catch (error) {
    console.error('Fel vid hämtning av bearbetad data:', error);
    
    // Sista försök - kolla localStorage även vid fel
    try {
      const localData = getConfig(STORAGE_KEYS.POST_VIEW_DATA);
      if (localData) return localData;
    } catch (e) {
      // Ignorera eventuella fel
    }
    
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
  clearAllData
};