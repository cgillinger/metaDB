import { downloadFile, downloadExcel, openExternalLink } from './storageService';

export function initElectronApiEmulator() {
  if (typeof window === 'undefined') return;

  if (!window.electronAPI) {
    window.electronAPI = {
      openExternalLink: (url) => openExternalLink(url),
      exportToExcel: async (data, filename) => await downloadExcel(data, filename),
      exportToCSV: async (data, filename) => {
        const Papa = await import('papaparse');
        const csvContent = Papa.unparse(data);
        return downloadFile(csvContent, filename, 'text/csv');
      },
      showSaveDialog: async (options) => ({
        canceled: false,
        filePath: options.defaultPath || 'download.csv'
      })
    };
  }
}
