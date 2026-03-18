import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Card, CardContent } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  CalendarIcon,
  Plus,
  Database,
  UploadCloud,
  RefreshCw,
  TrendingUp
} from 'lucide-react';
import AccountView from '../AccountView';
import PostView from '../PostView';
import PostTypeView from '../PostTypeView';
import TrendAnalysisView from '../TrendAnalysisView/TrendAnalysisView';
import { FileUploader } from '../FileUploader';
import { MemoryIndicator } from '../MemoryIndicator/MemoryIndicator';
import { LoadedFilesInfo } from '../LoadedFilesInfo/LoadedFilesInfo';
import { ACCOUNT_VIEW_FIELDS, POST_VIEW_FIELDS } from '@/utils/dataProcessing';
import { getMemoryUsageStats, getUploadedFilesMetadata } from '@/utils/webStorageService';

// Fält för per-inlägg-vyn
const POST_VIEW_AVAILABLE_FIELDS = {
  'post_reach': 'Räckvidd',
  'views': 'Visningar',
  'engagement_total': 'Interaktioner',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare'
};

// Fält för per-konto-vyn
const ACCOUNT_VIEW_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'engagement_total': 'Interaktioner',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Antal publiceringar per dag'
};

// Fält för trendanalys-vyn
const TREND_ANALYSIS_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'engagement_total': 'Interaktioner',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

// Bekräftelsedialog-komponent
const ConfirmationDialog = ({ isOpen, onConfirm, onCancel, message }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full">
        <h3 className="text-lg font-medium mb-4">Bekräfta åtgärd</h3>
        <p className="mb-6">{message}</p>
        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={onCancel}>Avbryt</Button>
          <Button onClick={onConfirm}>OK</Button>
        </div>
      </div>
    </div>
  );
};

const ValueSelector = ({ availableFields, selectedFields, onSelectionChange }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
    {Object.entries(availableFields).map(([key, label]) => (
      <div key={key} className="flex items-center space-x-2">
        <Checkbox
          id={key}
          checked={selectedFields.includes(key)}
          onCheckedChange={(checked) => {
            if (checked) {
              onSelectionChange([...selectedFields, key]);
            } else {
              onSelectionChange(selectedFields.filter(f => f !== key));
            }
          }}
        />
        <Label htmlFor={key}>{label}</Label>
      </div>
    ))}
  </div>
);

const MainView = ({ data, meta, onDataProcessed }) => {
  const [selectedFields, setSelectedFields] = useState([]);
  const [activeView, setActiveView] = useState('account');
  const [showFileUploader, setShowFileUploader] = useState(false);
  const [showAddMoreData, setShowAddMoreData] = useState(false);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [filesMetadata, setFilesMetadata] = useState([]);
  const [dataManagementTabActive, setDataManagementTabActive] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const hasDateRange = meta?.dateRange?.startDate && meta?.dateRange?.endDate;

  const getAvailableFields = () => {
    if (activeView === 'account') return ACCOUNT_VIEW_AVAILABLE_FIELDS;
    if (activeView === 'trend_analysis') return TREND_ANALYSIS_AVAILABLE_FIELDS;
    return POST_VIEW_AVAILABLE_FIELDS;
  };

  useEffect(() => {
    const loadMemoryAndFiles = async () => {
      try {
        const memory = await getMemoryUsageStats();
        setMemoryUsage(memory);
        const files = await getUploadedFilesMetadata();
        setFilesMetadata(files);
      } catch (error) {
        console.error('Fel vid laddning av minnesanvändning:', error);
      }
    };
    loadMemoryAndFiles();
  }, []);

  useEffect(() => {
    const availableFields = Object.keys(getAvailableFields());
    setSelectedFields(prev => prev.filter(field => availableFields.includes(field)));
  }, [activeView]);

  const handleDataUploaded = (newData) => {
    onDataProcessed(newData);
    setShowFileUploader(false);
    setShowAddMoreData(false);
    setShowNewAnalysis(false);

    const refresh = async () => {
      try {
        const memory = await getMemoryUsageStats();
        setMemoryUsage(memory);
        const files = await getUploadedFilesMetadata();
        setFilesMetadata(files);
      } catch (error) {
        console.error('Fel vid uppdatering:', error);
      }
    };
    refresh();
  };

  const handleClearAll = () => {
    window.location.reload();
  };

  const handleMemoryUpdate = (stats) => {
    setMemoryUsage(stats);
  };

  const handleFileMetadataUpdate = async () => {
    try {
      const files = await getUploadedFilesMetadata();
      setFilesMetadata(files);
      const memory = await getMemoryUsageStats();
      setMemoryUsage(memory);
    } catch (error) {
      console.error('Fel vid uppdatering av filmetadata:', error);
    }
  };

  const handleNewAnalysis = () => {
    setResetDialogOpen(true);
  };

  const handleResetConfirm = () => {
    setResetDialogOpen(false);
    setShowNewAnalysis(true);
  };

  const handleResetCancel = () => {
    setResetDialogOpen(false);
  };

  if (showFileUploader) {
    return (
      <FileUploader
        onDataProcessed={handleDataUploaded}
        onCancel={() => setShowFileUploader(false)}
      />
    );
  }

  if (showAddMoreData) {
    return (
      <FileUploader
        onDataProcessed={handleDataUploaded}
        onCancel={() => setShowAddMoreData(false)}
        existingData={data}
      />
    );
  }

  if (showNewAnalysis) {
    return (
      <FileUploader
        onDataProcessed={handleDataUploaded}
        onCancel={() => setShowNewAnalysis(false)}
        isNewAnalysis={true}
      />
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto p-4 space-y-6">
        <div className="text-center">
          <Button onClick={() => setShowFileUploader(true)} className="mx-auto">
            <UploadCloud className="w-4 h-4 mr-2" />
            Läs in CSV
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <ConfirmationDialog
        isOpen={resetDialogOpen}
        onConfirm={handleResetConfirm}
        onCancel={handleResetCancel}
        message="Detta rensar alla CSV och börjar om från början."
      />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Instagram Statistik</h1>
        <div className="flex space-x-2">
          <Button
            onClick={() => setShowAddMoreData(true)}
            variant="outline"
            className="text-green-600"
            disabled={memoryUsage && !memoryUsage.canAddMoreData}
            title={memoryUsage && !memoryUsage.canAddMoreData ? 'Kan inte lägga till mer data - Minnet är fullt' : 'Lägg till mer data'}
          >
            <Plus className="w-4 h-4 mr-1" />
            Lägg till data
          </Button>
          <Button onClick={handleNewAnalysis} variant="outline">
            <RefreshCw className="w-4 h-4 mr-1" />
            Återställ data
          </Button>
        </div>
      </div>

      {/* Minnesindikator och datakällor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MemoryIndicator onUpdate={handleMemoryUpdate} showDetails={false} />
        </div>
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Database className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span className="text-lg font-medium">Datakällor</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDataManagementTabActive(!dataManagementTabActive)}
                >
                  {dataManagementTabActive ? 'Dölj' : 'Visa'}
                </Button>
              </div>
              {dataManagementTabActive && (
                <div className="mt-2">
                  <div className="text-sm text-muted-foreground mb-2">
                    {filesMetadata.length === 0
                      ? 'Inga filer laddade ännu'
                      : `${filesMetadata.length} fil${filesMetadata.length !== 1 ? 'er' : ''} laddade`}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {dataManagementTabActive && (
        <div className="mb-6">
          <LoadedFilesInfo
            onRefresh={handleFileMetadataUpdate}
            onClearAll={handleClearAll}
            canClearData={true}
          />
        </div>
      )}

      {/* Fältväljare - dölj för trendanalys (har eget metrikal) */}
      {activeView !== 'trend_analysis' && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Välj värden att visa</h2>
              <ValueSelector
                availableFields={getAvailableFields()}
                selectedFields={selectedFields}
                onSelectionChange={setSelectedFields}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList>
          <TabsTrigger value="account">Per konto</TabsTrigger>
          <TabsTrigger value="post">Per inlägg</TabsTrigger>
          <TabsTrigger value="post_type">Per inläggstyp</TabsTrigger>
          <TabsTrigger value="trend_analysis">
            <TrendingUp className="w-4 h-4 mr-2" />
            Trendanalys
          </TabsTrigger>
        </TabsList>

        {hasDateRange && (
          <div className="mt-4 p-2 border border-gray-200 rounded-md bg-gray-50 flex items-center">
            <CalendarIcon className="h-4 w-4 mr-2 text-gray-500" />
            <span className="text-sm text-gray-700">
              Visar statistik för perioden {meta.dateRange.startDate} till {meta.dateRange.endDate}
            </span>
          </div>
        )}

        <TabsContent value="account">
          <AccountView data={data} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="post">
          <PostView data={data} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="post_type">
          <PostTypeView data={data} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="trend_analysis">
          <TrendAnalysisView data={data} meta={meta} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MainView;
