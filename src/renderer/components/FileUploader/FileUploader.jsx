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

  const addFiles = useCallback((newFiles) => {
    const csvFiles = Array.from(newFiles).filter(
      f => f.type === 'text/csv' || f.name.endsWith('.csv')
    );
    if (csvFiles.length === 0) return;

    const fileEntries = csvFiles.map(file => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      status: FILE_STATUS.PENDING,
      error: null,
      result: null,
    }));

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
        const result = await api.uploadCSV(entry.file);
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
                  Stöder Facebook- och Instagram-statistik från Meta Business Suite.
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
                      </p>
                      {entry.result && (
                        <p className="text-xs text-green-600">
                          {entry.result.stats?.postsInserted || 0} nya,{' '}
                          {entry.result.stats?.postsUpdated || 0} uppdaterade
                        </p>
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
