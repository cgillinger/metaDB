import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import {
  UploadCloud,
  FileWarning,
  Loader2,
  CheckCircle2,
  AlertCircle,
  PlusCircle,
  HardDrive,
  Info,
  X,
  RefreshCw
} from 'lucide-react';
import { handleFileUpload, getMemoryUsageStats, clearAllData, getUploadedFilesMetadata } from '@/utils/storageService';
import { processCSVData, analyzeCSVFile } from '@/utils/webDataProcessor';
import { useColumnMapper } from './useColumnMapper';
import { StorageIndicator } from '../StorageIndicator/StorageIndicator';
import { calculateMemoryWithNewFile } from '@/utils/memoryUtils';

const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error'
};

const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram'
};

export function FileUploader({ onDataProcessed, onCancel, existingData = null, isNewAnalysis = false }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [memoryCheck, setMemoryCheck] = useState({ canAddFile: true, status: 'safe' });
  const [existingFilesMetadata, setExistingFilesMetadata] = useState([]);
  const fileInputRef = useRef(null);
  const { validateColumns } = useColumnMapper();

  useEffect(() => {
    const init = async () => {
      try {
        const stats = await getMemoryUsageStats();
        setMemoryUsage(stats);
        const existing = await getUploadedFilesMetadata();
        setExistingFilesMetadata(existing);
      } catch (err) {
        console.error('Fel vid init:', err);
      }
    };
    init();
  }, []);

  const isDuplicateFile = (file) => {
    if (!existingFilesMetadata || existingFilesMetadata.length === 0) return false;
    return existingFilesMetadata.find(f => f.originalFileName === file.name) || null;
  };

  const addFiles = useCallback(async (newFiles) => {
    const csvFiles = Array.from(newFiles).filter(
      f => f.type === 'text/csv' || f.name.endsWith('.csv')
    );
    if (csvFiles.length === 0) return;

    const fileEntries = csvFiles.map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      status: FILE_STATUS.PENDING,
      error: null,
      analysis: null,
      result: null,
      platform: null,
      duplicateInfo: !isNewAnalysis ? isDuplicateFile(file) : null
    }));

    const analyzedEntries = await Promise.all(
      fileEntries.map(async entry => {
        try {
          const content = await handleFileUpload(entry.file);
          const analysis = await analyzeCSVFile(content);
          // Detect platform from headers
          const validation = validateColumns(content);
          return { ...entry, analysis, _content: content, platform: validation.platform };
        } catch {
          return entry;
        }
      })
    );

    setFiles(prev => [...prev, ...analyzedEntries]);

    if (analyzedEntries[0]?.analysis && memoryUsage) {
      const projection = calculateMemoryWithNewFile(analyzedEntries[0].analysis, memoryUsage);
      setMemoryCheck(projection);
    }
  }, [existingFilesMetadata, isNewAnalysis, memoryUsage, validateColumns]);

  const handleFileInputChange = (event) => {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files);
      event.target.value = '';
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
    setBatchResult(null);
  };

  const retryFailed = () => {
    setFiles(prev => prev.map(f =>
      f.status === FILE_STATUS.ERROR ? { ...f, status: FILE_STATUS.PENDING, error: null } : f
    ));
    setBatchResult(null);
  };

  const processSingleFile = async (entry, shouldMerge, isFirst) => {
    try {
      let content = entry._content;
      if (!content) {
        content = await handleFileUpload(entry.file);
      }

      const validation = validateColumns(content);
      if (!validation.isValid && validation.platform === null) {
        throw new Error('Kunde inte identifiera plattform (Facebook eller Instagram) från CSV-kolumnerna.');
      }

      if (isNewAnalysis && isFirst) {
        await clearAllData();
      }

      const processedData = await processCSVData(
        content,
        shouldMerge,
        entry.file.name
      );

      return { success: true, data: processedData };
    } catch (err) {
      console.error('Fel vid bearbetning av fil:', entry.file.name, err);
      return { success: false, error: err.message };
    }
  };

  const handleProcessFiles = async () => {
    const pendingFiles = files.filter(f =>
      f.status === FILE_STATUS.PENDING || f.status === FILE_STATUS.ERROR
    );
    if (pendingFiles.length === 0) return;

    setIsProcessing(true);
    setBatchResult(null);

    let succeeded = 0;
    let failed = 0;
    let lastSuccessData = null;
    let shouldMerge = existingData != null && !isNewAnalysis;

    for (let i = 0; i < pendingFiles.length; i++) {
      const entry = pendingFiles[i];
      const isFirst = i === 0;

      setFiles(prev => prev.map(f =>
        f.id === entry.id ? { ...f, status: FILE_STATUS.PROCESSING } : f
      ));

      const result = await processSingleFile(entry, shouldMerge || (i > 0), isFirst);

      if (result.success) {
        succeeded++;
        lastSuccessData = result.data;
        shouldMerge = true;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? { ...f, status: FILE_STATUS.SUCCESS, result: result.data } : f
        ));
      } else {
        failed++;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? { ...f, status: FILE_STATUS.ERROR, error: result.error } : f
        ));
      }
    }

    const batchRes = { succeeded, failed, total: pendingFiles.length };
    setBatchResult(batchRes);
    setIsProcessing(false);

    if (succeeded > 0 && lastSuccessData) {
      setTimeout(() => {
        onDataProcessed(lastSuccessData);
      }, 1500);
    }
  };

  const handleMemoryUpdate = (stats) => {
    setMemoryUsage(stats);
  };

  const pendingCount = files.filter(f => f.status === FILE_STATUS.PENDING).length;
  const failedCount = files.filter(f => f.status === FILE_STATUS.ERROR).length;
  const totalMemoryKB = files.reduce((sum, f) => sum + (f.analysis?.fileSizeKB || 0), 0);

  const titleText = isNewAnalysis
    ? 'Återställ data - Ladda CSV'
    : existingData
      ? 'Lägg till mer statistik'
      : 'Läs in Meta-statistik';

  return (
    <div className="space-y-4">
      {existingData && !isNewAnalysis && (
        <StorageIndicator onUpdate={handleMemoryUpdate} />
      )}

      {batchResult && (
        <Alert className={batchResult.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}>
          <CheckCircle2 className={`h-4 w-4 ${batchResult.failed === 0 ? 'text-green-600' : 'text-yellow-600'}`} />
          <AlertTitle className={batchResult.failed === 0 ? 'text-green-800' : 'text-yellow-800'}>
            Bearbetning klar
          </AlertTitle>
          <AlertDescription className={batchResult.failed === 0 ? 'text-green-700' : 'text-yellow-700'}>
            {batchResult.succeeded} av {batchResult.total} filer bearbetades framgångsrikt.
            {batchResult.failed > 0 && ` ${batchResult.failed} fil(er) misslyckades.`}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">{titleText}</CardTitle>
          {existingData && !isNewAnalysis && (
            <div className="text-sm text-muted-foreground flex items-center">
              <HardDrive className="w-4 h-4 mr-1" />
              <span>Nuvarande: {existingData.length} inlägg</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isNewAnalysis && (
            <Alert className="mb-4 bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertTitle className="text-blue-800">Återställ data</AlertTitle>
              <AlertDescription className="text-blue-700">
                Om du fortsätter kommer all befintlig data att ersättas med denna nya analys.
              </AlertDescription>
            </Alert>
          )}

          {existingData && !isNewAnalysis && memoryCheck.status === 'critical' && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Minnesbegränsning</AlertTitle>
              <AlertDescription>
                Systemet har inte tillräckligt med minne för att lägga till mer data.
                Rensa befintlig data innan du fortsätter.
              </AlertDescription>
            </Alert>
          )}

          <div
            className={`
              border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-primary bg-primary/10' : files.length > 0 ? 'border-primary bg-primary/5' : 'border-border'}
              ${!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              if (isNewAnalysis || memoryCheck.canAddFile) {
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              disabled={!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile}
            />
            <div className="flex flex-col items-center space-y-3">
              {files.length > 0 ? (
                <PlusCircle className="w-10 h-10 text-primary" />
              ) : (
                <UploadCloud className="w-10 h-10 text-muted-foreground" />
              )}
              <div className="space-y-1">
                <h3 className="text-base font-semibold">
                  {isDragging
                    ? 'Släpp filerna här'
                    : files.length > 0
                      ? 'Lägg till fler filer'
                      : 'Släpp CSV-filer här eller klicka för att bläddra'}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Stöder Facebook- och Instagram-statistik. Data behandlas lokalt i din webbläsare.
                </p>
                {totalMemoryKB > 0 && (
                  <p className="text-sm text-primary">
                    Totalt: {totalMemoryKB} KB från {files.length} fil{files.length !== 1 ? 'er' : ''}
                  </p>
                )}
              </div>
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">
                  {files.length} fil{files.length !== 1 ? 'er' : ''} valda
                </span>
                <div className="flex space-x-2">
                  {failedCount > 0 && (
                    <Button variant="outline" size="sm" onClick={retryFailed}>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Försök igen ({failedCount})
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={clearAll} disabled={isProcessing}>
                    Rensa alla
                  </Button>
                </div>
              </div>

              {files.map(entry => (
                <div
                  key={entry.id}
                  className={`flex items-center justify-between p-3 rounded-md border text-sm ${
                    entry.status === FILE_STATUS.SUCCESS ? 'bg-green-50 border-green-200' :
                    entry.status === FILE_STATUS.ERROR ? 'bg-red-50 border-red-200' :
                    entry.status === FILE_STATUS.PROCESSING ? 'bg-blue-50 border-blue-200' :
                    'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-2 flex-1 min-w-0">
                    {entry.status === FILE_STATUS.PROCESSING && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.SUCCESS && (
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.ERROR && (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    {entry.status === FILE_STATUS.PENDING && (
                      <FileWarning className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{entry.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.analysis
                          ? `${entry.analysis.rows} rader · ${entry.analysis.fileSizeKB} KB`
                          : ''}
                        {entry.platform
                          ? ` · ${PLATFORM_LABELS[entry.platform] || entry.platform}`
                          : ''}
                      </p>
                      {entry.duplicateInfo && entry.status === FILE_STATUS.PENDING && (
                        <p className="text-xs text-yellow-600">Möjlig dublett – filen verkar redan vara uppladdad</p>
                      )}
                      {entry.error && (
                        <p className="text-xs text-red-600">{entry.error}</p>
                      )}
                    </div>
                  </div>
                  {entry.status !== FILE_STATUS.PROCESSING && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-shrink-0 h-6 w-6 p-0"
                      onClick={() => removeFile(entry.id)}
                      disabled={isProcessing}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end space-x-2">
            {onCancel && (
              <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
                Avbryt
              </Button>
            )}
            <Button
              onClick={handleProcessFiles}
              disabled={pendingCount === 0 || isProcessing || (!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile)}
              className="min-w-[120px]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Bearbetar...
                </>
              ) : isNewAnalysis
                  ? 'Återställ data'
                  : existingData
                    ? `Lägg till ${pendingCount > 0 ? pendingCount + ' fil' + (pendingCount !== 1 ? 'er' : '') : 'data'}`
                    : `Bearbeta ${pendingCount > 0 ? pendingCount + ' fil' + (pendingCount !== 1 ? 'er' : '') : ''}`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
