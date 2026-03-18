import React, { useState, useRef, useEffect } from 'react';
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
  FileText,
  X,
  Calendar,
  BarChart3,
  Clock,
  XCircle
} from 'lucide-react';
import { handleFileUpload, getMemoryUsageStats, clearAllData, getUploadedFilesMetadata } from '@/utils/webStorageService';
import { processPostData, analyzeCSVFile } from '@/utils/webDataProcessor';
import { useColumnMapper } from './useColumnMapper';
import { MemoryIndicator } from '../MemoryIndicator/MemoryIndicator';
import { calculateMemoryWithNewFile } from '@/utils/memoryUtils';

export function FileUploader({ onDataProcessed, onCancel, existingData = null, isNewAnalysis = false }) {
  // Multi-file state
  const [files, setFiles] = useState([]);
  const [currentProcessingIndex, setCurrentProcessingIndex] = useState(-1);
  const [totalFilesCount, setTotalFilesCount] = useState(0);
  const [processingStatus, setProcessingStatus] = useState({});
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, percentage: 0 });
  const [batchResults, setBatchResults] = useState({ success: 0, failed: 0, total: 0 });
  
  // Befintlig state för kompatibilitet
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [duplicateStats, setDuplicateStats] = useState(null);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [csvContent, setCsvContent] = useState(null);
  const [fileAnalysis, setFileAnalysis] = useState(null);
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [memoryCheck, setMemoryCheck] = useState({ canAddFile: true, status: 'safe' });
  const [existingFiles, setExistingFiles] = useState([]);
  const [possibleDuplicate, setPossibleDuplicate] = useState(null);
  const [estimatedFilesRemaining, setEstimatedFilesRemaining] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [allProcessedData, setAllProcessedData] = useState([]);
  
  const fileInputRef = useRef(null);
  const { columnMappings, validateColumns, missingColumns } = useColumnMapper();

  // Kontrollera minnesanvändning och hämta existerande filer vid montering
  useEffect(() => {
    const checkMemoryAndFiles = async () => {
      try {
        const stats = await getMemoryUsageStats();
        setMemoryUsage(stats);
        setEstimatedFilesRemaining(stats.estimatedAdditionalFiles || 0);
        
        const files = await getUploadedFilesMetadata();
        setExistingFiles(files);
      } catch (error) {
        console.error('Fel vid kontroll av minnesanvändning eller filmetadata:', error);
      }
    };
    
    checkMemoryAndFiles();
  }, []);

  // Kontrollera om filen redan finns
  const checkIfDuplicate = (selectedFile) => {
    if (!selectedFile || !existingFiles || existingFiles.length === 0) return false;
    
    const fileName = selectedFile.name;
    const duplicate = existingFiles.find(f => f.originalFileName === fileName);
    
    return duplicate;
  };

  // Analysera flera filer för minneskontroll
  const analyzeMultipleFiles = async (fileObjects) => {
    let totalEstimatedSize = 0;
    const analysisPromises = fileObjects.slice(0, 3).map(async (fileObj) => {
      try {
        const content = await handleFileUpload(fileObj.file);
        const analysis = await analyzeCSVFile(content);
        return analysis;
      } catch (error) {
        console.error(`Fel vid analys av ${fileObj.name}:`, error);
        return null;
      }
    });

    const analyses = await Promise.all(analysisPromises);
    const validAnalyses = analyses.filter(a => a !== null);
    
    if (validAnalyses.length > 0) {
      const avgSize = validAnalyses.reduce((sum, a) => sum + a.fileSize, 0) / validAnalyses.length;
      totalEstimatedSize = avgSize * fileObjects.length;
    }

    return {
      totalEstimatedSize,
      avgFileSize: validAnalyses.length > 0 ? totalEstimatedSize / fileObjects.length : 0,
      analyses: validAnalyses
    };
  };

  // Hantera flera filer
  const handleFileChange = async (event) => {
    const selectedFiles = Array.from(event.target.files);
    if (selectedFiles.length === 0) return;

    // Skapa fil-objekt array
    const fileObjects = selectedFiles.map(file => {
      const duplicate = checkIfDuplicate(file);
      return {
        file,
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name: file.name,
        size: file.size,
        status: duplicate && !isNewAnalysis ? 'duplicate' : 'pending',
        error: null,
        analysis: null,
        duplicate: duplicate || null,
        uploadId: `${Date.now()}_${Math.random()}`,
        validationResult: null
      };
    });

    // Kontrollera dubletter
    const duplicateFiles = fileObjects.filter(f => f.status === 'duplicate');
    if (duplicateFiles.length > 0 && !isNewAnalysis) {
      setPossibleDuplicate({
        file: duplicateFiles[0].file,
        existingFile: duplicateFiles[0].duplicate,
        allFiles: fileObjects
      });
      return;
    }

    setFiles(fileObjects);
    setTotalFilesCount(selectedFiles.length);
    setError(null);
    setValidationResult(null);
    setCsvContent(null);
    setPossibleDuplicate(null);

    // Analysera filer för minneskontroll
    try {
      setIsLoading(true);
      const multiAnalysis = await analyzeMultipleFiles(fileObjects);
      
      if (memoryUsage && multiAnalysis.totalEstimatedSize > 0) {
        const fakeAnalysis = {
          rows: multiAnalysis.analyses[0]?.rows * fileObjects.length || 1000,
          columns: multiAnalysis.analyses[0]?.columns || 10,
          fileSize: multiAnalysis.totalEstimatedSize
        };
        
        const projection = calculateMemoryWithNewFile(fakeAnalysis, memoryUsage);
        setMemoryCheck(projection);
        
        if (projection.status === 'critical') {
          setError(`Varning: ${fileObjects.length} filer kommer använda ~${multiAnalysis.totalEstimatedSize / (1024*1024).toFixed(1)} MB. Minnesanvändningen blir kritisk.`);
        }
        
        setEstimatedFilesRemaining(projection.estimatedRemainingFiles || 0);
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('Fel vid batch-analys:', error);
      setIsLoading(false);
    }
  };

  // Ta bort fil från listan
  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    setTotalFilesCount(prev => Math.max(0, prev - 1));
  };

  // Rensa alla filer
  const clearAllFiles = () => {
    setFiles([]);
    setTotalFilesCount(0);
    setError(null);
    setValidationResult(null);
    setBatchProgress({ current: 0, total: 0, percentage: 0 });
    setBatchResults({ success: 0, failed: 0, total: 0 });
    setProcessingStatus({});
    setAllProcessedData([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // BATCH PROCESSERING - Huvudfunktionen
  const processBatchFiles = async () => {
    if (files.length === 0) {
      setError('Inga filer valda');
      return;
    }

    if (!isNewAnalysis && memoryCheck && memoryCheck.status === 'critical' && !memoryCheck.canAddFile) {
      setError('Kan inte lägga till mer data: Minnesanvändningen skulle bli för hög. Rensa befintlig data först.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setDuplicateStats(null);
    setValidationResult(null);
    setAllProcessedData([]);

    // Rensa tidigare data om ny analys
    if (isNewAnalysis) {
      try {
        await clearAllData();
        console.log('Tidigare data rensad för ny analys');
      } catch (clearError) {
        console.error('Fel vid rensning av data för ny analys:', clearError);
      }
    }

    // Initiera progress
    const validFiles = files.filter(f => f.status !== 'duplicate');
    setBatchProgress({ current: 0, total: validFiles.length, percentage: 0 });
    setBatchResults({ success: 0, failed: 0, total: validFiles.length });

    let processedDataArray = [];
    let totalDuplicates = 0;
    let shouldMergeWithExisting = existingData && !isNewAnalysis;

    // Processera filer sekventiellt
    for (let i = 0; i < validFiles.length; i++) {
      const fileObj = validFiles[i];
      setCurrentProcessingIndex(i);
      
      // Uppdatera status till "processing"
      setProcessingStatus(prev => ({ ...prev, [fileObj.id]: 'processing' }));
      setFiles(prev => prev.map(f => 
        f.id === fileObj.id ? { ...f, status: 'processing' } : f
      ));

      try {
        console.log(`Processar fil ${i + 1}/${validFiles.length}: ${fileObj.name}`);
        
        // Läs filinnehåll
        const content = await handleFileUpload(fileObj.file);
        
        // Validera kolumner
        let validation;
        try {
          validation = validateColumns(content);
          
          // Spara validering i fil-objektet
          setFiles(prev => prev.map(f => 
            f.id === fileObj.id ? { ...f, validationResult: validation } : f
          ));

          if (!validation.isValid && validation.missing && validation.missing.length > 0) {
            throw new Error(`Validering misslyckades: ${validation.missing.map(m => m.displayName || m.original).join(', ')}`);
          }
        } catch (validationError) {
          throw new Error(`Validering misslyckades: ${validationError.message}`);
        }

        // Processera data
        const processedData = await processPostData(
          content, 
          columnMappings, 
          shouldMergeWithExisting || processedDataArray.length > 0, // Merge med tidigare processerade filer
          fileObj.name
        );

        if (processedData.meta?.stats?.duplicates > 0) {
          totalDuplicates += processedData.meta.stats.duplicates;
        }

        processedDataArray.push(processedData);

        // Markera som klar
        setProcessingStatus(prev => ({ ...prev, [fileObj.id]: 'success' }));
        setFiles(prev => prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'success' } : f
        ));

        // Uppdatera resultat
        setBatchResults(prev => ({ 
          ...prev, 
          success: prev.success + 1 
        }));

        console.log(`Fil ${fileObj.name} processerad framgångsrikt`);
        
      } catch (error) {
        console.error(`Fel vid processering av ${fileObj.name}:`, error);
        
        // Markera som fel
        setProcessingStatus(prev => ({ ...prev, [fileObj.id]: 'error' }));
        setFiles(prev => prev.map(f => 
          f.id === fileObj.id ? { ...f, status: 'error', error: error.message } : f
        ));

        // Uppdatera resultat
        setBatchResults(prev => ({ 
          ...prev, 
          failed: prev.failed + 1 
        }));
      }

      // Uppdatera progress
      const newCurrent = i + 1;
      const newPercentage = Math.round((newCurrent / validFiles.length) * 100);
      setBatchProgress({ 
        current: newCurrent, 
        total: validFiles.length, 
        percentage: newPercentage 
      });

      // Kort paus mellan filer
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    setCurrentProcessingIndex(-1);
    setIsLoading(false);

    // Sammanställ resultat
    if (processedDataArray.length > 0) {
      // Använd den sista processade datan som slutresultat (innehåller all sammanslagen data)
      const finalData = processedDataArray[processedDataArray.length - 1];
      
      if (totalDuplicates > 0) {
        setDuplicateStats({
          duplicates: totalDuplicates,
          totalRows: finalData.rows.length + totalDuplicates
        });
      }

      setAllProcessedData(processedDataArray);
      setShowSuccessMessage(true);
      
      setTimeout(() => {
        setShowSuccessMessage(false);
        
        // Lägg till batch-info i metadata
        if (finalData.meta) {
          finalData.meta.batchInfo = {
            totalFiles: validFiles.length,
            successfulFiles: processedDataArray.length,
            failedFiles: validFiles.length - processedDataArray.length,
            filenames: processedDataArray.map((_, idx) => validFiles[idx]?.name).filter(Boolean)
          };
        }
        
        onDataProcessed(finalData);
      }, 2000);
    } else {
      setError('Inga filer kunde processeras framgångsrikt.');
    }
  };

  // Försök igen med enbart misslyckade filer
  const retryFailedFiles = () => {
    const failedFiles = files.filter(f => f.status === 'error');
    if (failedFiles.length === 0) return;

    // Återställ status för misslyckade filer
    setFiles(prev => prev.map(f => 
      f.status === 'error' ? { ...f, status: 'pending', error: null } : f
    ));
    
    // Rensa fel och starta om processering
    setError(null);
    setBatchProgress({ current: 0, total: 0, percentage: 0 });
    setBatchResults({ success: 0, failed: 0, total: 0 });
    setProcessingStatus({});
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(event.dataTransfer.files);
      const csvFiles = droppedFiles.filter(file => 
        file.type === 'text/csv' || file.name.endsWith('.csv')
      );
      
      if (csvFiles.length !== droppedFiles.length) {
        setError('Endast CSV-filer stöds');
        return;
      }
      
      if (csvFiles.length > 0) {
        const fakeEvent = { target: { files: csvFiles } };
        handleFileChange(fakeEvent);
      }
    }
  };

  const handleBrowseClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Fortsätt trots dublett-varning
  const handleContinueDespiteWarning = () => {
    if (possibleDuplicate && possibleDuplicate.allFiles) {
      setFiles(possibleDuplicate.allFiles);
      setTotalFilesCount(possibleDuplicate.allFiles.length);
      setPossibleDuplicate(null);
    }
  };
  
  const handleCancelDuplicateUpload = () => {
    setPossibleDuplicate(null);
    setFiles([]);
    setTotalFilesCount(0);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleMemoryUpdate = (stats) => {
    setMemoryUsage(stats);
    setEstimatedFilesRemaining(stats.estimatedAdditionalFiles || 0);
    
    if (files.length > 0) {
      // Beräkna om minnesprojektionen för alla filer
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const fakeAnalysis = { fileSize: totalSize, rows: files.length * 1000, columns: 15 };
      const projection = calculateMemoryWithNewFile(fakeAnalysis, stats);
      setMemoryCheck(projection);
    }
  };

  // Progress-indikator komponent
  const BatchProgress = ({ current, total, percentage, currentFileName }) => {
    if (total === 0) return null;
    
    return (
      <div className="mt-4 p-4 border rounded-lg bg-blue-50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium">
            Bearbetar fil {current} av {total}
          </span>
          <span className="text-sm text-gray-600">{percentage}%</span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
        
        {currentFileName && (
          <p className="text-xs text-gray-600">
            Aktuell fil: {currentFileName}
          </p>
        )}
      </div>
    );
  };

  // Batch-resultat komponent
  const BatchResults = ({ results, onRetry }) => {
    if (results.total === 0) return null;
    
    const isComplete = (results.success + results.failed) === results.total;
    if (!isComplete) return null;
    
    return (
      <div className="mt-4 p-4 border rounded-lg bg-gray-50">
        <h4 className="text-sm font-medium mb-2">Batch-resultat</h4>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="text-center">
            <div className="text-green-600 font-bold">{results.success}</div>
            <div className="text-gray-600">Lyckades</div>
          </div>
          <div className="text-center">
            <div className="text-red-600 font-bold">{results.failed}</div>
            <div className="text-gray-600">Misslyckades</div>
          </div>
          <div className="text-center">
            <div className="text-gray-800 font-bold">{results.total}</div>
            <div className="text-gray-600">Totalt</div>
          </div>
        </div>
        
        {results.failed > 0 && (
          <div className="mt-3 text-center">
            <Button size="sm" variant="outline" onClick={onRetry}>
              <Clock className="w-4 h-4 mr-1" />
              Försök igen med misslyckade
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Visa varning om möjlig dublett
  if (possibleDuplicate) {
    return (
      <div className="space-y-4">
        <Alert className="bg-yellow-50 border-yellow-200">
          <Info className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800">Möjlig dubblettfil</AlertTitle>
          <AlertDescription className="text-yellow-700">
            <p className="mb-2">
              En eller flera filer verkar redan vara uppladdade. Vill du fortsätta ändå?
            </p>
            <div className="bg-white p-3 rounded-md border border-yellow-300 mb-4">
              <div className="text-sm">
                <span className="font-semibold">Antal filer:</span> {possibleDuplicate.allFiles?.length || 1}
                <br />
                <span className="font-semibold">Första dublett:</span> {possibleDuplicate.file.name}
              </div>
            </div>
            <div className="flex space-x-4">
              <Button 
                variant="outline" 
                onClick={handleCancelDuplicateUpload}
              >
                Avbryt
              </Button>
              <Button 
                onClick={handleContinueDespiteWarning}
              >
                Fortsätt ändå
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Fil-lista komponent med förbättrad status
  const FileList = ({ files, onRemoveFile }) => {
    if (files.length === 0) return null;
    
    const getStatusColor = (status) => {
      switch(status) {
        case 'pending': return 'bg-gray-100 text-gray-700';
        case 'processing': return 'bg-blue-100 text-blue-700';
        case 'success': return 'bg-green-100 text-green-700';
        case 'error': return 'bg-red-100 text-red-700';
        case 'duplicate': return 'bg-yellow-100 text-yellow-700';
        default: return 'bg-gray-100 text-gray-700';
      }
    };

    const getStatusText = (status) => {
      switch(status) {
        case 'pending': return 'Väntar';
        case 'processing': return 'Bearbetar';
        case 'success': return 'Klar';
        case 'error': return 'Fel';
        case 'duplicate': return 'Dublett';
        default: return 'Okänd';
      }
    };

    const getStatusIcon = (status) => {
      switch(status) {
        case 'processing': return <Loader2 className="h-3 w-3 animate-spin" />;
        case 'success': return <CheckCircle2 className="h-3 w-3" />;
        case 'error': return <XCircle className="h-3 w-3" />;
        default: return null;
      }
    };
    
    return (
      <div className="mt-4 space-y-2">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-medium">Valda filer ({files.length})</h3>
          <div className="text-xs text-gray-500">
            {files.filter(f => f.status === 'success').length} klar, {files.filter(f => f.status === 'error').length} fel
          </div>
        </div>
        
        {files.map((fileObj, index) => (
          <div key={fileObj.id} 
               className={`flex items-center justify-between p-3 border rounded-lg ${
                 fileObj.status === 'processing' ? 'bg-blue-50 border-blue-200' : 
                 fileObj.status === 'success' ? 'bg-green-50 border-green-200' :
                 fileObj.status === 'error' ? 'bg-red-50 border-red-200' : ''
               }`}>
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-primary" />
              <div className="flex-1">
                <div className="font-medium">{fileObj.name}</div>
                <div className="text-sm text-muted-foreground">
                  {(fileObj.file.size / 1024).toFixed(1)} KB
                  {fileObj.analysis && (
                    <span className="ml-2">
                      • {fileObj.analysis.rows} rader
                    </span>
                  )}
                </div>
                {fileObj.error && (
                  <div className="text-xs text-red-600 mt-1">
                    {fileObj.error}
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${getStatusColor(fileObj.status)}`}>
                  {getStatusIcon(fileObj.status)}
                  {getStatusText(fileObj.status)}
                </span>
                
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => onRemoveFile(fileObj.id)}
                  disabled={isLoading}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Minnesindikator */}
      {existingData && !isNewAnalysis && (
        <MemoryIndicator onUpdate={handleMemoryUpdate} />
      )}
      
      {/* Validering-fel */}
      {validationResult && !validationResult.isValid && validationResult.missing && validationResult.missing.length > 0 && (
        <Alert variant="destructive">
          <FileWarning className="h-4 w-4" />
          <AlertTitle>Fel vid validering av CSV</AlertTitle>
          <AlertDescription>
            <p>Första filen saknar nödvändiga kolumner:</p>
            <ul className="mt-2 list-disc list-inside">
              {validationResult.missing.map((col) => (
                <li key={col.internal || Math.random().toString()}>
                  <span className="font-semibold">{col.displayName || col.original || 'Okänd kolumn'}</span> (förväntat namn: {col.original || 'N/A'})
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Uppdatera kolumnmappningarna via "Hantera kolumnmappningar" om Meta har ändrat kolumnnamnen.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Framgångsmeddelande */}
      {showSuccessMessage && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800">Batch-bearbetning slutförd</AlertTitle>
          <AlertDescription className="text-green-700">
            {batchResults.success > 0 && (
              <p>{batchResults.success} av {batchResults.total} filer bearbetades framgångsrikt!</p>
            )}
            {duplicateStats && duplicateStats.duplicates > 0 && (
              <p>{duplicateStats.duplicates} dubletter har filtrerats bort totalt.</p>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-xl">
            {isNewAnalysis 
              ? 'Återställ data - Ladda CSV-filer'
              : existingData 
                ? 'Lägg till mer Facebook-statistik'
                : 'Läs in Facebook-statistik'}
          </CardTitle>
          
          {existingData && !isNewAnalysis && (
            <div className="text-sm text-muted-foreground flex items-center">
              <HardDrive className="w-4 h-4 mr-1" />
              <span>Nuvarande: {existingData.length} inlägg</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {/* Minnesvarningar */}
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
          
          {existingData && !isNewAnalysis && memoryCheck.status === 'warning' && (
            <Alert className="mb-4 bg-yellow-50 border-yellow-200">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertTitle className="text-yellow-800">Minnesvarning</AlertTitle>
              <AlertDescription className="text-yellow-700">
                <div className="space-y-1">
                  <p>Att lägga till {files.length} fil{files.length !== 1 ? 'er' : ''} kommer använda {memoryCheck.projectedPercent}% av tillgängligt minne.</p>
                  
                  {files.length > 0 && estimatedFilesRemaining !== null && (
                    <p className="font-medium">
                      Efter dessa filer kommer du kunna lägga till ungefär {estimatedFilesRemaining} file{estimatedFilesRemaining !== 1 ? 'r' : ''} till.
                    </p>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
          
          {isNewAnalysis && (
            <Alert className="mb-4 bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertTitle className="text-blue-800">Återställ data</AlertTitle>
              <AlertDescription className="text-blue-700">
                Om du fortsätter kommer all befintlig data att ersättas med dessa nya filer.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Drop Zone */}
          <div 
            className={`
              border-2 border-dashed rounded-lg p-12 
              ${dragActive ? 'border-primary bg-primary/5' : files.length > 0 ? 'border-primary bg-primary/5' : 'border-border'} 
              text-center cursor-pointer transition-colors
              ${!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={handleDragLeave}
            onClick={isNewAnalysis || memoryCheck.canAddFile ? handleBrowseClick : undefined}
          >
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              disabled={!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile}
            />
            
            <div className="flex flex-col items-center justify-center space-y-4">
              {!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile ? (
                <AlertCircle className="w-12 h-12 text-red-500" />
              ) : files.length > 0 ? (
                <div className="text-center">
                  <FileText className="w-12 h-12 text-primary mx-auto mb-2" />
                  <div className="text-primary font-medium">
                    {files.length} fil{files.length !== 1 ? 'er' : ''} vald{files.length !== 1 ? 'a' : ''}
                  </div>
                </div>
              ) : existingData && !isNewAnalysis ? (
                <PlusCircle className="w-12 h-12 text-muted-foreground" />
              ) : (
                <UploadCloud className="w-12 h-12 text-muted-foreground" />
              )}
              
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  {!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile 
                    ? 'Kan inte lägga till mer data - Minnet är fullt' 
                    : files.length > 0
                      ? 'Klicka för att lägga till fler filer'
                      : existingData && !isNewAnalysis
                        ? 'Släpp CSV-filer här eller klicka för att lägga till mer data' 
                        : isNewAnalysis
                          ? 'Släpp CSV-filer här eller klicka för att återställa data'
                          : 'Släpp CSV-filer här eller klicka för att bläddra'}
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  {!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile 
                    ? 'Du behöver rensa befintlig data innan du kan lägga till mer' 
                    : isNewAnalysis
                      ? 'Ladda upp CSV-filer med Facebook-statistik för att återställa data. Befintlig data kommer tas bort.'
                      : files.length > 0 
                        ? 'Du kan välja flera CSV-filer samtidigt för batch-upload.'
                        : 'Ladda upp CSV-filer med Facebook-statistik. Denna data behandlas endast i din webbläsare och skickas inte till någon server.'}
                </p>
                
                {files.length > 0 && (
                  <div className="mt-2 text-sm text-primary">
                    <p>Total storlek: {(files.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(0)} KB</p>
                    
                    {!isNewAnalysis && estimatedFilesRemaining !== null && (
                      <p className="mt-1 font-medium">
                        Efter dessa filer kommer du kunna lägga till ungefär {estimatedFilesRemaining} file{estimatedFilesRemaining !== 1 ? 'r' : ''} till
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Progress-indikator */}
          {isLoading && batchProgress.total > 0 && (
            <BatchProgress 
              current={batchProgress.current}
              total={batchProgress.total}
              percentage={batchProgress.percentage}
              currentFileName={currentProcessingIndex >= 0 ? files[currentProcessingIndex]?.name : null}
            />
          )}

          {/* Batch-resultat */}
          <BatchResults 
            results={batchResults}
            onRetry={retryFailedFiles}
          />

          {/* Fil-lista */}
          <FileList files={files} onRemoveFile={removeFile} />

          {/* Fel-meddelanden */}
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Fel vid inläsning</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Kontroll-knappar */}
          <div className="mt-4 flex justify-between">
            <Button variant="outline" onClick={onCancel} disabled={isLoading}>
              Avbryt
            </Button>
            
            <div className="flex space-x-2">
              {files.length > 0 && (
                <Button 
                  variant="outline" 
                  onClick={clearAllFiles}
                  disabled={isLoading}
                >
                  Rensa alla
                </Button>
              )}
              
              <Button
                onClick={processBatchFiles}
                disabled={files.length === 0 || isLoading || (!isNewAnalysis && memoryCheck.status === 'critical' && !memoryCheck.canAddFile)}
                className="min-w-[120px]"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Bearbetar... ({batchProgress.current}/{batchProgress.total})
                  </>
                ) : (
                  <>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    {isNewAnalysis 
                      ? `Återställ data (${files.length})` 
                      : existingData 
                        ? `Lägg till data (${files.length})`
                        : `Bearbeta (${files.length})`}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}