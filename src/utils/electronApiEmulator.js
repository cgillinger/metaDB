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
 * Mockad konfigurationsfil för att simulera Electron-filåtkomst
 */
const MOCK_CONFIG = {};

/**
 * Initierar och exponerar Electron API-emulatorn
 */
export function initElectronApiEmulator() {
  if (typeof window === 'undefined') return; // Skip on server-side rendering
  
  // Skapa mockad electronAPI om den inte redan finns
  if (!window.electronAPI) {
    console.log('Initierar Electron API-emulator för webben');
    
    // Asynkron metod för att läsa filer
    const readFile = async (filePath, options = {}) => {
      console.log(`Mock readFile: ${filePath}`);
      if (MOCK_CONFIG[filePath]) {
        return MOCK_CONFIG[filePath];
      }
      throw new Error(`Filen finns inte: ${filePath}`);
    };

    // Asynkron metod för att skriva filer
    const writeFile = async (filePath, content) => {
      console.log(`Mock writeFile: ${filePath}`);
      MOCK_CONFIG[filePath] = content;
      return true;
    };
    
    // Skapa mockad API
    window.electronAPI = {
      // Filsystem
      readFile,
      writeFile,
      
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
        // I webbläsaren kan vi inte visa en "save dialog", så vi returnerar
        // ett förvalt filnamn från options
        return {
          canceled: false,
          filePath: options.defaultPath || 'nedladdad-fil.csv'
        };
      }
    };
    
    console.log('Electron API-emulator initierad');
  }
}

// Exportera en funktion för att ladda om/uppdatera mocks om det behövs
export function updateMockConfig(key, value) {
  MOCK_CONFIG[key] = value;
}

// Exportera en helper-funktion för att få en modifierad mockkonfiguration för tester
export function getMockConfig() {
  return { ...MOCK_CONFIG };
}
