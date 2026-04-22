import React, { useState, useRef, useCallback } from 'react';
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
  X,
  RefreshCw
} from 'lucide-react';
import Papa from 'papaparse';
import PlatformBadge from '../ui/PlatformBadge';
import { api } from '@/utils/apiClient';

const FILE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error'
};

export function FileUploader({ onImportComplete, onCancel }) {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState(null);
  const fileInputRef = useRef(null);

  const addFiles = useCallback(async (newFiles) => {
    const csvFiles = Array.from(newFiles).filter(
      f => f.type === 'text/csv' || f.name.endsWith('.csv')
    );
    if (csvFiles.length === 0) return;

    const fileEntries = [];

    for (const file of csvFiles) {
      // Read first 4KB to detect file type
      const preview = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = Papa.parse(e.target.result, { header: true, preview: 1 });
          resolve(result.meta?.fields || []);
        };
        reader.readAsText(file.slice(0, 4096));
      });

      // Reach export: identified by the combination of Page, Page ID and Reach headers
      const isReach = preview.includes('Page') &&
                      preview.includes('Page ID') &&
                      preview.includes('Reach');

      // GA listens export: must have Programnamn and at least one listening column
      const isGaListens = !isReach &&
        preview.includes('Programnamn') &&
        preview.some(h => {
          const lower = h.toLowerCase();
          return lower.includes('lyssningar')
              || lower.includes('lyssnat')
              || lower.startsWith('starter');
        });

      // GA site visits export: must have Programnamn and a "besök" column
      const isGaSiteVisits = !isReach && !isGaListens &&
        preview.includes('Programnamn') &&
        preview.some(h => h.toLowerCase().includes('besök'));

      // IG reach export: ig_username + ig_name + Reach + Period_start
      const isIGReach = !isReach && !isGaListens && !isGaSiteVisits &&
        preview.includes('ig_username') &&
        preview.includes('ig_name') &&
        preview.includes('Reach') &&
        preview.includes('Period_start');

      // Try to extract month from filename pattern YYYY_MM or YYYY-MM
      let autoMonth = '';
      if (isReach || isGaListens || isGaSiteVisits) {
        const monthMatch = file.name.match(/(\d{4})[_-](\d{2})(?:[_-]|\.|$)/i);
        if (monthMatch) {
          autoMonth = `${monthMatch[1]}-${monthMatch[2]}`;
        }
      }

      let fileType = 'posts';
      if (isReach) fileType = 'reach';
      else if (isGaListens) fileType = 'ga_listens';
      else if (isGaSiteVisits) fileType = 'ga_site_visits';
      else if (isIGReach) fileType = 'ig_reach';

      fileEntries.push({
        id: `${file.name}-${Date.now()}-${Math.random()}`,
        file,
        status: FILE_STATUS.PENDING,
        error: null,
        result: null,
        fileType,
        reachMonth: isReach ? autoMonth : '',
        gaListensMonth: isGaListens ? autoMonth : '',
        gaSiteVisitsMonth: isGaSiteVisits ? autoMonth : '',
      });
    }

    setFiles(prev => [...prev, ...fileEntries]);
  }, []);

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

  const handleProcessFiles = async () => {
    const pendingFiles = files.filter(f =>
      f.status === FILE_STATUS.PENDING || f.status === FILE_STATUS.ERROR
    );
    if (pendingFiles.length === 0) return;

    setIsProcessing(true);
    setBatchResult(null);

    let succeeded = 0;
    let failed = 0;

    for (const entry of pendingFiles) {
      setFiles(prev => prev.map(f =>
        f.id === entry.id ? { ...f, status: FILE_STATUS.PROCESSING } : f
      ));

      try {
        let result;
        if (entry.fileType === 'reach') {
          if (!entry.reachMonth) {
            throw new Error('Ange vilken månad räckviddsfilen gäller.');
          }
          result = await api.uploadReachCSV(entry.file, entry.reachMonth);
        } else if (entry.fileType === 'ga_listens') {
          // Month is mandatory because GA exports contain no date information
          if (!entry.gaListensMonth) {
            throw new Error('Ange vilken månad lyssnarfilen gäller.');
          }
          result = await api.uploadGAListensCSV(entry.file, entry.gaListensMonth);
        } else if (entry.fileType === 'ga_site_visits') {
          if (!entry.gaSiteVisitsMonth) {
            throw new Error('Ange vilken månad sajtbesökfilen gäller.');
          }
          result = await api.uploadGASiteVisitsCSV(entry.file, entry.gaSiteVisitsMonth);
        } else if (entry.fileType === 'ig_reach') {
          result = await api.uploadIGReachCSV(entry.file);
        } else {
          result = await api.uploadCSV(entry.file);
        }
        succeeded++;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? {
            ...f,
            status: FILE_STATUS.SUCCESS,
            result,
            platform: result.import?.platform,
          } : f
        ));
      } catch (err) {
        failed++;
        setFiles(prev => prev.map(f =>
          f.id === entry.id ? { ...f, status: FILE_STATUS.ERROR, error: err.message } : f
        ));
      }
    }

    const batchRes = { succeeded, failed, total: pendingFiles.length };
    setBatchResult(batchRes);
    setIsProcessing(false);

    if (succeeded > 0) {
      setTimeout(() => {
        onImportComplete();
      }, 1500);
    }
  };

  const pendingCount = files.filter(f => f.status === FILE_STATUS.PENDING).length;
  const failedCount = files.filter(f => f.status === FILE_STATUS.ERROR).length;

  return (
    <div className="space-y-4">
      {batchResult && (
        <Alert className={batchResult.failed === 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}>
          <CheckCircle2 className={`h-4 w-4 ${batchResult.failed === 0 ? 'text-green-600' : 'text-yellow-600'}`} />
          <AlertTitle className={batchResult.failed === 0 ? 'text-green-800' : 'text-yellow-800'}>
            Import klar
          </AlertTitle>
          <AlertDescription className={batchResult.failed === 0 ? 'text-green-700' : 'text-yellow-700'}>
            {batchResult.succeeded} av {batchResult.total} filer importerades framgångsrikt.
            {batchResult.failed > 0 && ` ${batchResult.failed} fil(er) misslyckades.`}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">Läs in Meta-statistik</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`
              border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
              ${isDragging ? 'border-primary bg-primary/10' : files.length > 0 ? 'border-primary bg-primary/5' : 'border-border'}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileInputChange}
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
                  Stöder Facebook- och Instagram-statistik från Meta Business Suite, kontoräckvidd (API) och Google Analytics.
                  Data sparas permanent i databasen.
                </p>
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
                      <p className="font-medium truncate flex items-center gap-1.5">
                        {entry.file.name}
                        {entry.platform && <PlatformBadge platform={entry.platform} />}
                        {entry.fileType === 'reach' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Kontoräckvidd
                          </span>
                        )}
                        {entry.fileType === 'ga_listens' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Lyssningar (GA)
                          </span>
                        )}
                        {entry.fileType === 'ga_site_visits' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-300">
                            Sajtbesök (GA)
                          </span>
                        )}
                        {entry.fileType === 'ig_reach' && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded bg-pink-100 text-pink-800 border border-pink-300">
                            Kontoräckvidd IG (API)
                          </span>
                        )}
                      </p>
                      {entry.result && (
                        <p className="text-xs text-green-600">
                          {entry.result.stats?.postsInserted || 0} nya,{' '}
                          {entry.result.stats?.postsUpdated || 0} uppdaterade
                        </p>
                      )}
                      {entry.fileType === 'reach' && entry.status === FILE_STATUS.PENDING && entry.reachMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.reachMonth}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, reachMonth: '' } : f
                              ));
                            }}
                          >
                            Ändra
                          </button>
                        </p>
                      )}
                      {entry.fileType === 'reach' && entry.status === FILE_STATUS.PENDING && !entry.reachMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.reachMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, reachMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
                      )}
                      {entry.fileType === 'ga_listens' && entry.status === FILE_STATUS.PENDING && entry.gaListensMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.gaListensMonth}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaListensMonth: '' } : f
                              ));
                            }}
                          >
                            Ändra
                          </button>
                        </p>
                      )}
                      {entry.fileType === 'ga_listens' && entry.status === FILE_STATUS.PENDING && !entry.gaListensMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.gaListensMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaListensMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
                      )}
                      {entry.fileType === 'ga_site_visits' && entry.status === FILE_STATUS.PENDING && entry.gaSiteVisitsMonth && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Månad: {entry.gaSiteVisitsMonth}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaSiteVisitsMonth: '' } : f
                              ));
                            }}
                          >
                            Ändra
                          </button>
                        </p>
                      )}
                      {entry.fileType === 'ga_site_visits' && entry.status === FILE_STATUS.PENDING && !entry.gaSiteVisitsMonth && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Månad:</span>
                          <input
                            type="month"
                            value={entry.gaSiteVisitsMonth}
                            onChange={(e) => {
                              e.stopPropagation();
                              setFiles(prev => prev.map(f =>
                                f.id === entry.id ? { ...f, gaSiteVisitsMonth: e.target.value } : f
                              ));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border border-input rounded px-2 py-0.5 text-xs"
                            required
                          />
                        </div>
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
              disabled={pendingCount === 0 || isProcessing}
              className="min-w-[120px]"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importerar...
                </>
              ) : (
                `Importera ${pendingCount > 0 ? pendingCount + ' fil' + (pendingCount !== 1 ? 'er' : '') : ''}`
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
