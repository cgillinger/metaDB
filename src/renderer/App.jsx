import React, { useState, useEffect } from 'react';
import { FileUploader } from "./components/FileUploader";
import MainView from "./components/MainView";
import { api } from '@/utils/apiClient';
import { VERSION } from '@/utils/version';

function App() {
  const [hasData, setHasData] = useState(false);
  const [showFileUploader, setShowFileUploader] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const stats = await api.getStats();
        if (stats.posts > 0) {
          setHasData(true);
          setShowFileUploader(false);
        }
      } catch (error) {
        console.error('Init error:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    initializeApp();
  }, []);

  const handleImportComplete = () => {
    setHasData(true);
    setShowFileUploader(false);
  };

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-lg text-muted-foreground">Startar Meta Analytics...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container py-4">
          <h1 className="text-2xl font-bold text-foreground">Meta Analytics</h1>
        </div>
      </header>
      <main className="container py-6">
        <div className="grid gap-6">
          {showFileUploader ? (
            <FileUploader
              onImportComplete={handleImportComplete}
              onCancel={() => hasData && setShowFileUploader(false)}
            />
          ) : (
            <MainView onShowUploader={() => setShowFileUploader(true)} />
          )}
        </div>
      </main>
      <footer className="border-t border-border">
        <div className="container py-4 text-center text-sm text-muted-foreground">
          Meta Analytics v{VERSION} &copy; {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}

export default App;
