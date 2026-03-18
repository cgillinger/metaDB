import React, { useState, useEffect } from 'react';
import { FileUploader } from "./components/FileUploader";
import MainView from "./components/MainView";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { InfoIcon, AlertTriangle, RefreshCw } from "lucide-react";
import { getMemoryUsageStats, clearAllData } from '@/utils/webStorageService';
import { MEMORY_THRESHOLDS } from '@/utils/memoryUtils';

function App() {
  const [processedData, setProcessedData] = useState(null);
  const [showFileUploader, setShowFileUploader] = useState(true);
  const [memoryWarning, setMemoryWarning] = useState(false);
  const [isClearing, setIsClearing] = useState(true);
  const [clearError, setClearError] = useState(null);
  
  // Rensa alla data vid appstart
  useEffect(() => {
    const clearDataOnStart = async () => {
      setIsClearing(true);
      try {
        console.log('Rensar alla gamla data vid appstart...');
        await clearAllData();
        console.log('Minnet har rensats framgångsrikt');
        setClearError(null);
      } catch (error) {
        console.error('Fel vid rensning av minnet:', error);
        setClearError('Det gick inte att rensa minnesdata. Vissa äldre data kan finnas kvar.');
      } finally {
        setIsClearing(false);
      }
    };
    
    clearDataOnStart();
  }, []);
  
  // Kontrollera minnesanvändning efter rensning
  useEffect(() => {
    if (!isClearing) {
      checkMemory();
    }
  }, [isClearing]);
  
  const checkMemory = async () => {
    try {
      const stats = await getMemoryUsageStats();
      if (stats && parseFloat(stats.percentUsed) >= MEMORY_THRESHOLDS.WARNING) {
        setMemoryWarning(true);
      } else {
        setMemoryWarning(false);
      }
    } catch (error) {
      console.error('Fel vid kontroll av minnesanvändning:', error);
    }
  };
  
  const handleDataProcessed = (data) => {
    setProcessedData(data);
    setShowFileUploader(false);
    console.log('Data processerad:', data);
    
    // Kontrollera minnesanvändning efter datainläsning
    checkMemory();
  };

  const handleCancel = () => {
    if (processedData) {
      setShowFileUploader(false);
    }
  };

  // Kontrollera om det finns dublettinformation
  const hasDuplicateInfo = processedData?.meta?.stats?.duplicates > 0;
  
  // Visa laddningsindikator medan appen rensar minnet
  if (isClearing) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <h2 className="text-xl font-medium mb-2">Förbereder appen</h2>
          <p className="text-muted-foreground">Rensar gammalt minne för optimal prestanda...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container py-4">
          <h1 className="text-2xl font-bold text-foreground">
            Instagram Statistik
          </h1>
        </div>
      </header>

      <main className="container py-6">
        <div className="grid gap-6">
          {/* Visa eventuellt felmeddelande från rensning */}
          {clearError && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">Minnesvarning</AlertTitle>
              <AlertDescription className="text-yellow-700">
                {clearError}
              </AlertDescription>
            </Alert>
          )}
          
          {/* Minnesvarning visas överst om den är aktiv */}
          {memoryWarning && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">Minnesvarning</AlertTitle>
              <AlertDescription className="text-yellow-700">
                Minnesanvändningen är hög. Om du upplever prestandaproblem kan du behöva rensa viss data.
              </AlertDescription>
            </Alert>
          )}
        
          {showFileUploader ? (
            <FileUploader 
              onDataProcessed={handleDataProcessed} 
              onCancel={handleCancel}
            />
          ) : (
            <>
              {hasDuplicateInfo && (
                <Alert variant="info" className="bg-blue-50 border-blue-200">
                  <InfoIcon className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-700">
                    {processedData.meta.stats.duplicates} dubletter hittades och har filtrerats bort. Dessa räknas inte in i resultaten.
                  </AlertDescription>
                </Alert>
              )}
              <MainView 
                data={processedData.rows} 
                meta={processedData.meta}
                onDataProcessed={handleDataProcessed}
              />
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="container py-4 text-center text-sm text-muted-foreground">
          Instagram Statistik © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}

export default App;