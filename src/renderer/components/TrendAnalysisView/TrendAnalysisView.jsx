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
} from 'lucide-react';
import { api } from '@/utils/apiClient';

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
const TREND_METRICS_FB = { 'account_reach': 'Kontoräckvidd (API)', 'total_clicks': 'Totalt antal klick', 'link_clicks': 'Länkklick', 'other_clicks': 'Övriga klick' };
const TREND_METRICS_IG = { 'saves': 'Sparade', 'follows': 'Följare' };

const CHART_COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C'
];

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

const TrendAnalysisView = ({ platform, periodParams = {}, gaListensMode = false }) => {
  const [selectedMetric, setSelectedMetric] = useState('interactions');
  // selectedAccounts stores composite keys: "account_name::platform"
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  const [accountList, setAccountList] = useState([]);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(false);

  // GA Listens state
  const [gaRawData, setGaRawData] = useState([]);
  const [gaAccountList, setGaAccountList] = useState([]);

  // Clear selection when switching between GA and post mode
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
        // Send composite keys to backend
        const params = {
          metric: selectedMetric,
          accountKeys: selectedAccounts.join('||'),
          granularity: 'month',
          // account_reach always shows all imported months — skip period params
          ...(selectedMetric !== 'account_reach' ? periodParams : {}),
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
  }, [gaListensMode, selectedMetric, selectedAccounts, platform, periodParams]);

  // Build chart lines from trend data
  const { months, chartLines } = useMemo(() => {
    if (!trendData || !trendData.months || !trendData.series) {
      return { months: [], chartLines: [] };
    }
    const lines = trendData.series.map((series, index) => ({
      key: accountKey(series.account_name, series.platform),
      account_name: series.account_name,
      platform: series.platform,
      is_collab: series.is_collab || false,
      color: CHART_COLORS[index % CHART_COLORS.length],
      points: trendData.months.map((monthKey, mIndex) => ({
        month: monthKey,
        value: series.data[mIndex] || 0,
      })),
    }));
    return { months: trendData.months, chartLines: lines };
  }, [trendData]);

  const yAxisConfig = useMemo(() => {
    if (chartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = chartLines.flatMap(line => line.points.map(p => p.value));
    return calculateNiceYAxis(Math.max(...allValues));
  }, [chartLines]);

  // Fetch GA listens data
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
        const names = [...new Set(rows.map(r => r.account_name))].sort((a, b) =>
          a.localeCompare(b, 'sv')
        );
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

  // GA pivot: account_name → month → listens
  const gaPivot = useMemo(() => {
    if (!gaListensMode) return {};
    const map = {};
    for (const row of gaRawData) {
      if (!map[row.account_name]) map[row.account_name] = {};
      map[row.account_name][row.month] = row.listens;
    }
    return map;
  }, [gaListensMode, gaRawData]);

  const gaMonths = useMemo(() =>
    gaListensMode ? [...new Set(gaRawData.map(r => r.month))].sort() : []
  , [gaListensMode, gaRawData]);

  const gaChartLines = useMemo(() => {
    if (!gaListensMode || selectedAccounts.length === 0) return [];
    return selectedAccounts
      .filter(key => { const { name } = parseAccountKey(key); return gaPivot[name] !== undefined; })
      .map((key, index) => {
        const { name } = parseAccountKey(key);
        return {
          key,
          account_name: name,
          platform: 'ga_listens',
          is_collab: false,
          color: CHART_COLORS[index % CHART_COLORS.length],
          points: gaMonths.map(month => ({ month, value: gaPivot[name]?.[month] ?? 0 })),
        };
      });
  }, [gaListensMode, selectedAccounts, gaPivot, gaMonths]);

  const gaYAxisConfig = useMemo(() => {
    if (gaChartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = gaChartLines.flatMap(line => line.points.map(p => p.value));
    return calculateNiceYAxis(Math.max(...allValues));
  }, [gaChartLines]);

  // Unified display values: GA mode or post mode
  const displayMonths    = gaListensMode ? gaMonths    : months;
  const displayChartLines = gaListensMode ? gaChartLines : chartLines;
  const displayYAxisConfig = gaListensMode ? gaYAxisConfig : yAxisConfig;

  // Filter account list based on selected metric (account_reach = FB only)
  const filteredAccountList = useMemo(() => {
    if (selectedMetric === 'account_reach') {
      return accountList.filter(a => a.platform === 'facebook');
    }
    return accountList;
  }, [accountList, selectedMetric]);

  // When metric changes to account_reach, remove non-FB accounts from selection
  useEffect(() => {
    if (!gaListensMode && selectedMetric === 'account_reach') {
      const fbKeys = new Set(accountList.filter(a => a.platform === 'facebook').map(a => a.key));
      setSelectedAccounts(prev => prev.filter(k => fbKeys.has(k)));
    }
  }, [gaListensMode, selectedMetric, accountList]);

  // Final display account list (resolved after filteredAccountList is available)
  const activeAccountList = gaListensMode ? gaAccountList : filteredAccountList;

  const handleAccountToggle = (key) => {
    setSelectedAccounts(current =>
      current.includes(key) ? current.filter(k => k !== key) : [...current, key]
    );
  };

  const handleToggleAllAccounts = () => {
    const allKeys = activeAccountList.map(a => a.key);
    const allSelected = allKeys.length > 0 && allKeys.every(k => selectedAccounts.includes(k));
    setSelectedAccounts(allSelected ? [] : allKeys);
  };

  const allAccountsSelected = activeAccountList.length > 0 &&
    activeAccountList.every(a => selectedAccounts.includes(a.key));

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
                {activeAccountList.map(account => (
                  <Label key={account.key} className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(account.key)}
                      onChange={() => handleAccountToggle(account.key)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {account.account_name}
                      <PlatformBadge platform={account.platform} />
                      {account.is_collab ? <CollabBadge compact /> : null}
                    </span>
                  </Label>
                ))}
              </div>
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
                  {Object.entries(availableMetrics).map(([key, label]) => (
                    <Label key={key} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded">
                      <input
                        type="radio"
                        name="trendMetric"
                        value={key}
                        checked={selectedMetric === key}
                        onChange={() => setSelectedMetric(key)}
                        className="h-4 w-4 border-gray-300 accent-primary"
                      />
                      <span className="text-sm flex items-center gap-1.5">
                        {label}
                        {['account_reach', 'total_clicks', 'link_clicks', 'other_clicks'].includes(key) && <PlatformBadge platform="facebook" />}
                        {['saves', 'follows'].includes(key) && <PlatformBadge platform="instagram" />}
                      </span>
                    </Label>
                  ))}
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

          {showChart ? (
            <div className="space-y-4">
              {/* Legend */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {displayChartLines.map(line => (
                  <div key={line.key} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full border flex-shrink-0" style={{ backgroundColor: line.color }} />
                    <span className="text-sm font-medium truncate flex items-center gap-1" title={line.account_name}>
                      {line.account_name.length > 20 ? line.account_name.substring(0, 17) + '...' : line.account_name}
                      <PlatformBadge platform={line.platform} />
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
                    const pathPoints = line.points.map((point, index) => ({
                      x: 70 + (index / Math.max(1, displayMonths.length - 1)) * 860,
                      y: 450 - ((point.value - displayYAxisConfig.min) / (displayYAxisConfig.max - displayYAxisConfig.min)) * 380,
                      point
                    }));
                    return (
                      <g key={line.key}>
                        {line.points.length > 1 && (
                          <path d={createSmoothPath(pathPoints)} fill="none" stroke={line.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {pathPoints.map(({ x, y, point }, index) => (
                          <circle key={index} cx={x} cy={y} r="5" fill={line.color} stroke="white" strokeWidth="2" className="cursor-pointer"
                            onMouseEnter={(e) => handleMouseMove(e, { ...point, account_name: line.account_name, platform: line.platform, color: line.color })} />
                        ))}
                      </g>
                    );
                  })}

                  {hoveredDataPoint && (() => {
                    const tooltipWidth = 220, tooltipHeight = 70;
                    let tooltipX = mousePosition.x + 15, tooltipY = mousePosition.y - 35;
                    if (tooltipX + tooltipWidth > 980) tooltipX = mousePosition.x - tooltipWidth - 15;
                    if (tooltipY < 15) tooltipY = mousePosition.y + 15;
                    if (tooltipY + tooltipHeight > 480) tooltipY = mousePosition.y - tooltipHeight - 15;
                    const [year, month] = hoveredDataPoint.month.split('-').map(Number);
                    const tooltipMetric = gaListensMode ? 'Lyssningar' : availableMetrics[selectedMetric];
                    return (
                      <g>
                        <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} fill="rgba(0,0,0,0.85)" rx="6" />
                        <text x={tooltipX + 12} y={tooltipY + 20} fill="white" fontSize="13" fontWeight="bold">{hoveredDataPoint.account_name}</text>
                        <text x={tooltipX + 12} y={tooltipY + 38} fill="white" fontSize="12">{getMonthName(month)} {year}</text>
                        <text x={tooltipX + 12} y={tooltipY + 55} fill="white" fontSize="12">{tooltipMetric}: {hoveredDataPoint.value.toLocaleString()}</text>
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
    </div>
  );
};

export default TrendAnalysisView;
