/**
 * API Client for Meta Analytics
 *
 * Replaces storageService.js — all data operations go through the Express API.
 * Client-side export utilities (downloadFile, downloadExcel, openExternalLink)
 * remain here as they are browser-only operations.
 */

const handleResponse = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export const api = {
  // Imports
  getImports: () => fetch('/api/imports').then(handleResponse),
  uploadCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/imports', { method: 'POST', body: formData }).then(handleResponse);
  },
  deleteImport: (id) =>
    fetch(`/api/imports/${id}`, { method: 'DELETE' }).then(handleResponse),
  getCoverage: () => fetch('/api/imports/coverage').then(handleResponse),

  // Posts (server-side pagination)
  getPosts: (params) =>
    fetch(`/api/posts?${new URLSearchParams(params)}`).then(handleResponse),

  // Account aggregation (SQL-based)
  getAccounts: (params) =>
    fetch(`/api/accounts?${new URLSearchParams(params)}`).then(handleResponse),

  // Post type aggregation
  getPostTypes: (params) =>
    fetch(`/api/post-types?${new URLSearchParams(params)}`).then(handleResponse),

  // Trend analysis
  getTrends: (params) =>
    fetch(`/api/trends?${new URLSearchParams(params)}`).then(handleResponse),

  // Maintenance
  vacuum: () =>
    fetch('/api/maintenance/vacuum', { method: 'POST' }).then(handleResponse),
  redetectCollab: () =>
    fetch('/api/maintenance/redetect-collab', { method: 'POST' }).then(handleResponse),
  getStats: () => fetch('/api/maintenance/stats').then(handleResponse),
  getHealth: () => fetch('/api/health').then(handleResponse),
  getBackupUrl: () => '/api/maintenance/backup',

  // Reach imports
  uploadReachCSV: (file, month) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', month);
    return fetch('/api/reach', { method: 'POST', body: formData }).then(handleResponse);
  },
  getReachMonths: () => fetch('/api/reach/months').then(handleResponse),
  deleteReachMonth: (month) =>
    fetch(`/api/reach/${month}`, { method: 'DELETE' }).then(handleResponse),

  // GA Listens imports — Google Analytics podcast listening data

  /**
   * Upload a GA listens CSV export for the given month.
   * @param {File} file - CSV file with Programnamn + lyssningar columns
   * @param {string} month - Target month in 'YYYY-MM' format
   */
  uploadGAListensCSV: (file, month) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', month);
    return fetch('/api/ga-listens', { method: 'POST', body: formData }).then(handleResponse);
  },
  /**
   * Fetch GA listens rows, optionally filtered to specific months.
   * @param {string[]|null} months - Array of 'YYYY-MM' strings, or null for all
   * @returns {Promise<{data: Array}>}
   */
  getGAListens: (months) => {
    const params = months && months.length > 0
      ? '?' + new URLSearchParams({ months: months.join(',') })
      : '';
    return fetch(`/api/ga-listens${params}`).then(handleResponse);
  },
  /**
   * Fetch aggregated GA listens per programme, summed across selected months.
   * @param {string[]|null} months - Array of 'YYYY-MM' strings, or null for all
   * @param {'asc'|'desc'} order
   * @returns {Promise<{programmes: Array<{account_name: string, total_listens: number, month_count: number}>, grandTotal: number}>}
   */
  getGAListensSummary: (months, order = 'desc') => {
    const params = new URLSearchParams();
    if (months && months.length > 0) params.set('months', months.join(','));
    if (order) params.set('order', order);
    const qs = params.toString();
    return fetch(`/api/ga-listens/summary${qs ? '?' + qs : ''}`).then(handleResponse);
  },
  /** @returns {Promise<{months: string[]}>} */
  getGAListensMonths: () => fetch('/api/ga-listens/months').then(handleResponse),
  /** @param {string} month - 'YYYY-MM' */
  deleteGAListensMonth: (month) =>
    fetch(`/api/ga-listens/${month}`, { method: 'DELETE' }).then(handleResponse),
  deleteGAListensAccount: (accountName, months) => {
    const params = new URLSearchParams({ accountName, months: months.join(',') });
    return fetch(`/api/ga-listens/by-account?${params}`, { method: 'DELETE' }).then(handleResponse);
  },

  // Posts — delete by account + period
  deleteAccountPosts: (accountName, platform, periodParams) => {
    const params = new URLSearchParams({ accountName, platform, ...periodParams });
    return fetch(`/api/posts/by-account?${params}`, { method: 'DELETE' }).then(handleResponse);
  },
};

// --- Client-side export utilities (unchanged from storageService.js) ---

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
    const blob = new Blob([excelData], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
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

export const openExternalLink = (url) => {
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
};
