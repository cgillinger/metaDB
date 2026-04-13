/**
 * TrendAnalysisView — month-over-month line chart for selected accounts.
 * Supports both Meta post metrics (standard mode) and GA listens
 * (gaListensMode), where chart lines represent programme listening trends.
 */
import React, { useState, useEffect, useMemo } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import CollabBadge from '../ui/CollabBadge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import {
  TrendingUp,
  LineChart,
  AlertCircle,
  Users,
} from 'lucide-react';
import { api } from '@/utils/apiClient';
import GroupCreateDialog from '../AccountGroups/GroupCreateDialog';

// P4 Lokalt regional channel names — explicit Set for O(1) membership lookup.
const P4_CHANNELS = new Set([
  'P4 Blekinge', 'P4 Dalarna', 'P4 Fyrbodal', 'P4 Göteborg',
  'P4 Gävleborg', 'P4 Gotland', 'P4 Halland', 'P4 Jämtland',
  'P4 Jönköping', 'P4 Kalmar', 'P4 Kristianstad', 'P4 Kronoberg',
  'P4 Malmöhus', 'P4 Norrbotten', 'P4 Sjuhärad', 'P4 Skaraborg',
  'P4 Stockholm', 'P4 Sörmland', 'P4 Uppland', 'P4 Värmland',
  'P4 Västerbotten', 'P4 Västernorrland', 'P4 Västmanland',
  'P4 Väst', 'P4 Östergötland',
]);

/**
 * Comparator that places P4 Lokalt channels first, then all other programmes,
 * each group sorted alphabetically with Swedish locale.
 */
const sortGAPrograms = (a, b) => {
  const ga = P4_CHANNELS.has(a) ? 0 : 1;
  const gb = P4_CHANNELS.has(b) ? 0 : 1;
  if (ga !== gb) return ga - gb;
  return a.localeCompare(b, 'sv');
};

const TREND_METRICS_COMMON = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'interactions': 'Interaktioner (gilla+kommentar+delning)',
  'engagement': 'Totalt engagemang',
  'likes': 'Reaktioner / Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};
const TREND_METRICS_FB = { 'account_reach': 'Kontoräckvidd (API)', 'total_clicks': 'Totalt antal klick', 'link_clicks': 'Länkklick', 'other_clicks': 'Övriga klick', 'estimated_unique_clicks': 'Uppsk. unika länkklickare' };
const TREND_METRICS_IG = { 'saves': 'Sparade', 'follows': 'Följare' };

const CHART_COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C'
];

// Metrics that cannot be meaningfully summed across accounts in a group
const NON_SUMMABLE_METRICS = new Set([
  'reach', 'average_reach', 'account_reach', 'posts_per_day', 'estimated_unique_clicks',
]);

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

// Composite key for unique account identification across platforms
const accountKey = (name, platform) => `${name}::${platform}`;
const parseAccountKey = (key) => {
  const idx = key.lastIndexOf('::');
  return { name: key.slice(0, idx), platform: key.slice(idx + 2) };
};

const calculateNiceYAxis = (maxValue) => {
  if (maxValue <= 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
  let tickInterval;
  const normalizedMax = maxValue / magnitude;
  if (normalizedMax <= 1) tickInterval = magnitude * 0.25;
  else if (normalizedMax <= 2) tickInterval = magnitude * 0.5;
  else if (normalizedMax <= 5) tickInterval = magnitude * 1;
  else if (normalizedMax <= 10) tickInterval = magnitude * 2;
  else tickInterval = magnitude * 5;
  const niceMax = Math.ceil(maxValue / tickInterval) * tickInterval;
  const ticks = [];
  for (let i = 0; i <= niceMax; i += tickInterval) ticks.push(Math.round(i));
  return { min: 0, max: niceMax, ticks, tickInterval };
};

const createSmoothPath = (points) => {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const current = points[i], previous = points[i - 1];
    if (i === 1) {
      const next = points[i + 1] || current;
      path += ` C ${previous.x + (current.x - previous.x) * 0.3} ${previous.y + (current.y - previous.y) * 0.3}, ${current.x - (next.x - previous.x) * 0.1} ${current.y - (next.y - previous.y) * 0.1}, ${current.x} ${current.y}`;
    } else if (i === points.length - 1) {
      const beforePrev = points[i - 2] || previous;
      path += ` C ${previous.x + (current.x - beforePrev.x) * 0.1} ${previous.y + (current.y - beforePrev.y) * 0.1}, ${current.x - (current.x - previous.x) * 0.3} ${current.y - (current.y - previous.y) * 0.3}, ${current.x} ${current.y}`;
    } else {
      const next = points[i + 1], beforePrev = points[i - 2] || previous;
      path += ` C ${previous.x + (current.x - beforePrev.x) * 0.1} ${previous.y + (current.y - beforePrev.y) * 0.1}, ${current.x - (next.x - previous.x) * 0.1} ${current.y - (next.y - previous.y) * 0.1}, ${current.x} ${current.y}`;
    }
  }
  return path;
};

const getMonthName = (month) => MONTH_NAMES_SV[month - 1] || String(month);

const TrendAnalysisView = ({
  platform,
  periodParams = {},
  gaListensMode = false,
  accountGroups = [],
  onGroupsChanged = null,
}) => {
  const [selectedMetric, setSelectedMetric] = useState('interactions');
  // selectedAccounts stores composite keys: "account_name::platform" or "__group__<id>"
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [groupNotice, setGroupNotice] = useState(null);

  const [accountList, setAccountList] = useState([]);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(false);

  // GA Listens state — populated only when gaListensMode is true
  const [gaRawData, setGaRawData] = useState([]);       // flat rows from API
  const [gaAccountList, setGaAccountList] = useState([]); // sorted account objects

  // Group create dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogAccounts, setGroupDialogAccounts] = useState([]);

  // Clear selection and trend data when switching between GA and post mode
  useEffect(() => {
    setSelectedAccounts([]);
    setTrendData(null);
  }, [gaListensMode]);

  // Detect platforms from account list
  const { hasFacebook, hasInstagram } = useMemo(() => {
    const platforms = new Set(accountList.map(a => a.platform));
    return { hasFacebook: platforms.has('facebook'), hasInstagram: platforms.has('instagram') };
  }, [accountList]);

  const availableMetrics = useMemo(() => {
    const metrics = { ...TREND_METRICS_COMMON };
    if (hasFacebook) Object.assign(metrics, TREND_METRICS_FB);
    if (hasInstagram) Object.assign(metrics, TREND_METRICS_IG);
    return metrics;
  }, [hasFacebook, hasInstagram]);

  // Inject GA groups into the GA account list
  const gaAccountListWithGroups = useMemo(() => {
    const gaNames = new Set(gaAccountList.map(a => a.account_name));
    const gaGroups = accountGroups
      .filter(g => g.source === 'ga_listens')
      .map(g => {
        const memberNames = g.members.map(k => k.split('::')[0]);
        const matchedCount = memberNames.filter(n => gaNames.has(n)).length;
        return {
          account_name: g.name,
          platform: 'ga_listens',
          is_collab: false,
          key: `__group__${g.id}`,
          _isGroup: true,
          groupId: g.id,
          memberKeys: g.members,
          memberCount: g.members.length,
          matchedCount,
          disabled: matchedCount === 0,
        };
      })
      .sort((a, b) => (a.account_name || '').localeCompare((b.account_name || ''), 'sv'));
    const sortedGaList = [...gaAccountList].sort((a, b) =>
      (a.account_name || '').localeCompare((b.account_name || ''), 'sv')
    );
    return [...gaGroups, ...sortedGaList];
  }, [accountGroups, gaAccountList]);

  // Inject posts groups into the posts account list
  const accountListWithGroups = useMemo(() => {
    const postKeys = new Set(accountList.map(a => a.key));
    const postGroups = accountGroups
      .filter(g => g.source === 'posts')
      .map(g => {
        const matchedCount = g.members.filter(k => postKeys.has(k)).length;
        return {
          account_name: g.name,
          platform: 'group',
          is_collab: false,
          key: `__group__${g.id}`,
          _isGroup: true,
          groupId: g.id,
          memberKeys: g.members,
          memberCount: g.members.length,
          matchedCount,
          disabled: matchedCount === 0,
        };
      })
      .sort((a, b) => (a.account_name || '').localeCompare((b.account_name || ''), 'sv'));
    const sorted = [...accountList].sort((a, b) =>
      (a.account_name || '').localeCompare((b.account_name || ''), 'sv')
    );
    return [...postGroups, ...sorted];
  }, [accountGroups, accountList]);

  // True when any selected account is a group
  const hasGroupSelected = selectedAccounts.some(k => k.startsWith('__group__'));

  // Auto-switch from non-summable metric when a group is selected
  useEffect(() => {
    if (!gaListensMode && hasGroupSelected && NON_SUMMABLE_METRICS.has(selectedMetric)) {
      setSelectedMetric('interactions');
      setGroupNotice('Räckvidd kan inte aggregeras för kontogrupper. Bytte till Interaktioner.');
    }
  }, [gaListensMode, hasGroupSelected, selectedMetric]);

  useEffect(() => {
    if (!groupNotice) return;
    const t = setTimeout(() => setGroupNotice(null), 4000);
    return () => clearTimeout(t);
  }, [groupNotice]);

  // Fetch account list (posts mode only)
  useEffect(() => {
    if (gaListensMode) return;
    const fetchAccounts = async () => {
      try {
        const params = { fields: 'views', ...periodParams, includeReachOnly: 'true' };
        if (platform) params.platform = platform;
        const data = await api.getAccounts(params);
        setAccountList((data.accounts || []).map(a => ({
          account_id: a.account_id,
          account_name: a.account_name,
          platform: a.platform,
          is_collab: a.is_collab,
          key: accountKey(a.account_name, a.platform),
        })));
      } catch (error) {
        console.error('Fel vid hämtning av konton:', error);
      }
    };
    fetchAccounts();
  }, [gaListensMode, platform, periodParams]);

  // Fetch trend data when metric or accounts change (posts mode only)
  useEffect(() => {
    if (gaListensMode) return;
    if (!selectedMetric || selectedAccounts.length === 0) {
      setTrendData(null);
      return;
    }
    const fetchTrends = async () => {
      setLoading(true);
      try {
        // Expand group selections into their member keys for the API call
        const expandedKeys = selectedAccounts.flatMap(key => {
          if (key.startsWith('__group__')) {
            const entry = accountListWithGroups.find(a => a.key === key);
            return entry ? entry.memberKeys : [];
          }
          return [key];
        });
        const uniqueKeys = [...new Set(expandedKeys)];
        if (uniqueKeys.length === 0) { setTrendData(null); return; }

        const params = {
          metric: selectedMetric,
          accountKeys: uniqueKeys.join('||'),
          granularity: 'month',
          ...periodParams,
        };
        if (platform) params.platform = platform;
        const data = await api.getTrends(params);
        setTrendData(data);
      } catch (error) {
        console.error('Fel vid hämtning av trenddata:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTrends();
  }, [gaListensMode, selectedMetric, selectedAccounts, platform, periodParams, accountListWithGroups]);

  // Build chart lines from trend data, aggregating group series client-side
  const { months, chartLines } = useMemo(() => {
    if (!trendData || !trendData.months || !trendData.series) {
      return { months: [], chartLines: [] };
    }

    // Index raw series by composite key for fast lookup
    const seriesByKey = {};
    for (const s of trendData.series) {
      seriesByKey[accountKey(s.account_name, s.platform)] = s;
    }

    let colorIndex = 0;
    const lines = selectedAccounts.map(selectedKey => {
      const entry = accountListWithGroups.find(a => a.key === selectedKey);
      if (!entry) return null;

      if (entry._isGroup) {
        // Sum member series element-wise
        const summedData = trendData.months.map((_, mIndex) =>
          entry.memberKeys.reduce((sum, memberKey) => {
            const s = seriesByKey[memberKey];
            return sum + (s ? (s.data[mIndex] || 0) : 0);
          }, 0)
        );
        return {
          key: selectedKey,
          account_name: entry.account_name,
          platform: 'group',
          is_collab: false,
          _isGroup: true,
          color: CHART_COLORS[colorIndex++ % CHART_COLORS.length],
          points: trendData.months.map((monthKey, mIndex) => ({
            month: monthKey,
            value: summedData[mIndex],
          })),
        };
      }

      // Regular account
      const series = seriesByKey[selectedKey];
      if (!series) return null;
      const isEstimatedMetric = selectedMetric === 'estimated_unique_clicks';
      return {
        key: selectedKey,
        account_name: series.account_name,
        platform: series.platform,
        is_collab: series.is_collab || false,
        _isGroup: false,
        color: CHART_COLORS[colorIndex++ % CHART_COLORS.length],
        points: trendData.months.map((monthKey, mIndex) => {
          if (isEstimatedMetric) {
            const datum = series.data[mIndex];
            return {
              month: monthKey,
              value: datum?.value ?? null,
              valueLower: datum?.lower ?? null,
              quality: datum?.quality ?? 'suppressed',
            };
          }
          return {
            month: monthKey,
            value: series.data[mIndex] ?? 0,
          };
        }),
      };
    }).filter(Boolean);

    return { months: trendData.months, chartLines: lines };
  }, [trendData, selectedAccounts, accountListWithGroups, selectedMetric]);

  const yAxisConfig = useMemo(() => {
    if (chartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = chartLines.flatMap(line => line.points.map(p => p.value).filter(v => v !== null && v !== undefined));
    if (allValues.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    return calculateNiceYAxis(Math.max(...allValues));
  }, [chartLines]);

  // Fetch GA listens data and build the sorted account list
  useEffect(() => {
    if (!gaListensMode) return;
    const fetchGA = async () => {
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim())
          : null;
        const result = await api.getGAListens(months);
        const rows = result.data || [];
        setGaRawData(rows);
        const names = [...new Set(rows.map(r => r.account_name))].sort(sortGAPrograms);
        setGaAccountList(names.map(name => ({
          account_name: name,
          platform: 'ga_listens',
          is_collab: false,
          key: accountKey(name, 'ga_listens'),
        })));
      } catch (err) {
        console.error('Fel vid hämtning av GA-lyssningar:', err);
      }
    };
    fetchGA();
  }, [gaListensMode, periodParams]);

  // GA pivot: { account_name → { 'YYYY-MM' → listens } }
  // Computed only in GA mode to avoid unnecessary work in posts mode.
  const gaPivot = useMemo(() => {
    if (!gaListensMode) return {};
    const map = {};
    for (const row of gaRawData) {
      if (!map[row.account_name]) map[row.account_name] = {};
      map[row.account_name][row.month] = row.listens;
    }
    return map;
  }, [gaListensMode, gaRawData]);

  // Build the full month span for the GA chart x-axis so months without
  // any listens still render as zero. Falls back to the set of months that
  // actually have data when no period filter is active.
  const gaMonths = useMemo(() => {
    if (!gaListensMode) return [];

    if (periodParams.months) {
      return periodParams.months.split(',').map(m => m.trim()).filter(Boolean).sort();
    }
    if (periodParams.dateFrom && periodParams.dateTo) {
      const start = periodParams.dateFrom.slice(0, 7);
      const end = periodParams.dateTo.slice(0, 7);
      const months = [];
      let current = start;
      while (current <= end) {
        months.push(current);
        const [y, m] = current.split('-').map(Number);
        current = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      }
      return months;
    }

    return [...new Set(gaRawData.map(r => r.month))].sort();
  }, [gaListensMode, gaRawData, periodParams]);

  const gaChartLines = useMemo(() => {
    if (!gaListensMode || selectedAccounts.length === 0) return [];
    return selectedAccounts.map((key, index) => {
      const entry = gaAccountListWithGroups.find(a => a.key === key);
      if (!entry) return null;

      if (entry._isGroup) {
        // Aggregate listens across all member accounts per month
        const aggregatedByMonth = {};
        for (const memberKey of entry.memberKeys) {
          const memberName = memberKey.split('::')[0];
          const memberData = gaPivot[memberName];
          if (!memberData) continue;
          for (const [month, listens] of Object.entries(memberData)) {
            aggregatedByMonth[month] = (aggregatedByMonth[month] || 0) + listens;
          }
        }
        return {
          key,
          account_name: entry.account_name,
          platform: 'ga_listens',
          is_collab: false,
          _isGroup: true,
          color: CHART_COLORS[index % CHART_COLORS.length],
          points: gaMonths.map(m => ({ month: m, value: aggregatedByMonth[m] || 0 })),
        };
      }

      // Regular account
      const data = gaPivot[entry.account_name] || {};
      return {
        key,
        account_name: entry.account_name,
        platform: 'ga_listens',
        is_collab: false,
        _isGroup: false,
        color: CHART_COLORS[index % CHART_COLORS.length],
        points: gaMonths.map(month => ({ month, value: data[month] ?? 0 })),
      };
    }).filter(Boolean);
  }, [gaListensMode, selectedAccounts, gaPivot, gaMonths, gaAccountListWithGroups]);

  const gaYAxisConfig = useMemo(() => {
    if (gaChartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = gaChartLines.flatMap(line => line.points.map(p => p.value));
    return calculateNiceYAxis(Math.max(...allValues));
  }, [gaChartLines]);

  // Transparent switchers so the SVG chart render logic below needs no branching.
  const displayMonths    = gaListensMode ? gaMonths    : months;
  const displayChartLines = gaListensMode ? gaChartLines : chartLines;
  const displayYAxisConfig = gaListensMode ? gaYAxisConfig : yAxisConfig;

  // Filter account list based on selected metric (account_reach = FB only)
  // Groups are always kept in the list regardless of metric filter
  const filteredAccountList = useMemo(() => {
    if (selectedMetric === 'account_reach' || selectedMetric === 'estimated_unique_clicks') {
      return accountListWithGroups.filter(a => a._isGroup || a.platform === 'facebook');
    }
    return accountListWithGroups;
  }, [accountListWithGroups, selectedMetric]);

  // When metric changes to account_reach or estimated_unique_clicks, remove non-FB accounts from selection
  useEffect(() => {
    if (!gaListensMode && (selectedMetric === 'account_reach' || selectedMetric === 'estimated_unique_clicks')) {
      const fbKeys = new Set(
        accountListWithGroups
          .filter(a => a._isGroup || a.platform === 'facebook')
          .map(a => a.key)
      );
      setSelectedAccounts(prev => prev.filter(k => fbKeys.has(k)));
    }
  }, [gaListensMode, selectedMetric, accountListWithGroups]);

  // Final display account list
  const activeAccountList = gaListensMode ? gaAccountListWithGroups : filteredAccountList;

  const handleAccountToggle = (key) => {
    setSelectedAccounts(current =>
      current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    );
  };

  const handleToggleAllAccounts = () => {
    const selectableKeys = activeAccountList.filter(a => !a.disabled).map(a => a.key);
    const allSelected = selectableKeys.length > 0 && selectableKeys.every(k => selectedAccounts.includes(k));
    setSelectedAccounts(allSelected ? [] : selectableKeys);
  };

  const allAccountsSelected = (() => {
    const selectableKeys = activeAccountList.filter(a => !a.disabled).map(a => a.key);
    return selectableKeys.length > 0 && selectableKeys.every(k => selectedAccounts.includes(k));
  })();

  const handleMouseMove = (event, point) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    setHoveredDataPoint(point);
  };

  const showChart = gaListensMode
    ? selectedAccounts.length > 0 && displayMonths.length > 0
    : selectedMetric && selectedAccounts.length > 0 && months.length > 0;

  if (activeAccountList.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />Trendanalys</CardTitle></CardHeader>
        <CardContent>
          <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>Ingen data tillgänglig</AlertTitle>
            <AlertDescription>Ladda upp CSV-data för att se trendanalys.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5" />Trendanalys över tid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Account / program selector */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-medium">
                  {gaListensMode ? 'Välj program' : 'Välj konton'} ({selectedAccounts.length} valda)
                </Label>
                <Button variant="outline" size="sm" onClick={handleToggleAllAccounts}>
                  {allAccountsSelected ? 'Avmarkera alla' : 'Välj alla'}
                </Button>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2 bg-gray-50">
                {activeAccountList.map((account, idx) => {
                  const isGroup = account._isGroup;
                  const prevIsGroup = idx > 0 && activeAccountList[idx - 1]._isGroup;
                  const showDivider = !isGroup && idx > 0 && prevIsGroup;
                  return (
                    <React.Fragment key={account.key}>
                      {showDivider && <hr className="border-border my-1" />}
                      <Label
                        className={`flex items-center gap-2 cursor-pointer p-2 rounded ${
                          account.disabled
                            ? 'opacity-40 cursor-not-allowed'
                            : isGroup
                            ? 'hover:bg-blue-50 bg-blue-50/50'
                            : 'hover:bg-white'
                        }`}
                        title={account.disabled ? 'Inga matchande konton i vald period' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(account.key)}
                          onChange={() => !account.disabled && handleAccountToggle(account.key)}
                          disabled={account.disabled}
                          className="h-4 w-4 accent-blue-600"
                        />
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          {isGroup && <Users className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                          {account.account_name}
                          {isGroup ? (
                            <span className="text-xs text-muted-foreground font-normal">
                              {account.matchedCount}/{account.memberCount}
                            </span>
                          ) : (
                            <>
                              <PlatformBadge platform={account.platform} />
                              {account.is_collab ? <CollabBadge compact /> : null}
                            </>
                          )}
                        </span>
                      </Label>
                    </React.Fragment>
                  );
                })}
              </div>
              {/* Skapa grupp button */}
              <button
                onClick={() => {
                  setGroupDialogAccounts(gaListensMode ? gaAccountList : accountList);
                  setGroupDialogOpen(true);
                }}
                className="mt-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Users className="w-3.5 h-3.5" />
                Skapa kontogrupp
              </button>
            </div>

            {/* Metric selector — hidden in GA mode (metric is fixed: Lyssningar) */}
            {gaListensMode ? (
              <div>
                <Label className="text-base font-medium mb-3 block">Datapunkt</Label>
                <div className="border rounded-md p-3 bg-gray-50">
                  <span className="text-sm flex items-center gap-1.5 font-medium">
                    <PlatformBadge platform="ga_listens" />
                    Lyssningar
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-base font-medium mb-3 block">Välj datapunkt att analysera</Label>
                <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-gray-50">
                  {Object.entries(availableMetrics).map(([key, label]) => {
                    const disabledByGroup = hasGroupSelected && NON_SUMMABLE_METRICS.has(key);
                    return (
                      <Label
                        key={key}
                        className={`flex items-center gap-2 p-1 rounded ${
                          disabledByGroup
                            ? 'opacity-40 cursor-not-allowed'
                            : 'cursor-pointer hover:bg-white'
                        }`}
                        title={disabledByGroup ? 'Kan ej aggregeras för kontogrupper' : undefined}
                      >
                        <input
                          type="radio"
                          name="trendMetric"
                          value={key}
                          checked={selectedMetric === key}
                          onChange={() => !disabledByGroup && setSelectedMetric(key)}
                          disabled={disabledByGroup}
                          className="h-4 w-4 border-gray-300 accent-primary"
                        />
                        <span className="text-sm flex items-center gap-1.5">
                          {label}
                          {['account_reach', 'total_clicks', 'link_clicks', 'other_clicks', 'estimated_unique_clicks'].includes(key) && <PlatformBadge platform="facebook" />}
                          {['saves', 'follows'].includes(key) && <PlatformBadge platform="instagram" />}
                        </span>
                      </Label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {(gaListensMode || selectedMetric) && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
              <h3 className="text-lg font-bold text-primary">
                Visar: {gaListensMode ? 'Lyssningar (GA)' : availableMetrics[selectedMetric]}
              </h3>
              <p className="text-sm text-primary/70 mt-1">Utveckling över tid för valda {gaListensMode ? 'program' : 'konton'}</p>
            </div>
          )}

          {groupNotice && (
            <Alert className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{groupNotice}</AlertDescription>
            </Alert>
          )}

          {showChart ? (
            <div className="space-y-4">
              {/* Legend */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {displayChartLines.map(line => (
                  <div key={line.key} className={`flex items-center gap-2 px-1 py-0.5 rounded ${line._isGroup ? 'bg-blue-50' : ''}`}>
                    <div
                      className="flex-shrink-0 border"
                      style={{
                        backgroundColor: line.color,
                        width: line._isGroup ? '14px' : '12px',
                        height: line._isGroup ? '14px' : '12px',
                        borderRadius: line._isGroup ? '2px' : '50%',
                      }}
                    />
                    <span className="text-sm font-medium truncate flex items-center gap-1" title={line.account_name}>
                      {line._isGroup && <Users className="w-3 h-3 text-blue-600 shrink-0" />}
                      {line.account_name.length > 20 ? line.account_name.substring(0, 17) + '...' : line.account_name}
                      {!line._isGroup && <PlatformBadge platform={line.platform} />}
                      {line.is_collab ? <CollabBadge compact /> : null}
                    </span>
                  </div>
                ))}
              </div>

              {/* Line chart */}
              <div className="relative">
                <svg width="100%" height="500" viewBox="0 0 1000 500" className="border rounded bg-gray-50"
                  onMouseLeave={() => setHoveredDataPoint(null)}>
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />

                  {displayYAxisConfig.ticks.map(tickValue => {
                    const yPos = 450 - ((tickValue - displayYAxisConfig.min) / (displayYAxisConfig.max - displayYAxisConfig.min)) * 380;
                    return (
                      <g key={tickValue}>
                        <line x1="70" y1={yPos} x2="930" y2={yPos} stroke="#d1d5db" strokeWidth="1" />
                        <text x="65" y={yPos + 4} textAnchor="end" fontSize="14" fill="#6b7280">{tickValue.toLocaleString()}</text>
                      </g>
                    );
                  })}

                  {displayMonths.map((monthKey, index) => {
                    const [year, month] = monthKey.split('-').map(Number);
                    const xPos = 70 + (index / Math.max(1, displayMonths.length - 1)) * 860;
                    return (
                      <g key={monthKey}>
                        <line x1={xPos} y1="70" x2={xPos} y2="450" stroke="#d1d5db" strokeWidth="1" />
                        <text x={xPos} y="475" textAnchor="middle" fontSize="14" fill="#6b7280">{getMonthName(month)}</text>
                        <text x={xPos} y="490" textAnchor="middle" fontSize="12" fill="#9ca3af">{year}</text>
                      </g>
                    );
                  })}

                  {displayChartLines.map(line => {
                    if (line.points.length < 1) return null;
                    const isEstimated = !gaListensMode && selectedMetric === 'estimated_unique_clicks';
                    const yRange = displayYAxisConfig.max - displayYAxisConfig.min;
                    const toY = (val) => yRange > 0 ? 450 - ((val - displayYAxisConfig.min) / yRange) * 380 : 450;

                    const pathPoints = line.points.map((point, index) => {
                      const x = 70 + (index / Math.max(1, displayMonths.length - 1)) * 860;
                      if (isEstimated && point.value === null) {
                        return { x, y: null, yLower: null, point };
                      }
                      return {
                        x,
                        y: toY(point.value ?? 0),
                        yLower: isEstimated && point.valueLower !== null ? toY(point.valueLower) : null,
                        point,
                      };
                    });

                    const visiblePoints = isEstimated ? pathPoints.filter(p => p.y !== null) : pathPoints;

                    const bandPath = isEstimated && visiblePoints.length > 1
                      ? (() => {
                          const upper = visiblePoints.map(p => `${p.x} ${p.y}`).join(' L ');
                          const lower = [...visiblePoints].reverse().map(p => `${p.x} ${p.yLower ?? p.y}`).join(' L ');
                          return `M ${upper} L ${lower} Z`;
                        })()
                      : null;

                    return (
                      <g key={line.key}>
                        {bandPath && (
                          <path d={bandPath} fill={line.color} fillOpacity="0.12" stroke="none" />
                        )}
                        {isEstimated && visiblePoints.length > 1 && (
                          <path
                            d={createSmoothPath(visiblePoints.map(p => ({ x: p.x, y: p.yLower ?? p.y })))}
                            fill="none"
                            stroke={line.color}
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                            strokeOpacity="0.5"
                            strokeLinecap="round"
                          />
                        )}
                        {visiblePoints.length > 1 && (
                          <path
                            d={createSmoothPath(visiblePoints.map(p => ({ x: p.x, y: p.y })))}
                            fill="none"
                            stroke={line.color}
                            strokeWidth={line._isGroup ? '4' : '2.5'}
                            strokeDasharray={line._isGroup ? '10 4' : undefined}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {visiblePoints.map(({ x, y, point }, index) => (
                          <circle
                            key={index}
                            cx={x} cy={y}
                            r={line._isGroup ? '6' : '5'}
                            fill={line.color}
                            stroke="white"
                            strokeWidth="2"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handleMouseMove(e, { ...point, account_name: line.account_name, platform: line.platform, color: line.color, _isGroup: line._isGroup })}
                          />
                        ))}
                      </g>
                    );
                  })}

                  {hoveredDataPoint && (() => {
                    const tooltipWidth = 240, tooltipHeight = 88;
                    let tooltipX = mousePosition.x + 15, tooltipY = mousePosition.y - 45;
                    if (tooltipX + tooltipWidth > 980) tooltipX = mousePosition.x - tooltipWidth - 15;
                    if (tooltipY < 15) tooltipY = mousePosition.y + 15;
                    if (tooltipY + tooltipHeight > 480) tooltipY = mousePosition.y - tooltipHeight - 15;
                    const [year, month] = hoveredDataPoint.month.split('-').map(Number);
                    const tooltipMetric = gaListensMode ? 'Lyssningar' : availableMetrics[selectedMetric];
                    const isEstimatedTooltip = !gaListensMode && selectedMetric === 'estimated_unique_clicks';
                    const tooltipValueText = isEstimatedTooltip
                      ? (() => {
                          const upper = hoveredDataPoint.value;
                          const lower = hoveredDataPoint.valueLower;
                          const quality = hoveredDataPoint.quality;
                          if (upper === null || quality === 'suppressed') return 'Kan ej beräknas';
                          const range = lower !== null
                            ? `~${Math.round(lower).toLocaleString('sv-SE')} – ${Math.round(upper).toLocaleString('sv-SE')}`
                            : `~${Math.round(upper).toLocaleString('sv-SE')}`;
                          return quality === 'uncertain' ? `${range} ⚠ Hög osäkerhet` : range;
                        })()
                      : (hoveredDataPoint.value ?? 0).toLocaleString('sv-SE');
                    return (
                      <g>
                        <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} fill="rgba(0,0,0,0.85)" rx="6" />
                        <text x={tooltipX + 12} y={tooltipY + 20} fill="white" fontSize="13" fontWeight="bold">{hoveredDataPoint.account_name}</text>
                        <text x={tooltipX + 12} y={tooltipY + 38} fill="white" fontSize="12">{getMonthName(month)} {year}</text>
                        <text x={tooltipX + 12} y={tooltipY + 55} fill="white" fontSize="11">{tooltipMetric}</text>
                        <text x={tooltipX + 12} y={tooltipY + 73} fill="white" fontSize={isEstimatedTooltip ? '13' : '14'} fontWeight="bold">{tooltipValueText}</text>
                      </g>
                    );
                  })()}
                </svg>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <LineChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">
                {gaListensMode ? 'Välj program för att visa lyssnartrender' : 'Välj konton och datapunkt för att visa trend'}
              </p>
              <p className="text-sm">
                {selectedAccounts.length === 0
                  ? `Markera minst ett ${gaListensMode ? 'program' : 'konto'} i listan ovan`
                  : loading ? 'Laddar trenddata...' : 'Valda konton är redo'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <GroupCreateDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        source={gaListensMode ? 'ga_listens' : 'posts'}
        availableAccounts={groupDialogAccounts}
        editGroup={null}
        onSave={() => { if (onGroupsChanged) onGroupsChanged(); }}
      />
    </div>
  );
};

export default TrendAnalysisView;
