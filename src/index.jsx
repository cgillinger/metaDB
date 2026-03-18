import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './renderer/App';
import './renderer/styles/globals.css';
import { initElectronApiEmulator } from './utils/electronApiEmulator';

// Initiera Electron API-emulatorn för webbmiljön
initElectronApiEmulator();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
