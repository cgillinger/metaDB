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
  Database,
  HelpCircle,
  BarChart3,
  Activity,
  ScatterChart,
  ArrowRight,
} from 'lucide-react';
import AccountView from '../AccountView';
import ScatterExplorerView from '../AccountView/ScatterExplorerView';
import TikTokOverviewKontoView from '../AccountView/TikTokOverviewKontoView';
import PostView from '../PostView';
import PostTypeView from '../PostTypeView';
import TrendAnalysisView from '../TrendAnalysisView/TrendAnalysisView';
import ImportManager from '../ImportManager/ImportManager';
import AboutView from '../AboutView/AboutView';
import ComparisonView from '../ComparisonView';
import PlatformTrendView from '../PlatformTrendView';
import PeriodSelector from '../PeriodSelector';
import PlatformBadge from '../ui/PlatformBadge';
import { api } from '@/utils/apiClient';

const FB_ONLY_FIELDS = ['total_clicks', 'link_clicks', 'other_clicks', 'account_reach', 'estimated_unique_clicks'];
const IG_ONLY_FIELDS = ['saves', 'follows', 'ig_account_reach'];
// TikTok-poster har varken räckvidd per inlägg, totala klick eller länkklick i CSV-export.
// 'saves' är däremot tillgängligt i TikTok-export (Lägg till i Favoriter) — INTE i denna lista.
// Räckvidd finns istället på dagsnivå i Översikt-CSV (separat tabell).
const TIKTOK_UNAVAILABLE_FIELDS = [
  'reach', 'average_reach', 'account_reach', 'ig_account_reach',
  'total_clicks', 'link_clicks', 'other_clicks',
  'estimated_unique_clicks', 'follows',
];

const FIELD_CATEGORIES = [
  {
    label: 'Räckvidd & visningar',
    fields: ['views', 'average_reach', 'reach', 'account_reach', 'ig_account_reach', 'follows'],
  },
  {
    label: 'Engagemang',
    fields: ['engagement', 'interactions', 'likes', 'comments', 'shares', 'saves'],
  },
  {
    label: 'Klick',
    fields: ['total_clicks', 'link_clicks', 'other_clicks', 'estimated_unique_clicks'],
  },
  {
    label: 'Publicering',
    fields: ['post_count', 'posts_per_day'],
  },
];

// TikTok Översikt-läge (Per konto): separat fält-set + kategoriindelning.
// Mätvärdena kommer från tiktok_account_daily (sidvisningar per dag), inte posts.
const TIKTOK_OVERVIEW_AVAILABLE_FIELDS = {
  video_views: 'Sidvisningar (sum)',
  avg_daily_reach: 'Räckvidd / dag (snitt)',
  profile_views: 'Profilvisningar (sum)',
  new_followers: 'Nya följare',
  lost_followers: 'Tappade följare',
  net_follower_growth: 'Nettotillväxt',
  daily_engagement_sum: 'Dagsengagemang (sum)',
};

const TIKTOK_OVERVIEW_FIELD_CATEGORIES = [
  {
    label: 'Räckvidd & visningar',
    fields: ['video_views', 'avg_daily_reach', 'profile_views'],
  },
  {
    label: 'Följare',
    fields: ['new_followers', 'lost_followers', 'net_follower_growth'],
  },
  {
    label: 'Engagemang',
    fields: ['daily_engagement_sum'],
  },
];

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
  'account_reach': 'Kontoräckvidd (API) FB',
  'ig_account_reach': 'Kontoräckvidd (API) IG',
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
  'posts_per_day': 'Publiceringar per dag',
  'estimated_unique_clicks': 'Uppsk. unika klickare',
};

const TREND_ANALYSIS_AVAILABLE_FIELDS = {
  'views': 'Visningar',
  'reach': 'Räckvidd',
  'account_reach': 'Kontoräckvidd (API) FB',
  'ig_account_reach': 'Kontoräckvidd (API) IG',
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
    if (activePlatform === 'tiktok' && TIKTOK_UNAVAILABLE_FIELDS.includes(key)) continue;
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
    {activePlatform === 'tiktok' && (
      <p className="text-muted-foreground">
        <span className="font-medium text-foreground">TikTok:</span> gilla + kommentarer + delningar + favoriter (per inlägg)
      </p>
    )}
  </div>
);

const ValueSelector = ({ availableFields, selectedFields, onSelectionChange, activePlatform, categories = FIELD_CATEGORIES }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-4">
    {categories.map(category => {
      const visibleFields = category.fields.filter(f => f in availableFields);
      if (visibleFields.length === 0) return null;
      return (
        <div key={category.label}>
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 pb-1.5 border-b">
            {category.label}
          </h4>
          <div className="space-y-2.5">
            {visibleFields.map(key => (
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
                  {availableFields[key]}
                  {activePlatform !== 'tiktok' && FB_ONLY_FIELDS.includes(key) && <PlatformBadge platform="facebook" />}
                  {activePlatform !== 'tiktok' && IG_ONLY_FIELDS.includes(key) && <PlatformBadge platform="instagram" />}
                </Label>
              </div>
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

const PLATFORM_TITLE = {
  facebook: 'Facebook Statistik',
  instagram: 'Instagram Statistik',
  tiktok: 'TikTok Statistik',
  mixed: 'Meta Statistik',
  null: 'Meta Statistik'
};

const MainView = ({ onShowUploader }) => {
  const [selectedFields, setSelectedFields] = useState([]);
  const [activeView, setActiveView] = useState('account');
  // Scatter-explorer (räckvidd per inlägg): öppet läge + ev. förvalt konto.
  // Ersätter flikar + värdepanel medan det är öppet.
  const [scatterState, setScatterState] = useState({ open: false, account: null });
  const [platformFilter, setPlatformFilter] = useState('all');
  const [stats, setStats] = useState(null);
  const [imports, setImports] = useState([]);
  // True when at least one month of GA listening data is available
  const [hasGAListens, setHasGAListens] = useState(false);
  const [hasGASiteVisits, setHasGASiteVisits] = useState(false);
  const [hasTikTokOverview, setHasTikTokOverview] = useState(false);
  // Per konto-läge för TikTok: 'overview' (Översikt-CSV per dag) eller 'video'
  // (Video-CSV/posts per inlägg). Default 'overview' när Översikt-data finns.
  const [tiktokKontoMode, setTiktokKontoMode] = useState('overview');
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
        const [statsData, importsData, coverageResult, gaMonthsResult, gsvMonthsResult, ttOverviewMonthsResult] = await Promise.all([
          api.getStats(),
          api.getImports(),
          api.getCoverage().catch(() => ({ months: [] })),
          api.getGAListensMonths().catch(() => ({ months: [] })),
          api.getGASiteVisitsMonths().catch(() => ({ months: [] })),
          api.getTikTokOverviewMonths().catch(() => ({ months: [] })),
        ]);
        setStats(statsData);
        setImports(importsData);
        setHasGAListens((gaMonthsResult.months || []).length > 0);
        setHasGASiteVisits((gsvMonthsResult.months || []).length > 0);
        setHasTikTokOverview((ttOverviewMonthsResult.months || []).length > 0);

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

  const openScatter = useCallback((account = null) => {
    setScatterState({ open: true, account });
  }, []);
  const closeScatter = useCallback(() => {
    setScatterState({ open: false, account: null });
  }, []);

  // Lämnar man kontofliken (eller byter GA-läge) stängs scatter-explorern.
  useEffect(() => {
    if (activeView !== 'account') setScatterState({ open: false, account: null });
  }, [activeView]);

  // Detect platform from imports
  const platformInfo = useMemo(() => {
    const platforms = new Set(imports.map(i => i.platform));
    const hasFacebook = platforms.has('facebook');
    const hasInstagram = platforms.has('instagram');
    const hasTikTok = platforms.has('tiktok');
    const platformCount = [hasFacebook, hasInstagram, hasTikTok].filter(Boolean).length;
    const hasMixed = platformCount >= 2;

    let detected = null;
    if (hasMixed) detected = 'mixed';
    else if (hasFacebook) detected = 'facebook';
    else if (hasInstagram) detected = 'instagram';
    else if (hasTikTok) detected = 'tiktok';

    const fbPosts = imports.filter(i => i.platform === 'facebook').reduce((s, i) => s + i.row_count, 0);
    const igPosts = imports.filter(i => i.platform === 'instagram').reduce((s, i) => s + i.row_count, 0);
    const ttPosts = imports.filter(i => i.platform === 'tiktok').reduce((s, i) => s + i.row_count, 0);

    return { detected, hasMixed, hasFacebook, hasInstagram, hasTikTok, fbPosts, igPosts, ttPosts };
  }, [imports]);

  const activePlatform = platformInfo.hasMixed
    ? (platformFilter !== 'all' ? platformFilter : null)
    : platformInfo.detected;

  // The platform filter value to pass to API (undefined = no filter)
  const apiPlatform = platformFilter !== 'all' ? platformFilter : undefined;

  // Är vi i Per konto + TikTok Översikt-läge? Då används en helt egen field-uppsättning.
  const isTikTokOverviewMode =
    activeView === 'account' && platformFilter === 'tiktok' && hasTikTokOverview && tiktokKontoMode === 'overview';

  const getAvailableFields = () => {
    if (isTikTokOverviewMode) return TIKTOK_OVERVIEW_AVAILABLE_FIELDS;

    let fields;
    if (activeView === 'account') fields = ACCOUNT_VIEW_AVAILABLE_FIELDS;
    else if (activeView === 'trend_analysis') fields = TREND_ANALYSIS_AVAILABLE_FIELDS;
    else fields = POST_VIEW_AVAILABLE_FIELDS;

    // account_reach/ig_account_reach are monthly-only — hide in custom date range mode.
    if (periodMode === 'custom' && (fields.account_reach || fields.ig_account_reach)) {
      fields = { ...fields };
      delete fields.account_reach;
      delete fields.ig_account_reach;
    }

    return filterFieldsByPlatform(fields, activePlatform);
  };

  useEffect(() => {
    if (isTikTokOverviewMode) {
      // Förikryssa inga värden i Översikt-läget — behåll bara redan valda Översikt-fält.
      setSelectedFields(prev => prev.filter(f => Object.keys(TIKTOK_OVERVIEW_AVAILABLE_FIELDS).includes(f)));
      return;
    }
    const availableFields = Object.keys(getAvailableFields());
    setSelectedFields(prev => {
      const filtered = prev.filter(field => availableFields.includes(field));
      if (filtered.length === prev.length && filtered.every((f, i) => f === prev[i])) {
        return prev;
      }
      return filtered;
    });
  }, [activeView, activePlatform, periodMode, isTikTokOverviewMode]);

  const handleImportsChanged = async () => {
    try {
      const [statsData, importsData, coverageResult, gaMonthsResult, gsvMonthsResult, ttOverviewMonthsResult] = await Promise.all([
        api.getStats(),
        api.getImports(),
        api.getCoverage().catch(() => ({ months: [] })),
        api.getGAListensMonths().catch(() => ({ months: [] })),
        api.getGASiteVisitsMonths().catch(() => ({ months: [] })),
        api.getTikTokOverviewMonths().catch(() => ({ months: [] })),
      ]);
      setStats(statsData);
      setImports(importsData);
      setCoverageData(coverageResult.months || []);
      setHasGAListens((gaMonthsResult.months || []).length > 0);
      setHasGASiteVisits((gsvMonthsResult.months || []).length > 0);
      setHasTikTokOverview((ttOverviewMonthsResult.months || []).length > 0);
    } catch (error) {
      console.error('Fel vid uppdatering:', error);
    }
  };

  // Reset to 'account' if a hidden tab is active when switching to ga_listens/ga_site_visits
  useEffect(() => {
    if ((platformFilter === 'ga_listens' || platformFilter === 'ga_site_visits')
        && (activeView === 'post' || activeView === 'post_type')) {
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
        .filter(m => (m.ig_count ?? 0) > 0 || m.has_ig_reach)
        .map(m => ({ ...m, post_count: m.ig_count ?? 0 }));
    }
    if (platformFilter === 'tiktok') {
      // TikTok-månader: poster (Video-CSV) eller Översikt-data
      return coverageData
        .filter(m => (m.tt_count ?? 0) > 0 || m.has_tiktok_overview)
        .map(m => ({ ...m, post_count: m.tt_count ?? 0 }));
    }
    if (platformFilter === 'ga_listens') {
      // Display the number of programmes with listening data for the month
      return coverageData
        .filter(m => (m.ga_listens_count ?? 0) > 0)
        .map(m => ({ ...m, post_count: m.ga_listens_count ?? 0 }));
    }
    if (platformFilter === 'ga_site_visits') {
      return coverageData
        .filter(m => (m.ga_site_visits_count ?? 0) > 0)
        .map(m => ({ ...m, post_count: m.ga_site_visits_count ?? 0 }));
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
  const allowCustomPeriod = platformFilter !== 'ga_listens' && platformFilter !== 'ga_site_visits';

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

      {(platformInfo.hasMixed || hasGAListens || hasGASiteVisits || platformInfo.hasTikTok || hasTikTokOverview) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 mr-1">Plattform:</span>
          {platformInfo.hasMixed && (
            <button
              key="all"
              onClick={() => setPlatformFilter('all')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'all'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary/60'
              }`}
            >
              Alla ({platformInfo.fbPosts + platformInfo.igPosts + platformInfo.ttPosts})
            </button>
          )}
          {platformInfo.hasFacebook && platformInfo.hasMixed && (
            <button
              onClick={() => setPlatformFilter('facebook')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'facebook'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary/60'
              }`}
            >
              Facebook ({platformInfo.fbPosts})
            </button>
          )}
          {platformInfo.hasInstagram && platformInfo.hasMixed && (
            <button
              onClick={() => setPlatformFilter('instagram')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'instagram'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary/60'
              }`}
            >
              Instagram ({platformInfo.igPosts})
            </button>
          )}
          {(platformInfo.hasTikTok || hasTikTokOverview) && (
            <button
              onClick={() => setPlatformFilter('tiktok')}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'tiktok'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-black/60'
              }`}
            >
              TikTok{platformInfo.hasTikTok ? ` (${platformInfo.ttPosts})` : ''}
            </button>
          )}
          {/* Unified Google Analytics button — shown when either GA source has data */}
          {(hasGAListens || hasGASiteVisits) && (
            <button
              onClick={() => {
                if (platformFilter !== 'ga_listens' && platformFilter !== 'ga_site_visits') {
                  setPlatformFilter(hasGAListens ? 'ga_listens' : 'ga_site_visits');
                }
              }}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                platformFilter === 'ga_listens' || platformFilter === 'ga_site_visits'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
              }`}
            >
              Google Analytics
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

      {activeView !== 'trend_analysis' && activeView !== 'imports' && activeView !== 'comparison' && activeView !== 'platform_trend' && platformFilter !== 'ga_listens' && platformFilter !== 'ga_site_visits' && !scatterState.open && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-base font-semibold mb-3">Välj värden att visa</h3>
            <ValueSelector
              availableFields={getAvailableFields()}
              selectedFields={selectedFields}
              onSelectionChange={setSelectedFields}
              activePlatform={activePlatform}
              categories={isTikTokOverviewMode ? TIKTOK_OVERVIEW_FIELD_CATEGORIES : FIELD_CATEGORIES}
            />
            {selectedFields.includes('engagement') && (
              <EngagementLegend activePlatform={activePlatform} />
            )}
            {/* Scatter (räckvidd per inlägg) bygger på posts-data — bara meningsfullt
                i Video-CSV-läget, inte i Översikt-läget (där det inte finns inlägg). */}
            {activeView === 'account' && !isTikTokOverviewMode && (
              <div className="mt-4 border-t pt-4 px-4">
                <Button variant="outline" onClick={() => openScatter(null)}>
                  <ScatterChart className="w-4 h-4 mr-2" />
                  Gå till scatterdiagram för räckvidd
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {scatterState.open && (
        <ScatterExplorerView
          apiPlatform={apiPlatform}
          periodParams={periodParams}
          initialAccount={scatterState.account}
          onBack={closeScatter}
        />
      )}

      {!scatterState.open && (
      <Tabs value={activeView} onValueChange={setActiveView}>
        <TabsList>
          <TabsTrigger value="account">Per konto</TabsTrigger>
          {platformFilter !== 'ga_listens' && platformFilter !== 'ga_site_visits' && <TabsTrigger value="post">Per inlägg</TabsTrigger>}
          {platformFilter !== 'ga_listens' && platformFilter !== 'ga_site_visits' && <TabsTrigger value="post_type">Per inläggstyp</TabsTrigger>}
          <TabsTrigger value="trend_analysis">
            <TrendingUp className="w-4 h-4 mr-1" />
            Trendanalys
          </TabsTrigger>
          <TabsTrigger value="platform_trend">
            <Activity className="w-4 h-4 mr-1" />
            Plattformstrend
          </TabsTrigger>
          <TabsTrigger value="comparison">
            <BarChart3 className="w-4 h-4 mr-1" />
            Jämförelser
          </TabsTrigger>
          <TabsTrigger value="imports">
            <Database className="w-4 h-4 mr-1" />
            Databas
          </TabsTrigger>
          <TabsTrigger value="about">
            <HelpCircle className="w-4 h-4 mr-1" />
            Om appen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <PeriodSummary />
          {platformFilter === 'tiktok' && hasTikTokOverview && (
            <Card className="mb-3">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Vy:</span>
                  <div className="inline-flex rounded-md border overflow-hidden">
                    <button
                      onClick={() => setTiktokKontoMode('overview')}
                      className={`px-3 py-1.5 text-sm transition-colors ${
                        tiktokKontoMode === 'overview'
                          ? 'bg-black text-white font-medium'
                          : 'bg-white text-muted-foreground hover:bg-gray-50'
                      }`}
                    >
                      Översikt (per dag)
                    </button>
                    <button
                      onClick={() => setTiktokKontoMode('video')}
                      className={`px-3 py-1.5 text-sm border-l transition-colors ${
                        tiktokKontoMode === 'video'
                          ? 'bg-black text-white font-medium'
                          : 'bg-white text-muted-foreground hover:bg-gray-50'
                      }`}
                    >
                      Inlägg-aggregat (per video)
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground flex-1 min-w-[280px]">
                    {tiktokKontoMode === 'overview'
                      ? 'Sidans daglig statistik (Översikt-CSV). "Sidvisningar" = alla videovisningar på sidan per dag, inkl. äldre videor som tittas på under perioden.'
                      : 'Inläggsstatistik per video (Video-CSV). "Visningar" = ackumulerade visningar för videor publicerade i perioden, oavsett när visningen skedde.'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {isTikTokOverviewMode ? (
            <TikTokOverviewKontoView
              selectedFields={selectedFields}
              periodParams={periodParams}
            />
          ) : (
            <AccountView
              selectedFields={selectedFields}
              platform={apiPlatform}
              periodParams={periodParams}
              gaListensMode={platformFilter === 'ga_listens'}
              gaSiteVisitsMode={platformFilter === 'ga_site_visits'}
              accountGroups={accountGroups}
              onGroupsChanged={refreshAccountGroups}
              onPlatformChange={setPlatformFilter}
              onOpenScatter={openScatter}
            />
          )}
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
            gaSiteVisitsMode={platformFilter === 'ga_site_visits'}
            accountGroups={accountGroups}
            onGroupsChanged={refreshAccountGroups}
            onPlatformChange={setPlatformFilter}
          />
        </TabsContent>

        <TabsContent value="platform_trend">
          <PeriodSummary />
          <PlatformTrendView periodParams={periodParams} />
        </TabsContent>

        <TabsContent value="comparison">
          <ComparisonView
            periodParams={periodParams}
            accountGroups={accountGroups}
            onGroupsChanged={refreshAccountGroups}
          />
        </TabsContent>

        <TabsContent value="imports">
          <ImportManager
            onImportsChanged={handleImportsChanged}
            accountGroups={accountGroups}
            onGroupsChanged={refreshAccountGroups}
          />
        </TabsContent>

        <TabsContent value="about">
          <AboutView />
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
};

export default MainView;
