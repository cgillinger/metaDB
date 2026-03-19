import React, { useState, useEffect } from 'react';
import { FileUploader } from "./components/FileUploader";
import MainView from "./components/MainView";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { InfoIcon, AlertTriangle } from "lucide-react";
import { getMemoryUsageStats, clearAllData, checkAndCleanupStaleData, getPostViewData, getAccountViewData, getUploadedFilesMetadata } from '@/utils/storageService';
import { MEMORY_THRESHOLDS } from '@/utils/memoryUtils';
import { VERSION } from '@/utils/version';

function App() {
  const [processedData, setProcessedData] = useState(null);
  const [showFileUploader, setShowFileUploader] = useState(true);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check if data is older than 12h — if so, auto-clean
        const wasCleanedUp = await checkAndCleanupStaleData();

        if (!wasCleanedUp) {
          // Data is fresh (< 12h) — try to restore it
          const savedPosts = await getPostViewData();
          if (savedPosts && savedPosts.length > 0) {
            const savedAccounts = getAccountViewData();
            const savedFiles = await getUploadedFilesMetadata();
            setProcessedData({
              rows: savedPosts,
              accountViewData: savedAccounts,
              meta: {
                isMergedData: savedFiles.length > 1,
                fileCount: savedFiles.length,
                files: savedFiles
              }
            });
            setShowFileUploader(false);
          }
        }
      } catch (error) {
        console.error('Init error:', error);
      } finally {
        setIsInitialized(true);
      }
    };
    initializeApp();
  }, []);

  useEffect(() => {
    if (isInitialized) {
      getMemoryUsageStats().then(stats => {
        if (stats && parseFloat(stats.percentUsed) >= MEMORY_THRESHOLDS.WARNING) {
          setMemoryWarning(true);
        }
      }).catch(() => {});
    }
  }, [isInitialized]);

  const handleDataProcessed = (data) => {
    setProcessedData(data);
    setShowFileUploader(false);
    getMemoryUsageStats().then(stats => {
      setMemoryWarning(stats && parseFloat(stats.percentUsed) >= MEMORY_THRESHOLDS.WARNING);
    }).catch(() => {});
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
          {memoryWarning && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">Minnesvarning</AlertTitle>
              <AlertDescription className="text-yellow-700">
                Minnesanvändningen är hög. Rensa data om du upplever prestandaproblem.
              </AlertDescription>
            </Alert>
          )}
          {showFileUploader ? (
            <FileUploader onDataProcessed={handleDataProcessed} onCancel={() => processedData && setShowFileUploader(false)} />
          ) : (
            <>
              {processedData?.meta?.stats?.duplicates > 0 && (
                <Alert className="bg-blue-50 border-blue-200">
                  <InfoIcon className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-700">
                    {processedData.meta.stats.duplicates} dubletter hittades och har filtrerats bort.
                  </AlertDescription>
                </Alert>
              )}
              <MainView data={processedData.rows} meta={processedData.meta} onDataProcessed={handleDataProcessed} />
            </>
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
