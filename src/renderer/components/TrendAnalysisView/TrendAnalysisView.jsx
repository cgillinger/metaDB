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
  Check,
  Search,
  X,
} from 'lucide-react';
import { api } from '@/utils/apiClient';
import { breakpointIndex, ghostRuns, distinctBreakpointIndexes } from './splicedLine.js';
import { daysInMonth } from '@/utils/dateHelpers';
import { calculateNiceYAxis } from '@/utils/chartAxis';
import GroupCreateDialog from '../AccountGroups/GroupCreateDialog';
import {
  YOY_MONTH_AXIS,
  stripCurrentMonth,
  deriveYears,
  defaultSelectedYears,
  buildYoYLines,
  yearLabel,
} from './yearOverYear';

// Metrics whose data shape (value/lower/quality bands) isn't supported in YoY mode.
const YOY_UNSUPPORTED_METRICS = new Set(['estimated_unique_clicks', 'account_viewers_spliced']);

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

const METRIC_CATEGORIES = [
  {
    label: 'RÄCKVIDD & VISNINGAR',
    metrics: [
      { key: 'views', label: 'Visningar' },
      { key: 'average_reach', label: 'Räckvidd (genomsnitt)' },
      { key: 'account_viewers', label: 'Unika tittare (API)', platform: 'facebook' },
      { key: 'account_viewers_spliced', label: 'Unika tittare & Kontoräckvidd (API, skarvad)', platform: 'facebook' },
      { key: 'account_reach', label: 'Kontoräckvidd (API, äldre mått)', platform: 'facebook' },
      { key: 'ig_account_reach', label: 'Unika tittare (API)', platform: 'instagram' },
      { key: 'follows', label: 'Följare', platform: 'instagram' },
    ],
  },
  {
    label: 'ENGAGEMANG',
    metrics: [
      { key: 'engagement', label: 'Totalt engagemang' },
      { key: 'interactions', label: 'Interaktioner (gilla+komm+dela)' },
      { key: 'likes', label: 'Gilla-markeringar / Reaktioner' },
      { key: 'comments', label: 'Kommentarer' },
      { key: 'shares', label: 'Delningar' },
      { key: 'saves', label: 'Sparade', platform: 'instagram' },
    ],
  },
  {
    label: 'KLICK',
    metrics: [
      { key: 'total_clicks', label: 'Totalt antal klick', platform: 'facebook' },
      { key: 'link_clicks', label: 'Länkklick', platform: 'facebook' },
      { key: 'avg_daily_link_clicks', label: 'Länkklick snitt/dag', platform: 'facebook' },
      { key: 'other_clicks', label: 'Övriga klick', platform: 'facebook' },
      { key: 'estimated_unique_clicks', label: 'Uppsk. unika länkklickare', platform: 'facebook' },
    ],
  },
  {
    label: 'PUBLICERING',
    metrics: [
      { key: 'post_count', label: 'Antal publiceringar' },
      { key: 'posts_per_day', label: 'Publiceringar per dag' },
    ],
  },
];

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
const TREND_METRICS_FB = { 'account_viewers': 'Unika tittare (API) FB', 'account_viewers_spliced': 'Unika tittare & Kontoräckvidd (API, skarvad) FB', 'account_reach': 'Kontoräckvidd (API, äldre mått) FB', 'total_clicks': 'Totalt antal klick', 'link_clicks': 'Länkklick', 'avg_daily_link_clicks': 'Länkklick snitt/dag', 'other_clicks': 'Övriga klick', 'estimated_unique_clicks': 'Uppsk. unika länkklickare' };
const TREND_METRICS_IG = { 'ig_account_reach': 'Unika tittare (API) IG', 'saves': 'Sparade', 'follows': 'Följare' };

const CHART_COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C'
];

// Metrics that cannot be meaningfully summed across accounts in a group
const NON_SUMMABLE_METRICS = new Set([
  'reach', 'average_reach', 'account_reach', 'account_viewers', 'account_viewers_spliced', 'ig_account_reach', 'posts_per_day', 'estimated_unique_clicks',
]);

// När TikTok är aktiv plattform saknar dessa mått data i TikTok-exporterna och
// döljs ur datapunkt-väljaren (jfr TIKTOK_UNAVAILABLE_FIELDS i MainView).
const TIKTOK_UNAVAILABLE_METRICS = new Set([
  'average_reach', 'account_reach', 'account_viewers', 'account_viewers_spliced', 'ig_account_reach', 'follows',
  'total_clicks', 'link_clicks', 'avg_daily_link_clicks', 'other_clicks', 'estimated_unique_clicks',
]);

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

// Composite key for unique account identification across platforms
const accountKey = (name, platform) => `${name}::${platform}`;
const parseAccountKey = (key) => {
  const idx = key.lastIndexOf('::');
  return { name: key.slice(0, idx), platform: key.slice(idx + 2) };
};

// Search normalisation for the account picker. Lowercase only — å/ä/ö are distinct
// letters in Swedish, so folding diacritics would make "mal" match "Mål".
const normalizeSearch = (s) => (s || '').trim().toLocaleLowerCase('sv-SE');

const createSmoothPath = (points) => {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  // Clamp Bézier control points to the baseline (the lowest point on screen = largest
  // y, since value 0 maps to the chart bottom). A cubic segment stays inside the convex
  // hull of its 4 points, so when every anchor AND control point has y <= yFloor the
  // rendered curve can never dip below the baseline — no sub-zero undershoot between a
  // zero point and the next spike. Values can't be negative, so this only removes a
  // misleading visual artefact; data is untouched.
  const yFloor = Math.max(...points.map(p => p.y));
  const clampY = (y) => Math.min(y, yFloor);
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const current = points[i], previous = points[i - 1];
    let c1x, c1y, c2x, c2y;
    if (i === 1) {
      const next = points[i + 1] || current;
      c1x = previous.x + (current.x - previous.x) * 0.3; c1y = previous.y + (current.y - previous.y) * 0.3;
      c2x = current.x - (next.x - previous.x) * 0.1;     c2y = current.y - (next.y - previous.y) * 0.1;
    } else if (i === points.length - 1) {
      const beforePrev = points[i - 2] || previous;
      c1x = previous.x + (current.x - beforePrev.x) * 0.1; c1y = previous.y + (current.y - beforePrev.y) * 0.1;
      c2x = current.x - (current.x - previous.x) * 0.3;    c2y = current.y - (current.y - previous.y) * 0.3;
    } else {
      const next = points[i + 1], beforePrev = points[i - 2] || previous;
      c1x = previous.x + (current.x - beforePrev.x) * 0.1; c1y = previous.y + (current.y - beforePrev.y) * 0.1;
      c2x = current.x - (next.x - previous.x) * 0.1;       c2y = current.y - (next.y - previous.y) * 0.1;
    }
    path += ` C ${c1x} ${clampY(c1y)}, ${c2x} ${clampY(c2y)}, ${current.x} ${current.y}`;
  }
  return path;
};

const getMonthName = (month) => MONTH_NAMES_SV[month - 1] || String(month);

const TrendAnalysisView = ({
  platform,
  periodParams = {},
  gaListensMode = false,
  gaSiteVisitsMode = false,
  accountGroups = [],
  onGroupsChanged = null,
  onPlatformChange = null,
}) => {
  const [selectedMetric, setSelectedMetric] = useState('interactions');
  // selectedAccounts stores composite keys: "account_name::platform" or "__group__<id>"
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [groupNotice, setGroupNotice] = useState(null);
  // Free-text filter over the account picker. Purely visual — never touches selectedAccounts.
  const [accountSearch, setAccountSearch] = useState('');
  // Ghost shadow of the older measure during the overlap. On by default; once viewers is
  // backfilled the overlap spans many months and the shadow becomes a second full line.
  const [showGhostShadow, setShowGhostShadow] = useState(true);

  const [accountList, setAccountList] = useState([]);
  const [igReachAccountNames, setIgReachAccountNames] = useState(new Set());
  const [fbReachAccountNames, setFbReachAccountNames] = useState(new Set());
  const [fbViewersAccountNames, setFbViewersAccountNames] = useState(new Set());
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Year-over-year (YoY) state. In YoY mode the x-axis collapses to Jan–Dec and
  // each calendar year becomes its own line. Works on one account at a time and
  // ignores the global period filter — it always uses the full history.
  const [viewMode, setViewMode] = useState('linear'); // 'linear' | 'yoy'
  const [yoyDataMap, setYoyDataMap] = useState(null);  // { 'YYYY-MM': value } full history, single series
  const [yoyLoading, setYoyLoading] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]); // number[] of selected calendar years

  // GA Listens state — populated only when gaListensMode is true
  const [gaRawData, setGaRawData] = useState([]);       // flat rows from API
  const [gaAccountList, setGaAccountList] = useState([]); // sorted account objects
  const [gaMetric, setGaMetric] = useState('listens'); // 'listens' | 'avg_daily_listens'

  // GA Site Visits state — populated only when gaSiteVisitsMode is true
  const [gsvRawData, setGsvRawData] = useState([]);
  const [gsvAccountList, setGsvAccountList] = useState([]);
  const [gsvMetric, setGsvMetric] = useState('visits'); // 'visits' | 'avg_daily_visits'

  // Group create dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupDialogAccounts, setGroupDialogAccounts] = useState([]);

  // Clear selection and trend data when switching between modes
  useEffect(() => {
    setSelectedAccounts([]);
    setTrendData(null);
    setViewMode('linear');
    setYoyDataMap(null);
    setAccountSearch('');
  }, [gaListensMode, gaSiteVisitsMode]);

  const isYoY = viewMode === 'yoy';
  // YoY works one series at a time → the single selected account/group key, or null.
  const yoyKey = selectedAccounts.length === 1 ? selectedAccounts[0] : null;
  // YoY can't render the estimated-clicks band shape.
  const yoyUnsupported = isYoY && !gaListensMode && !gaSiteVisitsMode && YOY_UNSUPPORTED_METRICS.has(selectedMetric);

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

  // Inject GSV groups into the GSV account list
  const gsvAccountListWithGroups = useMemo(() => {
    const gsvNames = new Set(gsvAccountList.map(a => a.account_name));
    const gsvGroups = accountGroups
      .filter(g => g.source === 'ga_site_visits')
      .map(g => {
        const memberNames = g.members.map(k => k.split('::')[0]);
        const matchedCount = memberNames.filter(n => gsvNames.has(n)).length;
        return {
          account_name: g.name,
          platform: 'ga_site_visits',
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
    const sortedGsvList = [...gsvAccountList].sort((a, b) =>
      (a.account_name || '').localeCompare((b.account_name || ''), 'sv')
    );
    return [...gsvGroups, ...sortedGsvList];
  }, [accountGroups, gsvAccountList]);

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
    if (!gaListensMode && !gaSiteVisitsMode && hasGroupSelected && NON_SUMMABLE_METRICS.has(selectedMetric)) {
      setSelectedMetric('interactions');
      setGroupNotice('Räckvidd kan inte aggregeras för kontogrupper. Bytte till Interaktioner.');
    }
  }, [gaListensMode, gaSiteVisitsMode, hasGroupSelected, selectedMetric]);

  useEffect(() => {
    if (!groupNotice) return;
    const t = setTimeout(() => setGroupNotice(null), 4000);
    return () => clearTimeout(t);
  }, [groupNotice]);

  // Fetch account list (posts mode only)
  useEffect(() => {
    if (gaListensMode || gaSiteVisitsMode) return;
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
        setIgReachAccountNames(new Set(Object.keys(data.igReachByAccount || {})));
        setFbReachAccountNames(new Set(Object.keys(data.reachByAccount || {})));
        setFbViewersAccountNames(new Set(Object.keys(data.viewersByAccount || {})));
      } catch (error) {
        console.error('Fel vid hämtning av konton:', error);
      }
    };
    fetchAccounts();
  }, [gaListensMode, gaSiteVisitsMode, platform, periodParams]);

  // Fetch trend data when metric or accounts change (posts mode only)
  useEffect(() => {
    if (gaListensMode || gaSiteVisitsMode) return;
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

        const backendMetric = selectedMetric === 'avg_daily_link_clicks' ? 'link_clicks' : selectedMetric;
        const params = {
          metric: backendMetric,
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
  }, [gaListensMode, gaSiteVisitsMode, selectedMetric, selectedAccounts, platform, periodParams, accountListWithGroups]);

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
        // Spliced series carry objects, not numbers — summing them would yield NaN.
        // Groups are already blocked via NON_SUMMABLE_METRICS; this is belt and braces.
        if (selectedMetric === 'account_viewers_spliced') return null;
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
          memberCount: entry.memberCount,
          matchedCount: entry.matchedCount,
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
      const isSplicedMetric = selectedMetric === 'account_viewers_spliced';
      return {
        key: selectedKey,
        account_name: series.account_name,
        platform: series.platform,
        is_collab: series.is_collab || false,
        _isGroup: false,
        breakpointMonth: series.breakpoint_month ?? null,
        spliceStatus: series.splice_status ?? null,
        color: CHART_COLORS[colorIndex++ % CHART_COLORS.length],
        points: trendData.months.map((monthKey, mIndex) => {
          if (isSplicedMetric) {
            const datum = series.data[mIndex];
            return {
              month: monthKey,
              value: datum?.value ?? null,
              source: datum?.source ?? null,
              ghost: datum?.ghost ?? null,
            };
          }
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

    if (selectedMetric === 'avg_daily_link_clicks') {
      return {
        months: trendData.months,
        chartLines: lines.map(line => ({
          ...line,
          points: line.points.map(p => ({
            ...p,
            value: p.value != null
              ? Math.round((p.value / daysInMonth(p.month)) * 10) / 10
              : null,
          })),
        })),
      };
    }

    return { months: trendData.months, chartLines: lines };
  }, [trendData, selectedAccounts, accountListWithGroups, selectedMetric]);

  const yAxisConfig = useMemo(() => {
    if (chartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    // Ghost values are drawn too — leaving them out can push the shadow above the top gridline.
    const allValues = chartLines.flatMap(line =>
      line.points.flatMap(p => [p.value, p.ghost]).filter(v => v !== null && v !== undefined));
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
    const lines = selectedAccounts.map((key, index) => {
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
          memberCount: entry.memberCount,
          matchedCount: entry.matchedCount,
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

    if (gaMetric === 'avg_daily_listens') {
      return lines.map(line => ({
        ...line,
        points: line.points.map(p => ({
          ...p,
          value: Math.round((p.value / daysInMonth(p.month)) * 10) / 10,
        })),
      }));
    }
    return lines;
  }, [gaListensMode, selectedAccounts, gaPivot, gaMonths, gaAccountListWithGroups, gaMetric]);

  const gaYAxisConfig = useMemo(() => {
    if (gaChartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = gaChartLines.flatMap(line => line.points.map(p => p.value));
    return calculateNiceYAxis(Math.max(...allValues));
  }, [gaChartLines]);

  // Fetch GA site visits data and build sorted account list
  useEffect(() => {
    if (!gaSiteVisitsMode) {
      setGsvRawData([]);
      setGsvAccountList([]);
      return;
    }

    const fetchGSVData = async () => {
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim())
          : null;
        const result = await api.getGASiteVisits(months);
        const rows = result.data || [];
        setGsvRawData(rows);

        const names = [...new Set(rows.map(r => r.account_name))].sort(sortGAPrograms);
        setGsvAccountList(names.map(name => ({
          account_name: name,
          platform: 'ga_site_visits',
          is_collab: false,
          key: accountKey(name, 'ga_site_visits'),
        })));
      } catch (err) {
        console.error('Fel vid hämtning av sajtbesök:', err);
      }
    };
    fetchGSVData();
  }, [gaSiteVisitsMode, periodParams]);

  // GSV pivot: { account_name → { 'YYYY-MM' → visits } }
  const gsvPivot = useMemo(() => {
    if (!gaSiteVisitsMode) return {};
    const map = {};
    for (const row of gsvRawData) {
      if (!map[row.account_name]) map[row.account_name] = {};
      map[row.account_name][row.month] = row.visits;
    }
    return map;
  }, [gaSiteVisitsMode, gsvRawData]);

  // Month span for GSV chart x-axis
  const gsvMonths = useMemo(() => {
    if (!gaSiteVisitsMode) return [];
    if (periodParams.months) {
      return periodParams.months.split(',').map(m => m.trim()).filter(Boolean).sort();
    }
    return [...new Set(gsvRawData.map(r => r.month))].sort();
  }, [gaSiteVisitsMode, gsvRawData, periodParams]);

  // GSV chart lines — SBS-safe: uses const lines, NOT return before avg transform
  const gsvChartLines = useMemo(() => {
    if (!gaSiteVisitsMode || selectedAccounts.length === 0) return [];

    const lines = selectedAccounts.map((key, index) => {
      // Group key: sum member values per month
      if (key.startsWith('__group__')) {
        const entry = gsvAccountListWithGroups.find(a => a.key === key);
        if (!entry) return null;

        const memberNames = entry.memberKeys.map(k => k.split('::')[0]);
        const points = gsvMonths.map(month => {
          const value = memberNames.reduce((sum, name) => {
            return sum + (gsvPivot[name]?.[month] ?? 0);
          }, 0);
          return { month, value };
        });

        return {
          key,
          account_name: entry.account_name,
          platform: 'ga_site_visits',
          is_collab: false,
          _isGroup: true,
          memberCount: entry.memberCount,
          matchedCount: entry.matchedCount,
          color: CHART_COLORS[index % CHART_COLORS.length],
          points,
        };
      }

      // Individual account
      const entry = gsvAccountList.find(a => a.key === key);
      if (!entry) return null;

      const data = gsvPivot[entry.account_name] || {};
      return {
        key,
        account_name: entry.account_name,
        platform: 'ga_site_visits',
        is_collab: false,
        _isGroup: false,
        color: CHART_COLORS[index % CHART_COLORS.length],
        points: gsvMonths.map(month => ({ month, value: data[month] ?? 0 })),
      };
    }).filter(Boolean);

    // Apply avg_daily transform AFTER aggregation (critical for group correctness)
    if (gsvMetric === 'avg_daily_visits') {
      return lines.map(line => ({
        ...line,
        points: line.points.map(p => ({
          ...p,
          value: Math.round((p.value / daysInMonth(p.month)) * 10) / 10,
        })),
      }));
    }
    return lines;
  }, [gaSiteVisitsMode, selectedAccounts, gsvPivot, gsvMonths, gsvAccountListWithGroups, gsvAccountList, gsvMetric]);

  const gsvYAxisConfig = useMemo(() => {
    if (gsvChartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = gsvChartLines.flatMap(line => line.points.map(p => p.value));
    return calculateNiceYAxis(Math.max(...allValues));
  }, [gsvChartLines]);

  // --- Year-over-year (YoY) -------------------------------------------------
  // Fetch the FULL history for the single selected series (ignores periodParams),
  // collapsed into a { 'YYYY-MM': value } map. Months absent from the map render
  // as gaps; interior zeros from the backend stay on the baseline.
  useEffect(() => {
    if (!isYoY || !yoyKey || yoyUnsupported) {
      setYoyDataMap(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setYoyLoading(true);
      try {
        const dataMap = {};
        if (gaListensMode) {
          const result = await api.getGAListens(null);
          const entry = gaAccountListWithGroups.find(a => a.key === yoyKey);
          const names = entry?._isGroup
            ? new Set(entry.memberKeys.map(k => k.split('::')[0]))
            : new Set([parseAccountKey(yoyKey).name]);
          for (const r of (result.data || [])) {
            if (names.has(r.account_name)) dataMap[r.month] = (dataMap[r.month] || 0) + r.listens;
          }
          if (gaMetric === 'avg_daily_listens') {
            for (const m of Object.keys(dataMap)) dataMap[m] = Math.round((dataMap[m] / daysInMonth(m)) * 10) / 10;
          }
        } else if (gaSiteVisitsMode) {
          const result = await api.getGASiteVisits(null);
          const entry = gsvAccountListWithGroups.find(a => a.key === yoyKey);
          const names = entry?._isGroup
            ? new Set(entry.memberKeys.map(k => k.split('::')[0]))
            : new Set([parseAccountKey(yoyKey).name]);
          for (const r of (result.data || [])) {
            if (names.has(r.account_name)) dataMap[r.month] = (dataMap[r.month] || 0) + r.visits;
          }
          if (gsvMetric === 'avg_daily_visits') {
            for (const m of Object.keys(dataMap)) dataMap[m] = Math.round((dataMap[m] / daysInMonth(m)) * 10) / 10;
          }
        } else {
          const entry = accountListWithGroups.find(a => a.key === yoyKey);
          const memberKeys = entry?._isGroup ? entry.memberKeys : [yoyKey];
          const uniqueKeys = [...new Set(memberKeys)];
          if (uniqueKeys.length === 0) { if (!cancelled) setYoyDataMap({}); return; }
          const backendMetric = selectedMetric === 'avg_daily_link_clicks' ? 'link_clicks' : selectedMetric;
          const params = { metric: backendMetric, accountKeys: uniqueKeys.join('||'), granularity: 'month' };
          if (platform) params.platform = platform;
          const data = await api.getTrends(params);
          const fetchedMonths = data.months || [];
          for (let i = 0; i < fetchedMonths.length; i++) {
            let sum = 0;
            for (const s of (data.series || [])) sum += (s.data[i] || 0);
            dataMap[fetchedMonths[i]] = sum;
          }
          if (selectedMetric === 'avg_daily_link_clicks') {
            for (const m of Object.keys(dataMap)) dataMap[m] = Math.round((dataMap[m] / daysInMonth(m)) * 10) / 10;
          }
        }
        if (!cancelled) setYoyDataMap(dataMap);
      } catch (err) {
        console.error('Fel vid hämtning av år-över-år-data:', err);
        if (!cancelled) setYoyDataMap(null);
      } finally {
        if (!cancelled) setYoyLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [isYoY, yoyKey, yoyUnsupported, gaListensMode, gaSiteVisitsMode, selectedMetric, gaMetric, gsvMetric, platform, accountListWithGroups, gaAccountListWithGroups, gsvAccountListWithGroups]);

  // Exclude the in-progress current month: it's never complete and (with Meta's
  // US/Pacific CSV timestamps) is dominated by spillover from the previous month,
  // which otherwise renders as a misleading crash toward zero at the line's end.
  const yoyEffectiveDataMap = useMemo(
    () => (isYoY && yoyDataMap ? stripCurrentMonth(yoyDataMap) : yoyDataMap),
    [isYoY, yoyDataMap]
  );

  const yoyYearInfos = useMemo(
    () => (isYoY && yoyEffectiveDataMap ? deriveYears(yoyEffectiveDataMap) : []),
    [isYoY, yoyEffectiveDataMap]
  );

  // Reset the year selection to a sensible default whenever the candidate set changes.
  useEffect(() => {
    if (!isYoY) return;
    setSelectedYears(defaultSelectedYears(yoyYearInfos));
  }, [isYoY, yoyYearInfos]);

  const yoyChartLines = useMemo(
    () => (isYoY && yoyEffectiveDataMap ? buildYoYLines(yoyEffectiveDataMap, yoyYearInfos, new Set(selectedYears), CHART_COLORS) : []),
    [isYoY, yoyEffectiveDataMap, yoyYearInfos, selectedYears]
  );

  const yoyYAxisConfig = useMemo(() => {
    const allValues = yoyChartLines.flatMap(line =>
      line.points.map(p => p.value).filter(v => v !== null && v !== undefined)
    );
    if (allValues.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    return calculateNiceYAxis(Math.max(...allValues));
  }, [yoyChartLines]);

  // Name of the account/group being analysed in YoY (legend shows years, not the account).
  const yoyAccountName = useMemo(() => {
    if (!isYoY || !yoyKey) return null;
    const list = gaSiteVisitsMode ? gsvAccountListWithGroups : gaListensMode ? gaAccountListWithGroups : accountListWithGroups;
    const e = list.find(a => a.key === yoyKey);
    return e ? e.account_name : parseAccountKey(yoyKey).name;
  }, [isYoY, yoyKey, gaListensMode, gaSiteVisitsMode, gaAccountListWithGroups, gsvAccountListWithGroups, accountListWithGroups]);

  // Color index for a year's selection pill — matches buildYoYLines (chronological order among selected).
  const yoyColorIndex = (year) =>
    yoyYearInfos.filter(y => selectedYears.includes(y.year)).map(y => y.year).indexOf(year);

  const toggleYear = (year) => {
    setSelectedYears(prev => prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year]);
  };

  // Transparent switchers so the SVG chart render logic below needs no branching.
  const displayMonths = isYoY ? YOY_MONTH_AXIS : gaSiteVisitsMode ? gsvMonths : gaListensMode ? gaMonths : months;
  const displayChartLines = isYoY ? yoyChartLines : gaSiteVisitsMode ? gsvChartLines : gaListensMode ? gaChartLines : chartLines;
  const displayYAxisConfig = isYoY ? yoyYAxisConfig : gaSiteVisitsMode ? gsvYAxisConfig : gaListensMode ? gaYAxisConfig : yAxisConfig;

  // Filter account list based on selected metric (account_reach = FB only, ig_account_reach = IG only)
  // Groups are always kept in the list regardless of metric filter
  const filteredAccountList = useMemo(() => {
    // Spliced metric spans both FB tables → an account qualifies if it appears in either.
    if (selectedMetric === 'account_viewers_spliced') {
      return accountListWithGroups.filter(a =>
        a._isGroup || (a.platform === 'facebook' &&
          (fbReachAccountNames.has(a.account_name) || fbViewersAccountNames.has(a.account_name)))
      );
    }
    if (selectedMetric === 'account_reach' || selectedMetric === 'estimated_unique_clicks') {
      return accountListWithGroups.filter(a =>
        a._isGroup || (a.platform === 'facebook' && fbReachAccountNames.has(a.account_name))
      );
    }
    if (selectedMetric === 'account_viewers') {
      return accountListWithGroups.filter(a =>
        a._isGroup || (a.platform === 'facebook' && fbViewersAccountNames.has(a.account_name))
      );
    }
    if (selectedMetric === 'ig_account_reach') {
      return accountListWithGroups.filter(a =>
        a._isGroup || (a.platform === 'instagram' && igReachAccountNames.has(a.account_name))
      );
    }
    return accountListWithGroups;
  }, [accountListWithGroups, selectedMetric, igReachAccountNames, fbReachAccountNames, fbViewersAccountNames]);

  // When metric changes to a platform-specific metric, remove incompatible accounts from selection
  useEffect(() => {
    if (!gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers_spliced') {
      const splicedKeys = new Set(
        accountListWithGroups
          .filter(a => a._isGroup || (a.platform === 'facebook' &&
            (fbReachAccountNames.has(a.account_name) || fbViewersAccountNames.has(a.account_name))))
          .map(a => a.key)
      );
      setSelectedAccounts(prev => prev.filter(k => splicedKeys.has(k)));
    }
    if (!gaListensMode && !gaSiteVisitsMode && (selectedMetric === 'account_reach' || selectedMetric === 'estimated_unique_clicks')) {
      const fbKeys = new Set(
        accountListWithGroups
          .filter(a => a._isGroup || (a.platform === 'facebook' && fbReachAccountNames.has(a.account_name)))
          .map(a => a.key)
      );
      setSelectedAccounts(prev => prev.filter(k => fbKeys.has(k)));
    }
    if (!gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers') {
      const fbvKeys = new Set(
        accountListWithGroups
          .filter(a => a._isGroup || (a.platform === 'facebook' && fbViewersAccountNames.has(a.account_name)))
          .map(a => a.key)
      );
      setSelectedAccounts(prev => prev.filter(k => fbvKeys.has(k)));
    }
    if (!gaListensMode && !gaSiteVisitsMode && selectedMetric === 'ig_account_reach') {
      const igKeys = new Set(
        accountListWithGroups
          .filter(a => a._isGroup || (a.platform === 'instagram' && igReachAccountNames.has(a.account_name)))
          .map(a => a.key)
      );
      setSelectedAccounts(prev => prev.filter(k => igKeys.has(k)));
    }
  }, [gaListensMode, gaSiteVisitsMode, selectedMetric, accountListWithGroups, igReachAccountNames, fbReachAccountNames, fbViewersAccountNames]);

  // Accounts whose spliced series never reaches the new measure — usually a name change
  // in the source, since the two tables are matched on account_name.
  const splicedLegacyOnlyCount = useMemo(() => {
    if (selectedMetric !== 'account_viewers_spliced') return 0;
    return chartLines.filter(l => l.spliceStatus === 'legacy_only').length;
  }, [selectedMetric, chartLines]);

  // Final display account list
  const activeAccountList = gaSiteVisitsMode
    ? gsvAccountListWithGroups
    : gaListensMode ? gaAccountListWithGroups : filteredAccountList;

  // Search-filtered view of the picker. Groups match on their own name, like accounts.
  // Only the rendered list is filtered — selectedAccounts and the chart are untouched,
  // so a search never removes a drawn line.
  const accountSearchQuery = normalizeSearch(accountSearch);
  const visibleAccountList = useMemo(() => {
    if (!accountSearchQuery) return activeAccountList;
    return activeAccountList.filter(a => normalizeSearch(a.account_name).includes(accountSearchQuery));
  }, [activeAccountList, accountSearchQuery]);

  const visibleSelectableKeys = useMemo(
    () => visibleAccountList.filter(a => !a.disabled).map(a => a.key),
    [visibleAccountList]
  );

  // Selected accounts that the current search hides — surfaced so the count in the
  // label ("N valda") never looks wrong against a shorter list.
  const hiddenSelectedCount = useMemo(() => {
    if (!accountSearchQuery) return 0;
    const visible = new Set(visibleAccountList.map(a => a.key));
    return selectedAccounts.filter(k => !visible.has(k)).length;
  }, [accountSearchQuery, visibleAccountList, selectedAccounts]);

  const handleAccountToggle = (key) => {
    // YoY shows one series at a time → selecting an account replaces the selection.
    if (isYoY) {
      setSelectedAccounts(current => (current.length === 1 && current[0] === key) ? current : [key]);
      return;
    }
    setSelectedAccounts(current =>
      current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    );
  };

  const handleViewModeChange = (mode) => {
    // Entering YoY: keep at most one selected account (one series at a time).
    if (mode === 'yoy' && selectedAccounts.length > 1) {
      setSelectedAccounts(selectedAccounts.slice(0, 1));
    }
    setViewMode(mode);
  };

  // Select-all acts on the search hits only, matching GroupCreateDialog's picker.
  // Selections outside the current search are preserved in both directions.
  const allAccountsSelected = visibleSelectableKeys.length > 0
    && visibleSelectableKeys.every(k => selectedAccounts.includes(k));

  const handleToggleAllAccounts = () => {
    const visible = new Set(visibleSelectableKeys);
    setSelectedAccounts(current =>
      allAccountsSelected
        ? current.filter(k => !visible.has(k))
        : [...new Set([...current, ...visibleSelectableKeys])]
    );
  };

  const handleMouseMove = (event, point) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    setHoveredDataPoint(point);
  };

  const showChart = isYoY
    ? (!!yoyKey && !yoyUnsupported && yoyYearInfos.length >= 2 && yoyChartLines.length > 0)
    : gaSiteVisitsMode
      ? (gsvChartLines.length > 0 && gsvMonths.length > 0)
      : gaListensMode
        ? (gaChartLines.length > 0 && gaMonths.length > 0)
        : (chartLines.length > 0 && months.length > 0);

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
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2"><LineChart className="h-5 w-5" />Trendanalys över tid</CardTitle>
          {/* View mode: linear timeline vs year-over-year overlay */}
          <div className="inline-flex rounded-md border overflow-hidden">
            {[
              { value: 'linear', label: 'Linjärt' },
              { value: 'yoy', label: 'År över år' },
            ].map((opt, i) => (
              <button
                key={opt.value}
                onClick={() => handleViewModeChange(opt.value)}
                className={`px-3 py-1.5 text-sm transition-colors ${i > 0 ? 'border-l' : ''} ${
                  viewMode === opt.value
                    ? 'bg-blue-50 text-blue-800 font-medium'
                    : 'bg-white text-muted-foreground hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Account / program selector */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-medium">
                  {(gaListensMode || gaSiteVisitsMode) ? 'Välj program' : 'Välj konton'}
                  {isYoY ? '' : ` (${selectedAccounts.length} valda)`}
                </Label>
                {!isYoY && visibleSelectableKeys.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleToggleAllAccounts}
                    title={accountSearchQuery ? 'Gäller bara sökträffarna. Val utanför sökningen behålls.' : undefined}
                  >
                    {accountSearchQuery
                      ? (allAccountsSelected ? 'Avmarkera träffarna' : 'Välj alla träffar')
                      : (allAccountsSelected ? 'Avmarkera alla' : 'Välj alla')}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2 mb-2 rounded-md border bg-white px-2">
                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setAccountSearch(''); }}
                  placeholder={(gaListensMode || gaSiteVisitsMode) ? 'Sök program…' : 'Sök konto…'}
                  aria-label={(gaListensMode || gaSiteVisitsMode) ? 'Sök program' : 'Sök konto'}
                  className="w-full py-2 text-sm outline-none bg-transparent"
                />
                {accountSearch && (
                  <button
                    type="button"
                    onClick={() => setAccountSearch('')}
                    aria-label="Rensa sökning"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {hiddenSelectedCount > 0 && (
                <p className="mb-2 text-xs text-muted-foreground">
                  {hiddenSelectedCount} valda döljs av sökningen.{' '}
                  <button type="button" onClick={() => setAccountSearch('')} className="underline hover:text-foreground">
                    Visa alla
                  </button>
                </p>
              )}
              <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2 bg-gray-50">
                {visibleAccountList.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">
                    Inga {(gaListensMode || gaSiteVisitsMode) ? 'program' : 'konton'} matchar ”{accountSearch}”.
                  </p>
                )}
                {visibleAccountList.map((account, idx) => {
                  const isGroup = account._isGroup;
                  const prevIsGroup = idx > 0 && visibleAccountList[idx - 1]._isGroup;
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
                              <PlatformBadge platform={account.platform === 'ga_listens' || account.platform === 'ga_site_visits' ? 'google_analytics' : account.platform} />
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
                  setGroupDialogAccounts(
                    gaSiteVisitsMode ? gsvAccountList
                    : gaListensMode ? gaAccountList
                    : accountList
                  );
                  setGroupDialogOpen(true);
                }}
                className="mt-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Users className="w-3.5 h-3.5" />
                Skapa kontogrupp
              </button>
              {isYoY && (
                <p className="mt-2 text-xs text-muted-foreground">
                  År över år visar ett {(gaListensMode || gaSiteVisitsMode) ? 'program' : 'konto'} i taget.
                  Periodvalet ignoreras – hela historiken används.
                </p>
              )}
            </div>

            {/* Metric selector */}
            {(gaListensMode || gaSiteVisitsMode) ? (
              <div>
                <Label className="text-base font-medium mb-3 block">Datapunkt</Label>
                <div className="space-y-2 border rounded-md p-3 bg-gray-50">
                  {[
                    { key: 'listens',           label: 'Lyssningar',            source: 'ga_listens'     },
                    { key: 'avg_daily_listens', label: 'Lyssningar snitt/dag',  source: 'ga_listens'     },
                    { key: 'visits',            label: 'Besök',                 source: 'ga_site_visits' },
                    { key: 'avg_daily_visits',  label: 'Besök snitt/dag',       source: 'ga_site_visits' },
                  ].map(({ key, label, source }) => {
                    const isActive =
                      (source === 'ga_listens'     && gaListensMode    && gaMetric  === key) ||
                      (source === 'ga_site_visits' && gaSiteVisitsMode && gsvMetric === key);
                    return (
                      <Label key={key} className="flex items-center gap-2 p-1 rounded cursor-pointer hover:bg-white">
                        <input
                          type="radio"
                          name="gaMetric"
                          checked={isActive}
                          onChange={() => {
                            if (source === 'ga_listens') {
                              setGaMetric(key);
                              if (!gaListensMode) onPlatformChange?.('ga_listens');
                            } else {
                              setGsvMetric(key);
                              if (!gaSiteVisitsMode) onPlatformChange?.('ga_site_visits');
                            }
                          }}
                          className="h-4 w-4 accent-blue-600"
                        />
                        <span className="text-sm flex items-center gap-1.5 font-medium">
                          <PlatformBadge platform="google_analytics" />
                          {label}
                        </span>
                      </Label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-base font-medium mb-3 block">Välj datapunkt att analysera</Label>
                <div className="space-y-3 max-h-64 overflow-y-auto border rounded-md p-3 bg-gray-50">
                  {METRIC_CATEGORIES.map(category => {
                    const visibleMetrics = category.metrics.filter(m => {
                      if (platform === 'tiktok' && TIKTOK_UNAVAILABLE_METRICS.has(m.key)) return false;
                      if (m.platform === 'facebook' && !hasFacebook) return false;
                      if (m.platform === 'instagram' && !hasInstagram) return false;
                      return true;
                    });
                    if (visibleMetrics.length === 0) return null;
                    return (
                      <div key={category.label}>
                        <p className="text-xs font-semibold text-muted-foreground tracking-wide mb-1 mt-1 uppercase">
                          {category.label}
                        </p>
                        <div className="space-y-1">
                          {visibleMetrics.map(m => {
                            const disabledByGroup = hasGroupSelected && NON_SUMMABLE_METRICS.has(m.key);
                            return (
                              <Label
                                key={m.key}
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
                                  value={m.key}
                                  checked={selectedMetric === m.key}
                                  onChange={() => !disabledByGroup && setSelectedMetric(m.key)}
                                  disabled={disabledByGroup}
                                  className="h-4 w-4 border-gray-300 accent-primary"
                                />
                                <span className="text-sm flex items-center gap-1.5">
                                  {m.label}
                                  {platform !== 'tiktok' && m.platform && <PlatformBadge platform={m.platform} />}
                                </span>
                              </Label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {(gaSiteVisitsMode || gaListensMode || selectedMetric) && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
              <h3 className="text-lg font-bold text-primary">
                Visar: {gaSiteVisitsMode
                  ? (gsvMetric === 'avg_daily_visits' ? 'Besök snitt/dag (GA)' : 'Besök (GA)')
                  : gaListensMode
                    ? (gaMetric === 'avg_daily_listens' ? 'Lyssningar snitt/dag (GA)' : 'Lyssningar (GA)')
                    : availableMetrics[selectedMetric]}
                {isYoY && yoyAccountName ? ` — ${yoyAccountName}` : ''}
              </h3>
              <p className="text-sm text-primary/70 mt-1">
                {isYoY
                  ? 'År över år – varje kalenderår är en egen linje'
                  : `Utveckling över tid för valda ${(gaListensMode || gaSiteVisitsMode) ? 'program' : 'konton'}`}
              </p>
            </div>
          )}

          {/* Year picker (YoY only) — interactive toggles; replaces the legend in YoY */}
          {isYoY && yoyYearInfos.length >= 2 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground mr-1">Visa år:</span>
              {yoyYearInfos.map(yi => {
                const active = selectedYears.includes(yi.year);
                const colorIdx = yoyColorIndex(yi.year);
                return (
                  <button
                    key={yi.year}
                    onClick={() => toggleYear(yi.year)}
                    title="Klicka för att visa eller dölja året"
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                      active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                    style={active && colorIdx >= 0 ? { backgroundColor: CHART_COLORS[colorIdx % CHART_COLORS.length] } : undefined}
                  >
                    {active
                      ? <Check className="w-3 h-3 shrink-0" />
                      : <span className="w-3 h-3 rounded-full border border-current opacity-50 shrink-0" />}
                    {yearLabel(yi)}
                  </button>
                );
              })}
            </div>
          )}

          {groupNotice && (
            <Alert className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{groupNotice}</AlertDescription>
            </Alert>
          )}

          {selectedMetric === 'account_reach' && !gaListensMode && !gaSiteVisitsMode && (
            <Alert className="py-2 border-amber-300 bg-amber-50 text-amber-900">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Äldre mått:</strong> Kontoräckvidd avvecklades av Meta i juni 2026 —
                serien slutar i maj 2026 och fortsätter inte. Ersättaren heter Unika tittare (API).
                Jämför inte nivåerna mellan måtten: de definieras olika (gamla räckvidden räknade
                leverans till skärmen, Unika tittare kräver en faktisk visning), så ett hopp vid
                bytet är metodologiskt — inte en publikförändring.
              </AlertDescription>
            </Alert>
          )}

          {selectedMetric === 'account_viewers' && !gaListensMode && !gaSiteVisitsMode && (
            <Alert className="py-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Unika tittare:</strong> antal unika konton som såg kontots innehåll minst
                en gång under månaden (Metas mått fr.o.m. juni 2026, ersätter Kontoräckvidd).
                Data finns från januari 2026. Månader utan data visas som 0.
              </AlertDescription>
            </Alert>
          )}

          {selectedMetric === 'account_viewers_spliced' && !gaListensMode && !gaSiteVisitsMode && (
            <Alert className="py-2 border-amber-300 bg-amber-50 text-amber-900">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>Skarvad serie — läs som riktning, inte som exakta tal.</strong>{' '}
                Linjen sätter ihop två olika mått för att visa hur många unika personer kontot
                nått över tid. Den bleka streckade delen är Kontoräckvidd (API), Metas gamla mått
                som slutar i maj 2026. Den heldragna delen är Unika tittare (API), det nya måttet.
                Måtten är inte definierade lika: det gamla räknade leverans till skärmen, det nya
                kräver en faktisk visning. Nivåskillnaden vid ”Måttbyte” är därför metodologisk —
                inte en publikförändring. Där båda måtten finns följer linjen Unika tittare, och
                det äldre måttet visas som en tunn prickad skugga så att du ser skillnaden.
                Inga värden är omräknade eller skalade.
                {splicedLegacyOnlyCount > 0 && (
                  <>
                    {' '}<strong>{splicedLegacyOnlyCount} av de valda kontona saknar data i det nya måttet.</strong>{' '}
                    Kontrollera om kontot bytt namn i källan — serierna matchas på kontonamn.
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}

          {showChart ? (
            <div className="space-y-4">
              {/* Legend — hidden in YoY, where the interactive year picker above doubles as the legend */}
              {!isYoY && (
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
                      {line._isGroup && (
                        <span className="text-xs text-muted-foreground font-normal ml-0.5">
                          ({line.matchedCount < line.memberCount
                            ? `${line.matchedCount}/${line.memberCount}`
                            : line.memberCount})
                        </span>
                      )}
                      {!line._isGroup && !line._isYoYYear && <PlatformBadge platform={line.platform === 'ga_listens' || line.platform === 'ga_site_visits' ? 'google_analytics' : line.platform} />}
                      {line.is_collab ? <CollabBadge compact /> : null}
                      {line.spliceStatus === 'legacy_only' && (
                        <span className="text-[10px] uppercase tracking-wide border border-amber-300 bg-amber-50 text-amber-700 rounded px-1 shrink-0">
                          endast äldre mått
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              )}

              {/* What the two line styles mean. Colour-neutral — each account keeps its own hue. */}
              {!isYoY && !gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers_spliced' && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 4" strokeOpacity="0.45" /></svg>
                    Kontoräckvidd (äldre mått)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" /></svg>
                    Unika tittare (API)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 3" strokeOpacity="0.35" /></svg>
                    Äldre mått under överlappet
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showGhostShadow}
                      onChange={() => setShowGhostShadow(v => !v)}
                      className="h-3.5 w-3.5 accent-blue-600"
                    />
                    Visa äldre mått som skugga
                  </label>
                </div>
              )}

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
                        <text x="65" y={yPos + 4} textAnchor="end" fontSize="14" fill="#6b7280">{tickValue.toLocaleString('sv-SE')}</text>
                      </g>
                    );
                  })}

                  {displayMonths.map((monthKey, index) => {
                    // YoY axis keys are bare month numbers ('01'..'12'); linear keys are 'YYYY-MM'.
                    const month = isYoY ? Number(monthKey) : Number(monthKey.split('-')[1]);
                    const year = isYoY ? null : Number(monthKey.split('-')[0]);
                    const xPos = 70 + (index / Math.max(1, displayMonths.length - 1)) * 860;
                    return (
                      <g key={monthKey}>
                        <line x1={xPos} y1="70" x2={xPos} y2="450" stroke="#d1d5db" strokeWidth="1" />
                        <text x={xPos} y="475" textAnchor="middle" fontSize="14" fill="#6b7280">{getMonthName(month)}</text>
                        {!isYoY && <text x={xPos} y="490" textAnchor="middle" fontSize="12" fill="#9ca3af">{year}</text>}
                      </g>
                    );
                  })}

                  {displayChartLines.map((line, lineIndex) => {
                    if (line.points.length < 1) return null;
                    const isEstimated = !gaListensMode && !gaSiteVisitsMode && selectedMetric === 'estimated_unique_clicks';
                    const isSpliced = !gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers_spliced';
                    // Render null values as gaps (line breaks) in the estimated-clicks metric,
                    // the spliced metric and YoY mode, so missing months don't crash to the baseline.
                    const allowGaps = isEstimated || isYoY || isSpliced;
                    const yRange = displayYAxisConfig.max - displayYAxisConfig.min;
                    const toY = (val) => yRange > 0 ? 450 - ((val - displayYAxisConfig.min) / yRange) * 380 : 450;

                    const pathPoints = line.points.map((point, index) => {
                      const x = 70 + (index / Math.max(1, displayMonths.length - 1)) * 860;
                      if (allowGaps && point.value === null) {
                        return { x, y: null, yLower: null, point };
                      }
                      return {
                        x,
                        y: toY(point.value ?? 0),
                        yLower: isEstimated && point.valueLower !== null ? toY(point.valueLower) : null,
                        ghostY: isSpliced && point.ghost !== null && point.ghost !== undefined ? toY(point.ghost) : null,
                        point,
                      };
                    });

                    const visiblePoints = allowGaps ? pathPoints.filter(p => p.y !== null) : pathPoints;

                    // Spliced line: one smooth path drawn twice and clipped at the breakpoint.
                    // Clipping (rather than splitting the point list) keeps the curve pixel-identical
                    // across the join and leaves createSmoothPath untouched.
                    const bpIndex = isSpliced ? breakpointIndex(displayMonths, line.breakpointMonth) : -1;
                    const xBreak = bpIndex > 0
                      ? 70 + (bpIndex / Math.max(1, displayMonths.length - 1)) * 860
                      : null;
                    const clipId = `splice-${lineIndex}`;
                    const splicedPath = isSpliced && visiblePoints.length > 1
                      ? createSmoothPath(visiblePoints.map(p => ({ x: p.x, y: p.y })))
                      : null;
                    // No breakpoint in view → the whole line is one measure. Style carries the
                    // provenance: faded/dashed when it is all legacy, solid when it is all viewers.
                    const allLegacy = isSpliced && visiblePoints.every(p => p.point.source !== 'viewers');

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
                        {/* Ghost shadow: the older measure during the overlap. Non-interactive —
                            its value is surfaced in the main point's tooltip instead. */}
                        {isSpliced && showGhostShadow && ghostRuns(pathPoints).map((run, runIndex) => (
                          run.length > 1 ? (
                            <path
                              key={`ghost-${runIndex}`}
                              d={createSmoothPath(run.map(p => ({ x: p.x, y: p.ghostY })))}
                              fill="none"
                              stroke={line.color}
                              strokeWidth="1"
                              strokeDasharray="1.5 3"
                              strokeOpacity="0.35"
                              strokeLinecap="round"
                            />
                          ) : (
                            <circle
                              key={`ghost-${runIndex}`}
                              cx={run[0].x} cy={run[0].ghostY} r="2.5"
                              fill="none" stroke={line.color} strokeOpacity="0.35"
                            />
                          )
                        ))}
                        {isSpliced && splicedPath && xBreak !== null && (
                          <>
                            <defs>
                              <clipPath id={`${clipId}-old`}>
                                <rect x="0" y="0" width={xBreak} height="500" />
                              </clipPath>
                              <clipPath id={`${clipId}-new`}>
                                <rect x={xBreak} y="0" width={1000 - xBreak} height="500" />
                              </clipPath>
                            </defs>
                            <path
                              d={splicedPath} fill="none" stroke={line.color} strokeWidth="2.5"
                              strokeDasharray="7 4" strokeOpacity="0.45"
                              strokeLinecap="round" strokeLinejoin="round"
                              clipPath={`url(#${clipId}-old)`}
                            />
                            <path
                              d={splicedPath} fill="none" stroke={line.color} strokeWidth="2.5"
                              strokeLinecap="round" strokeLinejoin="round"
                              clipPath={`url(#${clipId}-new)`}
                            />
                          </>
                        )}
                        {isSpliced && splicedPath && xBreak === null && (
                          <path
                            d={splicedPath} fill="none" stroke={line.color} strokeWidth="2.5"
                            strokeDasharray={allLegacy ? '7 4' : undefined}
                            strokeOpacity={allLegacy ? '0.45' : '1'}
                            strokeLinecap="round" strokeLinejoin="round"
                          />
                        )}
                        {!isSpliced && visiblePoints.length > 1 && (
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
                            fillOpacity={isSpliced && point.source === 'legacy' ? 0.45 : 1}
                            stroke="white"
                            strokeWidth="2"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handleMouseMove(e, { ...point, account_name: line.account_name, platform: line.platform, color: line.color, _isGroup: line._isGroup })}
                          />
                        ))}
                      </g>
                    );
                  })}

                  {/* Measure-switch markers. The breakpoint is per account, so several can
                      coexist; only the earliest is labelled to avoid a thicket of text. */}
                  {!gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers_spliced' && !isYoY &&
                    distinctBreakpointIndexes(displayChartLines, displayMonths).map((i, n) => {
                      const x = 70 + (i / Math.max(1, displayMonths.length - 1)) * 860;
                      const right = x > 800;
                      return (
                        <g key={`bp-${i}`}>
                          <line x1={x} y1="70" x2={x} y2="450" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 4" />
                          {n === 0 && (
                            <text x={right ? x - 5 : x + 5} y="82" textAnchor={right ? 'end' : 'start'}
                              fontSize="11" fill="#6b7280">Måttbyte</text>
                          )}
                        </g>
                      );
                    })}

                  {hoveredDataPoint && (() => {
                    const isSplicedTooltip = !gaListensMode && !gaSiteVisitsMode && selectedMetric === 'account_viewers_spliced';
                    const tooltipWidth = 240, tooltipHeight = isSplicedTooltip ? 124 : 88;
                    let tooltipX = mousePosition.x + 15, tooltipY = mousePosition.y - 45;
                    if (tooltipX + tooltipWidth > 980) tooltipX = mousePosition.x - tooltipWidth - 15;
                    if (tooltipY < 15) tooltipY = mousePosition.y + 15;
                    if (tooltipY + tooltipHeight > 480) tooltipY = mousePosition.y - tooltipHeight - 15;
                    const [year, month] = hoveredDataPoint.month.split('-').map(Number);
                    const tooltipMetric = gaSiteVisitsMode
                      ? (gsvMetric === 'avg_daily_visits' ? 'Besök snitt/dag' : 'Besök')
                      : gaListensMode
                        ? (gaMetric === 'avg_daily_listens' ? 'Lyssningar snitt/dag' : 'Lyssningar')
                        : (selectedMetric === 'account_viewers_spliced' ? 'Unika personer (skarvad serie)' : availableMetrics[selectedMetric]);
                    const isEstimatedTooltip = !gaListensMode && !gaSiteVisitsMode && selectedMetric === 'estimated_unique_clicks';
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
                        <text x={tooltipX + 12} y={tooltipY + 20} fill="white" fontSize="13" fontWeight="bold">{isYoY ? yoyAccountName : hoveredDataPoint.account_name}</text>
                        <text x={tooltipX + 12} y={tooltipY + 38} fill="white" fontSize="12">{getMonthName(month)} {year}</text>
                        <text x={tooltipX + 12} y={tooltipY + 55} fill="white" fontSize="11">{tooltipMetric}</text>
                        <text x={tooltipX + 12} y={tooltipY + 73} fill="white" fontSize={isEstimatedTooltip ? '13' : '14'} fontWeight="bold">{tooltipValueText}</text>
                        {isSplicedTooltip && (
                          <text x={tooltipX + 12} y={tooltipY + 91} fill="#d1d5db" fontSize="11">
                            Källa: {hoveredDataPoint.source === 'viewers' ? 'Unika tittare (API)' : 'Kontoräckvidd (äldre mått)'}
                          </text>
                        )}
                        {isSplicedTooltip && hoveredDataPoint.ghost !== null && hoveredDataPoint.ghost !== undefined && (
                          <text x={tooltipX + 12} y={tooltipY + 109} fill="#d1d5db" fontSize="11">
                            Äldre mått samma månad: {hoveredDataPoint.ghost.toLocaleString('sv-SE')}
                          </text>
                        )}
                      </g>
                    );
                  })()}
                </svg>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <LineChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
              {isYoY ? (
                <>
                  <p className="text-lg font-medium mb-2">År över år</p>
                  <p className="text-sm">
                    {yoyUnsupported
                      ? (selectedMetric === 'account_viewers_spliced'
                          ? 'År över år stöds inte för den skarvade serien — åren före och efter måttbytet är inte jämförbara.'
                          : 'År över år stöds inte för uppskattade unika klick.')
                      : !yoyKey
                        ? `Välj ett ${(gaListensMode || gaSiteVisitsMode) ? 'program' : 'konto'} i listan ovan.`
                        : yoyLoading
                          ? 'Laddar...'
                          : yoyYearInfos.length < 2
                            ? 'Behöver minst två år med data för det här värdet.'
                            : 'Välj minst ett årtal.'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium mb-2">
                    {gaSiteVisitsMode
                      ? 'Välj program för att visa besökstrender'
                      : gaListensMode
                        ? 'Välj program för att visa lyssnartrender'
                        : 'Välj konton och datapunkt för att visa trend'}
                  </p>
                  <p className="text-sm">
                    {selectedAccounts.length === 0
                      ? `Markera minst ett ${(gaListensMode || gaSiteVisitsMode) ? 'program' : 'konto'} i listan ovan`
                      : loading ? 'Laddar trenddata...' : 'Valda konton är redo'}
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <GroupCreateDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        source={gaSiteVisitsMode ? 'ga_site_visits' : gaListensMode ? 'ga_listens' : 'posts'}
        availableAccounts={groupDialogAccounts}
        editGroup={null}
        onSave={() => { if (onGroupsChanged) onGroupsChanged(); }}
      />
    </div>
  );
};

export default TrendAnalysisView;
