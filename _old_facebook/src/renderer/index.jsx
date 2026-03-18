import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { initElectronApiEmulator } from '../utils/electronApiEmulator';

// Initiera Electron API-emulatorn för webbmiljön
initElectronApiEmulator();

const container = document.getElementById('root');

if (!container) {
  console.error("❌ Root-elementet kunde inte hittas! Kontrollera 'index.html'");
} else {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
