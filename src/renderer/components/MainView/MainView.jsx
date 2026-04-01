import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Card, CardContent } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import {
  CalendarIcon,
  Plus,
  TrendingUp,
  Database
} from 'lucide-react';
import AccountView from '../AccountView';
import PostView from '../PostView';
import PostTypeView from '../PostTypeView';
import TrendAnalysisView from '../TrendAnalysisView/TrendAnalysisView';
import ImportManager from '../ImportManager/ImportManager';
import PeriodSelector from '../PeriodSelector';
import PlatformBadge from '../ui/PlatformBadge';
import { api } from '@/utils/apiClient';

const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks', 'account_reach'];
const IG_ONLY_FIELDS = ['saves', 'follows'];

const POST_VIEW_AVAILABLE_FIELDS = {
  'reach': 'Räckvidd',
  'views': 'Visningar',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner (gilla+komm+dela)',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  'saves': 'Sparade',
  'follows': 'Följare'
};

const ACCOUNT_VIEW_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'average_reach': 'Räckvidd (genomsnitt)',
  'account_reach': 'Kontoräckvidd (API)',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner (gilla+komm+dela)',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

const TREND_ANALYSIS_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'reach': 'Räckvidd',
  'account_reach': 'Kontoräckvidd (API)',
  'engagement': 'Totalt engagemang',
  'interactions': 'Interaktioner',
  'likes': 'Gilla-markeringar / Reaktioner',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'total_clicks': 'Totalt antal klick',
  'saves': 'Sparade',
  'follows': 'Följare'
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
        <Label htmlFor={key} className="flex items-center gap-1.5">
          {label}
          {['total_clicks', 'link_clicks', 'other_clicks', 'account_reach'].includes(key) && <PlatformBadge platform="facebook" />}
          {['saves', 'follows'].includes(key) && <PlatformBadge platform="instagram" />}
        </Label>
      </div>
    ))}
  </div>
);

const PLATFORM_TITLE = {
  facebook: 'Facebook Statistik',
  instagram: 'Instagram Statistik',
  mixed: 'Meta Statistik',
  null: 'Meta Statistik'
};

const MainView = ({ onShowUploader }) => {
  const [selectedFields, setSelectedFields] = useState([]);
  const [activeView, setActiveView] = useState('account');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [stats, setStats] = useState(null);
  const [imports, setImports] = useState([]);
  // True when at least one month of GA listening data is available
  const [hasGAListens, setHasGAListens] = useState(false);
  // Account groups — persists across view switches
  const [accountGroups, setAccountGroups] = useState([]);

  // Period selection
  const [periodMode, setPeriodMode] = useState('months');
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [coverageData, setCoverageData] = useState([]);

  // Fetch stats, imports and coverage on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [statsData, importsData, coverageResult, gaMonthsResult] = await Promise.all([
          api.getStats(),
          api.getImports(),
          api.getCoverage().catch(() => ({ months: [] })),
          api.getGAListensMonths().catch(() => ({ months: [] })),
        ]);
        setStats(statsData);
        setImports(importsData);
        setHasGAListens((gaMonthsResult.months || []).length > 0);

        const months = coverageResult.months || [];
        setCoverageData(months);

        // Default: select latest month
        if (months.length > 0 && selectedMonths.length === 0) {
          const sorted = [...months].sort((a, b) => b.month.localeCompare(a.month));
          setSelectedMonths([sorted[0].month]);
        }
      } catch (error) {
        console.error('Fel vid laddning:', error);
      }
    };
    loadData();
  }, []);

  const refreshAccountGroups = useCallback(async () => {
    try {
      const result = await api.getAccountGroups();
      setAccountGroups(result.groups || []);
    } catch (err) {
      console.error('Fel vid hämtning av kontogrupper:', err);
    }
  }, []);

  useEffect(() => { refreshAccountGroups(); }, [refreshAccountGroups]);

  // Detect platform from imports
  const platformInfo = useMemo(() => {
    const platforms = new Set(imports.map(i => i.platform));
    const hasFacebook = platforms.has('facebook');
    const hasInstagram = platforms.has('instagram');
    const hasMixed = hasFacebook && hasInstagram;

    let detected = null;
    if (hasMixed) detected = 'mixed';
    else if (hasFacebook) detected = 'facebook';
    else if (hasInstagram) detected = 'instagram';

    const fbPosts = imports.filter(i => i.platform === 'facebook').reduce((s, i) => s + i.row_count, 0);
    const igPosts = imports.filter(i => i.platform === 'instagram').reduce((s, i) => s + i.row_count, 0);

    return { detected, hasMixed, fbPosts, igPosts };
  }, [imports]);

  const activePlatform = platformInfo.hasMixed
    ? (platformFilter !== 'all' ? platformFilter : null)
    : platformInfo.detected;

  // The platform filter value to pass to API (undefined = no filter)
  const apiPlatform = platformFilter !== 'all' ? platformFilter : undefined;

  const getAvailableFields = () => {
    let fields;
    if (activeView === 'account') fields = ACCOUNT_VIEW_AVAILABLE_FIELDS;
    else if (activeView === 'trend_analysis') fields = TREND_ANALYSIS_AVAILABLE_FIELDS;
    else fields = POST_VIEW_AVAILABLE_FIELDS;

    // account_reach is monthly-only (from Meta Graph API) — hide it in custom
    // date range mode to prevent displaying misleading reach columns.
    if (periodMode === 'custom' && fields.account_reach) {
      fields = { ...fields };
      delete fields.account_reach;
    }

    return filterFieldsByPlatform(fields, activePlatform);
  };

  useEffect(() => {
    const availableFields = Object.keys(getAvailableFields());
    setSelectedFields(prev => {
      const filtered = prev.filter(field => availableFields.includes(field));
      if (filtered.length === prev.length && filtered.every((f, i) => f === prev[i])) {
        return prev;
      }
      return filtered;
    });
  }, [activeView, activePlatform, periodMode]);

  const handleImportsChanged = async () => {
    try {
      const [statsData, importsData, coverageResult, gaMonthsResult] = await Promise.all([
        api.getStats(),
        api.getImports(),
        api.getCoverage().catch(() => ({ months: [] })),
        api.getGAListensMonths().catch(() => ({ months: [] })),
      ]);
      setStats(statsData);
      setImports(importsData);
      setCoverageData(coverageResult.months || []);
      setHasGAListens((gaMonthsResult.months || []).length > 0);
    } catch (error) {
      console.error('Fel vid uppdatering:', error);
    }
  };

  // Reset to 'account' if a hidden tab is active when switching to ga_listens
  useEffect(() => {
    if (platformFilter === 'ga_listens' && (activeView === 'post' || activeView === 'post_type')) {
      setActiveView('account');
    }
  }, [platformFilter]);

  // Filter and re-map coverage months based on the active platform filter so
  // PeriodSelector only shows months that are relevant for the selected platform.
  const filteredCoverageData = useMemo(() => {
    if (platformFilter === 'facebook') {
      // Show months with Facebook posts or reach data; display fb_count as the number
      return coverageData
        .filter(m => (m.fb_count ?? 0) > 0 || m.has_reach)
        .map(m => ({ ...m, post_count: m.fb_count ?? 0 }));
    }
    if (platformFilter === 'instagram') {
      return coverageData
        .filter(m => (m.ig_count ?? 0) > 0)
        .map(m => ({ ...m, post_count: m.ig_count ?? 0 }));
    }
    if (platformFilter === 'ga_listens') {
      // Display the number of programmes with listening data for the month
      return coverageData
        .filter(m => (m.ga_listens_count ?? 0) > 0)
        .map(m => ({ ...m, post_count: m.ga_listens_count ?? 0 }));
    }
    // 'all' — keep existing coverage data unchanged
    return coverageData;
  }, [coverageData, platformFilter]);

  // When the platform filter changes, keep the current month selection only if
  // all selected months are still available in the filtered set.
  // Otherwise fall back to the latest available month.
  useEffect(() => {
    if (filteredCoverageData.length === 0) return;
    const available = new Set(filteredCoverageData.map(m => m.month));
    const allAvailable = selectedMonths.length > 0 && selectedMonths.every(m => available.has(m));
    if (!allAvailable) {
      const sorted = [...filteredCoverageData].sort((a, b) => b.month.localeCompare(a.month));
      setSelectedMonths([sorted[0].month]);
    }
  }, [platformFilter, filteredCoverageData]);

  /** Custom date ranges only work for post-level data (publish_time).
   *  GA listens and account_reach are stored at monthly granularity only. */
  const allowCustomPeriod = platformFilter !== 'ga_listens';

  /**
   * When switching to a platform that doesn't support custom date ranges,
   * fall back to month-based selection to avoid sending unsupported
   * dateFrom/dateTo params to endpoints that ignore them.
   */
  useEffect(() => {
    if (!allowCustomPeriod && periodMode === 'custom') {
      setPeriodMode('months');
    }
  }, [allowCustomPeriod]);

  const periodParams = useMemo(() => {
    if (periodMode === 'custom' && customRange.from && customRange.to) {
      return { dateFrom: customRange.from, dateTo: customRange.to };
    }
    if (periodMode === 'months' && selectedMonths.length > 0) {
      return { months: selectedMonths.join(',') };
    }
    return {};
  }, [periodMode, selectedMonths, customRange]);

  const PeriodSummary = () => {
    let periodText = '';
    if (periodMode === 'custom' && customRange.from && customRange.to) {
      periodText = `${customRange.from} – ${customRange.to}`;
    } else if (periodMode === 'months' && selectedMonths.length > 0) {
      const sorted = [...selectedMonths].sort();
      periodText = sorted.length === 1 ? sorted[0] : `${sorted[0]} – ${sorted[sorted.length - 1]}`;
    }
    if (!periodText) return null;
    return (
      <div className="p-2 border border-gray-200 rounded-md bg-gray-50 flex items-center">
        <CalendarIcon className="h-4 w-4 mr-2 text-gray-500" />
        <span className="text-sm text-gray-700">Period: {periodText}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6" data-platform={activePlatform || undefined}>
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">{PLATFORM_TITLE[platformInfo.detected]}</h2>
        <div className="flex items-center space-x-2">
          <Button
            onClick={onShowUploader}
            variant="outline"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            Lägg till data
          </Button>
        </div>
      </div>

      {(platformInfo.hasMixed || hasGAListens) && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 mr-1">Plattform:</span>
          {platformInfo.hasMixed && [
            { value: 'all', label: `Alla (${platformInfo.fbPosts + platformInfo.igPosts})` },
            { value: 'facebook', label: `Facebook (${platformInfo.fbPosts})` },
            { value: 'instagram', label: `Instagram (${platformInfo.igPosts})` },
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
          {!platformInfo.hasMixed && (platformInfo.fbPosts + platformInfo.igPosts) > 0 && hasGAListens && (
            <button
              onClick={() => setPlatformFilter('all')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter !== 'ga_listens'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary/60'
              }`}
            >
              {platformInfo.fbPosts > 0
                ? `Facebook (${platformInfo.fbPosts})`
                : `Instagram (${platformInfo.igPosts})`}
            </button>
          )}
          {/* GA Listens button — always shown when GA data exists */}
          {hasGAListens && (
            <button
              onClick={() => setPlatformFilter('ga_listens')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'ga_listens'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
              }`}
            >
              Lyssningar
            </button>
          )}
        </div>
      )}

      {activeView !== 'imports' && filteredCoverageData.length > 0 && (
        <PeriodSelector
          availableMonths={filteredCoverageData}
          selectedMonths={selectedMonths}
          onMonthsChange={setSelectedMonths}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          mode={periodMode}
          onModeChange={setPeriodMode}
          allowCustom={allowCustomPeriod}
        />
      )}

      {activeView !== 'trend_analysis' && activeView !== 'imports' && platformFilter !== 'ga_listens' && (
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

      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList>
          <TabsTrigger value="account">Per konto</TabsTrigger>
          {platformFilter !== 'ga_listens' && <TabsTrigger value="post">Per inlägg</TabsTrigger>}
          {platformFilter !== 'ga_listens' && <TabsTrigger value="post_type">Per inläggstyp</TabsTrigger>}
          <TabsTrigger value="trend_analysis">
            <TrendingUp className="w-4 h-4 mr-1" />
            Trendanalys
          </TabsTrigger>
          <TabsTrigger value="imports">
            <Database className="w-4 h-4 mr-1" />
            Databas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <PeriodSummary />
          <AccountView
            selectedFields={selectedFields}
            platform={apiPlatform}
            periodParams={periodParams}
            gaListensMode={platformFilter === 'ga_listens'}
          />
        </TabsContent>

        <TabsContent value="post">
          <PeriodSummary />
          <PostView selectedFields={selectedFields} platform={apiPlatform} periodParams={periodParams} />
        </TabsContent>

        <TabsContent value="post_type">
          <PeriodSummary />
          <PostTypeView selectedFields={selectedFields} platform={apiPlatform} periodParams={periodParams} />
        </TabsContent>

        <TabsContent value="trend_analysis">
          <PeriodSummary />
          <TrendAnalysisView
            platform={apiPlatform}
            periodParams={periodParams}
            gaListensMode={platformFilter === 'ga_listens'}
          />
        </TabsContent>

        <TabsContent value="imports">
          <ImportManager
            onImportsChanged={handleImportsChanged}
            accountGroups={accountGroups}
            onGroupsChanged={refreshAccountGroups}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MainView;
