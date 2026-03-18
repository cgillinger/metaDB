/**
 * Electron API Emulator
 *
 * En emulator som ersätter Electron IPC med webbläsarens API:er.
 * Detta gör att befintlig kod som använder window.electronAPI kan fortsätta
 * fungera i en webbläsarkontext utan Electron.
 */
import {
  handleFileUpload,
  downloadFile,
  downloadExcel,
  openExternalLink
} from './webStorageService';

/**
 * Initierar och exponerar Electron API-emulatorn
 */
export function initElectronApiEmulator() {
  if (typeof window === 'undefined') return; // Skip on server-side rendering

  // Skapa mockad electronAPI om den inte redan finns
  if (!window.electronAPI) {
    console.log('Initierar Electron API-emulator för webben');

    // Skapa mockad API
    window.electronAPI = {
      // Extern länköppning
      openExternalLink: (url) => openExternalLink(url),

      // Exportfunktioner
      exportToExcel: async (data, filename) => {
        return await downloadExcel(data, filename);
      },

      exportToCSV: async (data, filename) => {
        // Använd papaparse för att konvertera data till CSV
        const Papa = await import('papaparse');
        const csvContent = Papa.unparse(data);
        return downloadFile(csvContent, filename, 'text/csv');
      },

      // Dialog för att spara filer
      showSaveDialog: async (options) => {
        console.log('Mock showSaveDialog:', options);
        return {
          canceled: false,
          filePath: options.defaultPath || 'nedladdad-fil.csv'
        };
      }
    };

    console.log('Electron API-emulator initierad');
  }
}
