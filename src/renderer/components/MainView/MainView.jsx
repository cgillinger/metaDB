import React, { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Card, CardContent } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  CalendarIcon,
  Plus,
  RefreshCw,
  TrendingUp
} from 'lucide-react';
import AccountView from '../AccountView';
import PostView from '../PostView';
import PostTypeView from '../PostTypeView';
import TrendAnalysisView from '../TrendAnalysisView/TrendAnalysisView';
import { FileUploader } from '../FileUploader';
import { StorageIndicator } from '../StorageIndicator/StorageIndicator';
import { LoadedFilesInfo } from '../LoadedFilesInfo/LoadedFilesInfo';
import { getMemoryUsageStats, getUploadedFilesMetadata } from '@/utils/storageService';

const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks'];
const IG_ONLY_FIELDS = ['saves', 'follows'];

// Unified fields for both platforms
const POST_VIEW_AVAILABLE_FIELDS = {
  'reach': 'Räckvidd',
  'views': 'Visningar',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner (gilla+komm+dela)',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  // Facebook-specific
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  // Instagram-specific
  'saves': 'Sparade',
  'follows': 'Följare'
};

const ACCOUNT_VIEW_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Räckvidd (genomsnitt)',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner (gilla+komm+dela)',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  // Facebook-specific
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  // Instagram-specific
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

const TREND_ANALYSIS_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'reach': 'Räckvidd',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

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

function filterFieldsByPlatform(fields, activePlatform) {
  if (!activePlatform || activePlatform === 'mixed') return fields;
  const filtered = {};
  for (const [key, label] of Object.entries(fields)) {
    if (activePlatform === 'instagram' && FB_ONLY_FIELDS.includes(key)) continue;
    if (activePlatform === 'facebook' && IG_ONLY_FIELDS.includes(key)) continue;
    filtered[key] = label;
  }
  return filtered;
}

const EngagementLegend = ({ activePlatform }) => (
  <div className="mx-4 mb-2 p-3 bg-muted/50 border border-border rounded-md text-sm">
    <p className="font-medium mb-1">Engagemang beräknas olika per plattform:</p>
    {(!activePlatform || activePlatform === 'mixed' || activePlatform === 'facebook') && (
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Facebook:</span> reaktioner + kommentarer + delningar + klick
      </p>
    )}
    {(!activePlatform || activePlatform === 'mixed' || activePlatform === 'instagram') && (
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">Instagram:</span> gilla + kommentarer + delningar + sparade + följare
      </p>
    )}
  </div>
);

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

function detectPlatformFromData(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const platforms = new Set(data.map(p => p._platform).filter(Boolean));
  if (platforms.size === 1) return [...platforms][0];
  if (platforms.size > 1) return 'mixed';
  return null;
}

const PLATFORM_TITLE = {
  facebook: 'Facebook Statistik',
  instagram: 'Instagram Statistik',
  mixed: 'Meta Statistik',
  null: 'Meta Statistik'
};

const MainView = ({ data, meta, onDataProcessed }) => {
  const [selectedFields, setSelectedFields] = useState([]);
  const [activeView, setActiveView] = useState('account');
  const [platformFilter, setPlatformFilter] = useState('all'); // 'all' | 'facebook' | 'instagram'
  const [showAddMoreData, setShowAddMoreData] = useState(false);
  const [showNewAnalysis, setShowNewAnalysis] = useState(false);
  const [memoryUsage, setMemoryUsage] = useState(null);
  const [filesMetadata, setFilesMetadata] = useState([]);
  const [showFilesPanel, setShowFilesPanel] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const platform = detectPlatformFromData(data);
  const hasDateRange = meta?.dateRange?.startDate && meta?.dateRange?.endDate;

  const platformCounts = useMemo(() => {
    if (!Array.isArray(data)) return { facebook: 0, instagram: 0 };
    return {
      facebook: data.filter(p => p._platform === 'facebook').length,
      instagram: data.filter(p => p._platform === 'instagram').length,
    };
  }, [data]);

  const hasMixedPlatforms = platformCounts.facebook > 0 && platformCounts.instagram > 0;

  // Aktiv plattform för färgtema: Instagram-filter eller enbart Instagram-data → rosa tema
  const activePlatform = hasMixedPlatforms
    ? (platformFilter !== 'all' ? platformFilter : null)
    : platform;

  const filteredData = useMemo(() => {
    if (!data || platformFilter === 'all') return data;
    return data.filter(post => post._platform === platformFilter);
  }, [data, platformFilter]);

  const getAvailableFields = () => {
    let fields;
    if (activeView === 'account') fields = ACCOUNT_VIEW_AVAILABLE_FIELDS;
    else if (activeView === 'trend_analysis') fields = TREND_ANALYSIS_AVAILABLE_FIELDS;
    else fields = POST_VIEW_AVAILABLE_FIELDS;
    return filterFieldsByPlatform(fields, activePlatform);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const memory = await getMemoryUsageStats();
        setMemoryUsage(memory);
        const files = await getUploadedFilesMetadata();
        setFilesMetadata(files);
      } catch (error) {
        console.error('Fel vid laddning:', error);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    const availableFields = Object.keys(getAvailableFields());
    setSelectedFields(prev => {
      const filtered = prev.filter(field => availableFields.includes(field));
      if (filtered.length === prev.length && filtered.every((f, i) => f === prev[i])) {
        return prev; // Samma referens = ingen re-render
      }
      return filtered;
    });
  }, [activeView, activePlatform]);

  const handleDataUploaded = (newData) => {
    onDataProcessed(newData);
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

  return (
    <div className="space-y-6" data-platform={activePlatform || undefined}>
      <ConfirmationDialog
        isOpen={resetDialogOpen}
        onConfirm={() => { setResetDialogOpen(false); setShowNewAnalysis(true); }}
        onCancel={() => setResetDialogOpen(false)}
        message="Detta rensar all befintlig data och börjar om från början. Fortsätta?"
      />

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{PLATFORM_TITLE[platform]}</h2>
        <div className="flex items-center space-x-2">
          <StorageIndicator compact onUpdate={handleMemoryUpdate} />
          <Button
            onClick={() => setShowAddMoreData(true)}
            variant="outline"
            size="sm"
            disabled={memoryUsage && !memoryUsage.canAddMoreData}
            title={memoryUsage && !memoryUsage.canAddMoreData ? 'Minnet är fullt' : 'Lägg till fler CSV-filer'}
          >
            <Plus className="w-4 h-4 mr-1" />
            Lägg till data
          </Button>
          <Button onClick={handleNewAnalysis} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-1" />
            Återställ
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilesPanel(!showFilesPanel)}
          >
            {filesMetadata.length} fil{filesMetadata.length !== 1 ? 'er' : ''}
          </Button>
        </div>
      </div>

      {showFilesPanel && (
        <LoadedFilesInfo
          onRefresh={handleFileMetadataUpdate}
          onClearAll={handleClearAll}
          canClearData={true}
        />
      )}

      {activeView !== 'trend_analysis' && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-base font-semibold mb-3">Välj värden att visa</h3>
            <ValueSelector
              availableFields={getAvailableFields()}
              selectedFields={selectedFields}
              onSelectionChange={setSelectedFields}
            />
            {selectedFields.includes('engagement') && (
              <EngagementLegend activePlatform={activePlatform} />
            )}
          </CardContent>
        </Card>
      )}

      {hasMixedPlatforms && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 mr-1">Plattform:</span>
          {[
            { value: 'all', label: `Alla (${platformCounts.facebook + platformCounts.instagram})` },
            { value: 'facebook', label: `Facebook (${platformCounts.facebook})` },
            { value: 'instagram', label: `Instagram (${platformCounts.instagram})` },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPlatformFilter(value)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList>
          <TabsTrigger value="account">Per konto</TabsTrigger>
          <TabsTrigger value="post">Per inlägg</TabsTrigger>
          <TabsTrigger value="post_type">Per inläggstyp</TabsTrigger>
          <TabsTrigger value="trend_analysis">
            <TrendingUp className="w-4 h-4 mr-1" />
            Trendanalys
          </TabsTrigger>
        </TabsList>

        {hasDateRange && (
          <div className="mt-4 p-2 border border-gray-200 rounded-md bg-gray-50 flex items-center">
            <CalendarIcon className="h-4 w-4 mr-2 text-gray-500" />
            <span className="text-sm text-gray-700">
              Period: {meta.dateRange.startDate} – {meta.dateRange.endDate}
            </span>
          </div>
        )}

        <TabsContent value="account">
          <AccountView data={filteredData} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="post">
          <PostView data={filteredData} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="post_type">
          <PostTypeView data={filteredData} selectedFields={selectedFields} />
        </TabsContent>

        <TabsContent value="trend_analysis">
          <TrendAnalysisView data={filteredData} meta={meta} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MainView;
