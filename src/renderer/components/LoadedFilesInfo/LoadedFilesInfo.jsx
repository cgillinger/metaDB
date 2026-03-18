import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../ui/table';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { 
  FileText, 
  Trash2, 
  AlertCircle, 
  RefreshCw, 
  Calendar,
  BarChart3,
  Users
} from 'lucide-react';
import { getUploadedFilesMetadata, removeFileMetadata, clearAllData } from '@/utils/webStorageService';

export function LoadedFilesInfo({ onRefresh, onClearAll, canClearData = true }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  
  // Hämta filer vid montering
  useEffect(() => {
    fetchFiles();
  }, []);
  
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const fileMetadata = await getUploadedFilesMetadata();
      setFiles(fileMetadata);
    } catch (error) {
      console.error('Fel vid hämtning av filmetadata:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const handleRemoveFile = async (index) => {
    try {
      await removeFileMetadata(index);
      await fetchFiles();
      
      if (onRefresh) {
        onRefresh();
      }
    } catch (error) {
      console.error('Fel vid borttagning av fil:', error);
    }
  };
  
  const handleClearAllData = async () => {
    if (!canClearData) return;
    
    try {
      await clearAllData();
      setFiles([]);
      setShowConfirmClear(false);
      
      if (onClearAll) {
        onClearAll();
      }
    } catch (error) {
      console.error('Fel vid rensning av data:', error);
    }
  };
  
  const formatDateTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('sv-SE') + ' ' + date.toLocaleTimeString('sv-SE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-24">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span>Laddar filinformation...</span>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  if (files.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground p-4">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>Inga filer har laddats upp ännu.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Uppladdade datakällor</CardTitle>
        <div className="space-x-2">
          <Button 
            size="sm" 
            variant="outline"
            onClick={fetchFiles}
            title="Uppdatera fillista"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="sr-only">Uppdatera</span>
          </Button>
          {canClearData && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={() => setShowConfirmClear(true)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              title="Rensa alla data"
            >
              <Trash2 className="w-4 h-4" />
              <span className="sr-only">Rensa data</span>
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent>
        {showConfirmClear && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Bekräfta rensning</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                Är du säker på att du vill rensa all data? Detta kommer ta bort alla uppladdade filer och statistik.
              </p>
              <div className="flex space-x-2 mt-2">
                <Button variant="outline" onClick={() => setShowConfirmClear(false)}>
                  Avbryt
                </Button>
                <Button variant="destructive" onClick={handleClearAllData}>
                  Ja, rensa all data
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filnamn</TableHead>
                <TableHead>Uppladdad</TableHead>
                <TableHead><span className="sr-only">Perioden</span></TableHead>
                <TableHead className="text-right">Rader</TableHead>
                <TableHead className="text-right">Konton</TableHead>
                <TableHead className="text-right">Åtgärder</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-primary" />
                    {/* Lösning för problem 1: Lägger till title-attribut för tooltip */}
                    <span 
                      className="truncate max-w-[200px]" 
                      title={file.originalFileName || file.filename || 'Okänd fil'}
                    >
                      {file.originalFileName || file.filename || 'Okänd fil'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDateTime(file.uploadedAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {file.dateRange && file.dateRange.startDate && file.dateRange.endDate ? (
                      <div className="flex items-center text-muted-foreground">
                        <Calendar className="w-3 h-3 mr-1" />
                        <span>{file.dateRange.startDate} till {file.dateRange.endDate}</span>
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end">
                      <BarChart3 className="w-3 h-3 mr-1 text-muted-foreground" />
                      <span>{file.rowCount?.toLocaleString() || '?'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <div className="flex items-center justify-end">
                      <Users className="w-3 h-3 mr-1 text-muted-foreground" />
                      <span>{file.accountCount?.toLocaleString() || '?'}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveFile(index)}
                      title="Ta bort fil från statistik"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="sr-only">Ta bort</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default LoadedFilesInfo;