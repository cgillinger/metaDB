/**
 * API Client for Meta Analytics
 *
 * Replaces storageService.js — all data operations go through the Express API.
 * Client-side export utilities (downloadFile, downloadExcel, openExternalLink)
 * remain here as they are browser-only operations.
 */

const fetchWithRetry = async (url, options = {}, retries = 2) => {
  const res = await fetch(url, options);
  if (res.status === 429 && retries > 0) {
    const delay = (3 - retries) * 500;
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(url, options, retries - 1);
  }
  return res;
};

const handleResponse = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export const api = {
  // Imports
  getImports: () => fetchWithRetry('/api/imports').then(handleResponse),
  uploadCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/imports', { method: 'POST', body: formData }).then(handleResponse);
  },
  deleteImport: (id) =>
    fetch(`/api/imports/${id}`, { method: 'DELETE' }).then(handleResponse),
  getCoverage: () => fetchWithRetry('/api/imports/coverage').then(handleResponse),

  // Posts (server-side pagination)
  getPosts: (params) =>
    fetchWithRetry(`/api/posts?${new URLSearchParams(params)}`).then(handleResponse),

  // Account aggregation (SQL-based)
  getAccounts: (params) =>
    fetchWithRetry(`/api/accounts?${new URLSearchParams(params)}`).then(handleResponse),

  // Post type aggregation
  getPostTypes: (params) =>
    fetchWithRetry(`/api/post-types?${new URLSearchParams(params)}`).then(handleResponse),

  // Trend analysis
  getTrends: (params) =>
    fetchWithRetry(`/api/trends?${new URLSearchParams(params)}`).then(handleResponse),

  // Maintenance
  vacuum: () =>
    fetch('/api/maintenance/vacuum', { method: 'POST' }).then(handleResponse),
  redetectCollab: () =>
    fetch('/api/maintenance/redetect-collab', { method: 'POST' }).then(handleResponse),
  getStats: () => fetchWithRetry('/api/maintenance/stats').then(handleResponse),
  getHealth: () => fetchWithRetry('/api/health').then(handleResponse),
  getBackupUrl: () => '/api/maintenance/backup',

  // Reach imports
  uploadReachCSV: (file, month) => {
    const formData = new FormData();
    formData.append('file', file);
    if (month) formData.append('month', month);
    return fetch('/api/reach', { method: 'POST', body: formData }).then(handleResponse);
  },
  getReachMonths: () => fetchWithRetry('/api/reach/months').then(handleResponse),
  deleteReachMonth: (month) =>
    fetch(`/api/reach/${month}`, { method: 'DELETE' }).then(handleResponse),

  // IG Reach imports
  uploadIGReachCSV: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/ig-reach', { method: 'POST', body: formData }).then(handleResponse);
  },
  getIGReachMonths: () => fetchWithRetry('/api/ig-reach/months').then(handleResponse),
  deleteIGReachMonth: (month) =>
    fetch(`/api/ig-reach/${month}`, { method: 'DELETE' }).then(handleResponse),

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
    return fetchWithRetry(`/api/ga-listens${params}`).then(handleResponse);
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
    return fetchWithRetry(`/api/ga-listens/summary${qs ? '?' + qs : ''}`).then(handleResponse);
  },
  /** @returns {Promise<{months: string[]}>} */
  getGAListensMonths: () => fetchWithRetry('/api/ga-listens/months').then(handleResponse),
  /** @param {string} month - 'YYYY-MM' */
  deleteGAListensMonth: (month) =>
    fetch(`/api/ga-listens/${month}`, { method: 'DELETE' }).then(handleResponse),
  deleteGAListensAccount: (accountName, months) => {
    const params = new URLSearchParams({ accountName, months: months.join(',') });
    return fetch(`/api/ga-listens/by-account?${params}`, { method: 'DELETE' }).then(handleResponse);
  },
  /**
   * Batch-delete GA listens data for specific account names (all months).
   * @param {string[]} accountNames - Programme names to delete
   * @returns {Promise<{ deleted: number, accountNames: string[] }>}
   */
  deleteGAListensAccounts: (accountNames) =>
    fetch('/api/ga-listens/by-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNames }),
    }).then(handleResponse),

  // GA Site Visits — Google Analytics site visit data

  uploadGASiteVisitsCSV: (file, month) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('month', month);
    return fetch('/api/ga-site-visits', { method: 'POST', body: formData }).then(handleResponse);
  },

  getGASiteVisits: (months) => {
    const params = months && months.length > 0
      ? '?' + new URLSearchParams({ months: months.join(',') })
      : '';
    return fetchWithRetry(`/api/ga-site-visits${params}`).then(handleResponse);
  },

  getGASiteVisitsSummary: (months, order = 'desc') => {
    const params = new URLSearchParams();
    if (months && months.length > 0) params.set('months', months.join(','));
    if (order) params.set('order', order);
    const qs = params.toString();
    return fetchWithRetry(`/api/ga-site-visits/summary${qs ? '?' + qs : ''}`).then(handleResponse);
  },

  getGASiteVisitsMonths: () => fetchWithRetry('/api/ga-site-visits/months').then(handleResponse),

  deleteGASiteVisitsMonth: (month) =>
    fetch(`/api/ga-site-visits/${month}`, { method: 'DELETE' }).then(handleResponse),

  deleteGASiteVisitsAccount: (accountName, months) => {
    const params = new URLSearchParams({ accountName, months: months.join(',') });
    return fetch(`/api/ga-site-visits/by-account?${params}`, { method: 'DELETE' }).then(handleResponse);
  },

  deleteGASiteVisitsAccounts: (accountNames) =>
    fetch('/api/ga-site-visits/by-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNames }),
    }).then(handleResponse),

  // Account Groups
  /**
   * Fetch all account groups, optionally filtered by source.
   * @param {'ga_listens'|'posts'|null} source
   * @returns {Promise<{groups: Array}>}
   */
  getAccountGroups: (source = null) => {
    const params = source ? `?source=${source}` : '';
    return fetchWithRetry(`/api/account-groups${params}`).then(handleResponse);
  },
  /**
   * Create a new account group.
   * @param {string} name
   * @param {'ga_listens'|'posts'} source
   * @param {string[]} members - Array of account_key strings
   * @returns {Promise<{id, name, source, members}>}
   */
  createAccountGroup: (name, source, members) => {
    return fetch('/api/account-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source, members }),
    }).then(handleResponse);
  },
  /**
   * Update an account group.
   * @param {number} id
   * @param {{name?: string, members?: string[]}} updates
   * @returns {Promise<{id, name, source, members}>}
   */
  updateAccountGroup: (id, updates) => {
    return fetch(`/api/account-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }).then(handleResponse);
  },
  /**
   * Delete a single account group.
   * @param {number} id
   */
  deleteAccountGroup: (id) => {
    return fetch(`/api/account-groups/${id}`, { method: 'DELETE' }).then(handleResponse);
  },
  /**
   * Delete ALL account groups.
   */
  deleteAllAccountGroups: () => {
    return fetch('/api/account-groups/all', { method: 'DELETE' }).then(handleResponse);
  },

  // Hidden accounts
  getHiddenAccounts: () => fetchWithRetry('/api/hidden-accounts').then(handleResponse),
  hideAccount: (accountName, platform) =>
    fetch('/api/hidden-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName, platform }),
    }).then(handleResponse),
  unhideAccount: (accountName, platform) =>
    fetch('/api/hidden-accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName, platform }),
    }).then(handleResponse),

  // Comparison View
  getComparisonAccounts: () =>
    fetchWithRetry('/api/comparison/accounts').then(handleResponse),

  getComparisonBesokLankklick: (account, months = null) => {
    const params = new URLSearchParams({ account });
    if (months && months.length > 0) params.set('months', months.join(','));
    return fetchWithRetry(`/api/comparison/besok-lankklick?${params}`).then(handleResponse);
  },

  getComparisonBesokLankklickGroup: (memberGaNames, months = null) => {
    const params = new URLSearchParams({ members: memberGaNames.join(',') });
    if (months && months.length > 0) params.set('months', months.join(','));
    return fetchWithRetry(`/api/comparison/besok-lankklick-group?${params}`).then(handleResponse);
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
