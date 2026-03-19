/**
 * Storage Service for Meta Analytics
 *
 * Unified IndexedDB (MetaAnalyticsDB) with 12h auto-cleanup.
 * All posts have a `_platform` field ("facebook" or "instagram").
 */
import { calculateMemoryUsage } from './memoryUtils';

const AUTO_CLEANUP_HOURS = 12;

const DB_CONFIG = {
  name: 'MetaAnalyticsDB',
  version: 1,
  stores: {
    posts: { keyPath: 'id', autoIncrement: true },
    fileMetadata: { keyPath: 'id', autoIncrement: true }
  }
};

const STORAGE_KEYS = {
  ACCOUNT_VIEW_DATA: 'meta_stats_account_view',
  UPLOADED_FILES_METADATA: 'meta_stats_uploaded_files',
  MEMORY_USAGE: 'meta_stats_memory_usage',
  LAST_SAVE_TIMESTAMP: 'meta_stats_last_save_timestamp'
};

// --- IndexedDB operations ---

const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

    request.onerror = (event) => reject(event.target.error);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('posts')) {
        db.createObjectStore('posts', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('fileMetadata')) {
        db.createObjectStore('fileMetadata', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('posts') || !db.objectStoreNames.contains('fileMetadata')) {
        db.close();
        const deleteRequest = indexedDB.deleteDatabase(DB_CONFIG.name);
        deleteRequest.onsuccess = () => resolve(openDatabase());
        deleteRequest.onerror = (err) => reject(err);
      } else {
        resolve(db);
      }
    };
  });
};

const saveToIndexedDB = async (storeName, data) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.add(data);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (err) => reject(err);
    tx.onerror = (err) => reject(err);
  });
};

const getFromIndexedDB = async (storeName) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (err) => reject(err);
  });
};

const clearStoreInIndexedDB = async (storeName) => {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = (err) => reject(err);
    });
  } catch (err) {
    console.warn('Error clearing store:', err);
    return false;
  }
};

// --- localStorage helpers ---

const saveConfig = (key, data) => {
  try {
    const jsonData = JSON.stringify(data);
    if (jsonData.length < 2 * 1024 * 1024) {
      localStorage.setItem(key, jsonData);
      return { success: true };
    }
    // Chunking for large data
    const chunkSize = 500 * 1024;
    const chunks = Math.ceil(jsonData.length / chunkSize);
    // Clear old chunks (collect keys first to avoid mutation during iteration)
    const chunksToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const existingKey = localStorage.key(i);
      if (existingKey && existingKey.startsWith(`${key}_chunk_`)) {
        chunksToRemove.push(existingKey);
      }
    }
    chunksToRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(`${key}_meta`, JSON.stringify({ chunks, totalSize: jsonData.length }));
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      localStorage.setItem(`${key}_chunk_${i}`, jsonData.substring(start, start + chunkSize));
    }
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
};

const getConfig = (key, defaultValue = null) => {
  try {
    const metaStr = localStorage.getItem(`${key}_meta`);
    if (metaStr) {
      const meta = JSON.parse(metaStr);
      let fullData = '';
      for (let i = 0; i < meta.chunks; i++) {
        const chunk = localStorage.getItem(`${key}_chunk_${i}`);
        if (chunk) fullData += chunk;
        else return defaultValue;
      }
      return JSON.parse(fullData);
    }
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

// --- 12h Auto-cleanup ---

/**
 * Check if saved data is stale (> 12h) and clean up if so.
 * Returns true if data was cleaned up or no data exists (= nothing to restore).
 * Returns false if fresh data exists (= should try to restore).
 */
export async function checkAndCleanupStaleData() {
  try {
    const lastSave = localStorage.getItem(STORAGE_KEYS.LAST_SAVE_TIMESTAMP);
    if (!lastSave) return true; // No saved data — nothing to restore

    const hoursSinceLastSave = (Date.now() - parseInt(lastSave, 10)) / (1000 * 60 * 60);
    if (hoursSinceLastSave >= AUTO_CLEANUP_HOURS) {
      console.log(`Data is ${hoursSinceLastSave.toFixed(1)}h old (limit: ${AUTO_CLEANUP_HOURS}h). Auto-cleaning...`);
      await clearAllData();
      return true; // Data was stale and cleaned
    }
    return false; // Fresh data exists — should restore
  } catch (error) {
    console.warn('Error during auto-cleanup check:', error);
    return true; // On error, treat as no data
  }
}

// --- Public API ---

export const handleFileUpload = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
};

export const downloadFile = (data, filename, type = 'text/csv') => {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(link);
  }, 100);
  return { success: true, filePath: filename };
};

export const downloadExcel = async (data, filename) => {
  try {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Meta Analytics');
    const excelData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(link);
    }, 100);
    return { success: true, filePath: filename };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const saveProcessedData = async (accountViewData, postViewData, fileInfo = null) => {
  try {
    // Update timestamp
    localStorage.setItem(STORAGE_KEYS.LAST_SAVE_TIMESTAMP, String(Date.now()));

    // Save account view to localStorage
    saveConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA, accountViewData);

    // Save post view to IndexedDB (always, to avoid localStorage limits)
    await clearStoreInIndexedDB('posts');
    await saveToIndexedDB('posts', {
      timestamp: Date.now(),
      postViewData: postViewData
    });

    if (fileInfo) {
      await addFileMetadata(fileInfo);
    }

    await updateMemoryUsageStats();
    return true;
  } catch (error) {
    console.error('Error saving processed data:', error);
    return false;
  }
};

export const addFileMetadata = async (fileInfo) => {
  try {
    const existingFiles = await getUploadedFilesMetadata();
    const updatedFiles = [...existingFiles, {
      ...fileInfo,
      uploadedAt: new Date().toISOString()
    }];
    saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, updatedFiles);
    return true;
  } catch (error) {
    return false;
  }
};

export const getUploadedFilesMetadata = async () => {
  return getConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, []);
};

export const removeFileMetadata = async (fileIndex) => {
  try {
    const existingFiles = await getUploadedFilesMetadata();
    if (fileIndex >= 0 && fileIndex < existingFiles.length) {
      existingFiles.splice(fileIndex, 1);
      saveConfig(STORAGE_KEYS.UPLOADED_FILES_METADATA, existingFiles);
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
};

export const getAccountViewData = () => {
  return getConfig(STORAGE_KEYS.ACCOUNT_VIEW_DATA, []);
};

export const getPostViewData = async () => {
  try {
    const dbData = await getFromIndexedDB('posts');
    if (dbData && Array.isArray(dbData) && dbData.length > 0) {
      const sortedData = dbData.sort((a, b) => b.timestamp - a.timestamp);
      return sortedData[0].postViewData || [];
    }
    return [];
  } catch (error) {
    return [];
  }
};

export const updateMemoryUsageStats = async () => {
  try {
    const accountViewData = getAccountViewData();
    const postViewData = await getPostViewData();
    const fileMetadata = await getUploadedFilesMetadata();
    const memoryUsage = calculateMemoryUsage(fileMetadata, postViewData, accountViewData);
    saveConfig(STORAGE_KEYS.MEMORY_USAGE, memoryUsage);
    return memoryUsage;
  } catch (error) {
    return null;
  }
};

export const getMemoryUsageStats = async () => {
  try {
    const savedStats = getConfig(STORAGE_KEYS.MEMORY_USAGE);
    if (!savedStats) return await updateMemoryUsageStats();
    return savedStats;
  } catch (error) {
    return null;
  }
};

export const clearAllData = async () => {
  try {
    // Clear localStorage
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}_meta`);
    });
    // Clear chunks
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('meta_stats_') || key.includes('_chunk_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Clear IndexedDB
    try { await clearStoreInIndexedDB('posts'); } catch (e) { /* ignore */ }
    try { await clearStoreInIndexedDB('fileMetadata'); } catch (e) { /* ignore */ }

    return true;
  } catch (error) {
    return false;
  }
};

export const openExternalLink = (url) => {
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
};
