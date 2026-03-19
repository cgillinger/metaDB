import React, { useState, useMemo } from 'react';
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
  Info
} from 'lucide-react';
import { getValue } from '@/utils/columnConfig';

// Available trend metrics - shared across platforms
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

// FB-specific trend metrics
const TREND_METRICS_FB = {
  'total_clicks': 'Totalt antal klick',
  'link_clicks': 'Länkklick',
  'other_clicks': 'Övriga klick'
};

// IG-specific trend metrics
const TREND_METRICS_IG = {
  'saves': 'Sparade',
  'follows': 'Följare'
};

// Chart colors
const CHART_COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C'
];

// Swedish month names
const MONTH_NAMES_SV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

const calculateNiceYAxis = (maxValue) => {
  if (maxValue <= 0) {
    return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  }

  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)));
  let tickInterval;
  const normalizedMax = maxValue / magnitude;

  if (normalizedMax <= 1) {
    tickInterval = magnitude * 0.25;
  } else if (normalizedMax <= 2) {
    tickInterval = magnitude * 0.5;
  } else if (normalizedMax <= 5) {
    tickInterval = magnitude * 1;
  } else if (normalizedMax <= 10) {
    tickInterval = magnitude * 2;
  } else {
    tickInterval = magnitude * 5;
  }

  const niceMax = Math.ceil(maxValue / tickInterval) * tickInterval;
  const ticks = [];
  for (let i = 0; i <= niceMax; i += tickInterval) {
    ticks.push(Math.round(i));
  }

  return { min: 0, max: niceMax, ticks, tickInterval };
};

const createSmoothPath = (points) => {
  if (points.length < 2) return '';

  if (points.length === 2) {
    const [p1, p2] = points;
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const previous = points[i - 1];

    if (i === 1) {
      const next = points[i + 1] || current;
      const cp1x = previous.x + (current.x - previous.x) * 0.3;
      const cp1y = previous.y + (current.y - previous.y) * 0.3;
      const cp2x = current.x - (next.x - previous.x) * 0.1;
      const cp2y = current.y - (next.y - previous.y) * 0.1;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${current.x} ${current.y}`;
    } else if (i === points.length - 1) {
      const beforePrev = points[i - 2] || previous;
      const cp1x = previous.x + (current.x - beforePrev.x) * 0.1;
      const cp1y = previous.y + (current.y - beforePrev.y) * 0.1;
      const cp2x = current.x - (current.x - previous.x) * 0.3;
      const cp2y = current.y - (current.y - previous.y) * 0.3;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${current.x} ${current.y}`;
    } else {
      const next = points[i + 1];
      const beforePrev = points[i - 2] || previous;
      const cp1x = previous.x + (current.x - beforePrev.x) * 0.1;
      const cp1y = previous.y + (current.y - beforePrev.y) * 0.1;
      const cp2x = current.x - (next.x - previous.x) * 0.1;
      const cp2y = current.y - (next.y - previous.y) * 0.1;
      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${current.x} ${current.y}`;
    }
  }

  return path;
};

const getMonthName = (month) => MONTH_NAMES_SV[month - 1] || String(month);

const TrendAnalysisView = ({ data, meta }) => {
  const [selectedMetric, setSelectedMetric] = useState('interactions');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Detect which platforms are present
  const platforms = useMemo(() => {
    if (!data || !Array.isArray(data)) return new Set();
    return new Set(data.map(post => post._platform).filter(Boolean));
  }, [data]);

  const hasFacebook = platforms.has('facebook');
  const hasInstagram = platforms.has('instagram');

  // Build available metrics based on platform presence
  const availableMetrics = useMemo(() => {
    const metrics = { ...TREND_METRICS_COMMON };
    if (hasFacebook) {
      Object.assign(metrics, TREND_METRICS_FB);
    }
    if (hasInstagram) {
      Object.assign(metrics, TREND_METRICS_IG);
    }
    return metrics;
  }, [hasFacebook, hasInstagram]);

  // Group data per month and account
  const monthlyAccountData = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { months: [], accountData: [] };
    }

    const monthlyGroups = {};
    const allMonths = new Set();

    data.forEach(post => {
      const publishTime = getValue(post, 'publish_time');
      const accountId = getValue(post, 'account_id');
      const accountName = getValue(post, 'account_name') || 'Okänt konto';

      if (!publishTime || !accountId) return;

      const date = new Date(publishTime);
      if (isNaN(date.getTime())) return;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      allMonths.add(monthKey);

      if (!monthlyGroups[monthKey]) {
        monthlyGroups[monthKey] = {};
      }

      if (!monthlyGroups[monthKey][accountId]) {
        monthlyGroups[monthKey][accountId] = {
          account_id: accountId,
          account_name: accountName,
          posts: []
        };
      }

      monthlyGroups[monthKey][accountId].posts.push(post);
    });

    const sortedMonths = Array.from(allMonths).sort();

    // Calculate metrics per month and account
    const accountDataMap = {};

    Object.entries(monthlyGroups).forEach(([monthKey, accounts]) => {
      Object.entries(accounts).forEach(([accountId, accountInfo]) => {
        let totalLikes = 0, totalComments = 0, totalShares = 0;
        let totalClicks = 0, totalOtherClicks = 0, totalLinkClicks = 0;
        let totalViews = 0, totalReach = 0;
        let totalSaves = 0, totalFollows = 0;

        accountInfo.posts.forEach(post => {
          totalLikes += parseFloat(getValue(post, 'likes') || 0);
          totalComments += parseFloat(getValue(post, 'comments') || 0);
          totalShares += parseFloat(getValue(post, 'shares') || 0);
          totalClicks += parseFloat(getValue(post, 'total_clicks') || 0);
          totalOtherClicks += parseFloat(getValue(post, 'other_clicks') || 0);
          totalLinkClicks += parseFloat(getValue(post, 'link_clicks') || 0);
          totalViews += parseFloat(getValue(post, 'views') || 0);
          totalReach += parseFloat(getValue(post, 'reach') || 0);
          totalSaves += parseFloat(getValue(post, 'saves') || 0);
          totalFollows += parseFloat(getValue(post, 'follows') || 0);
        });

        const postCount = accountInfo.posts.length;
        const [year, month] = monthKey.split('-').map(Number);
        const daysInMonth = getDaysInMonth(year, month - 1);

        // Determine dominant platform for this account in this month
        const platformCounts = {};
        accountInfo.posts.forEach(post => {
          const p = post._platform || 'instagram';
          platformCounts[p] = (platformCounts[p] || 0) + 1;
        });
        const dominantPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'instagram';

        if (!accountDataMap[accountId]) {
          accountDataMap[accountId] = {
            account_id: accountId,
            account_name: accountInfo.account_name,
            _platform: dominantPlatform,
            _isCollab: accountInfo.posts.some(p => p._isCollab),
            monthlyData: {}
          };
        }

        const interactions = totalLikes + totalComments + totalShares;
        let engagement;
        if (dominantPlatform === 'facebook') {
          engagement = interactions + totalClicks;
        } else {
          engagement = totalLikes + totalComments + totalShares + totalSaves + totalFollows;
        }

        accountDataMap[accountId].monthlyData[monthKey] = {
          likes: totalLikes,
          comments: totalComments,
          shares: totalShares,
          total_clicks: totalClicks,
          other_clicks: totalOtherClicks,
          link_clicks: totalLinkClicks,
          views: totalViews,
          reach: totalReach,
          saves: totalSaves,
          follows: totalFollows,
          interactions,
          engagement,
          post_count: postCount,
          average_reach: postCount > 0 ? Math.round(totalReach / postCount) : 0,
          posts_per_day: Math.round((postCount / daysInMonth) * 10) / 10
        };
      });
    });

    return {
      months: sortedMonths,
      accountData: Object.values(accountDataMap).sort((a, b) =>
        a.account_name.localeCompare(b.account_name)
      )
    };
  }, [data]);

  // Generate chart line data per account
  const chartLines = useMemo(() => {
    if (!selectedAccounts.length || !selectedMetric) return [];

    return monthlyAccountData.accountData
      .filter(account => selectedAccounts.includes(account.account_id))
      .map((account, index) => {
        const points = monthlyAccountData.months.map(monthKey => {
          const monthData = account.monthlyData[monthKey];
          return {
            month: monthKey,
            value: monthData ? (monthData[selectedMetric] || 0) : 0,
            account
          };
        });

        return {
          account_id: account.account_id,
          account_name: account.account_name,
          _platform: account._platform,
          _isCollab: account._isCollab || false,
          color: CHART_COLORS[index % CHART_COLORS.length],
          points
        };
      });
  }, [monthlyAccountData, selectedAccounts, selectedMetric]);

  // Y-axis configuration
  const yAxisConfig = useMemo(() => {
    if (chartLines.length === 0) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
    const allValues = chartLines.flatMap(line => line.points.map(p => p.value));
    const maxValue = Math.max(...allValues);
    return calculateNiceYAxis(maxValue);
  }, [chartLines]);

  const handleAccountToggle = (accountId) => {
    setSelectedAccounts(current =>
      current.includes(accountId)
        ? current.filter(id => id !== accountId)
        : [...current, accountId]
    );
  };

  const handleToggleAllAccounts = () => {
    const allAccountIds = monthlyAccountData.accountData.map(a => a.account_id);
    if (selectedAccounts.length === allAccountIds.length) {
      setSelectedAccounts([]);
    } else {
      setSelectedAccounts(allAccountIds);
    }
  };

  const allAccountsSelected =
    selectedAccounts.length === monthlyAccountData.accountData.length &&
    monthlyAccountData.accountData.length > 0;

  const handleMouseMove = (event, point) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
    setHoveredDataPoint(point);
  };

  const showChart =
    selectedMetric &&
    selectedAccounts.length > 0 &&
    monthlyAccountData.months.length > 0;

  const accountSelectorLabel = hasFacebook && !hasInstagram
    ? 'Välj Facebook-sidor'
    : !hasFacebook && hasInstagram
    ? 'Välj Instagram-konton'
    : 'Välj konton';

  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Trendanalys
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Ingen data tillgänglig</AlertTitle>
            <AlertDescription>
              Ladda upp CSV-data för att se trendanalys.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (monthlyAccountData.accountData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Trendanalys
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Inga konton hittades</AlertTitle>
            <AlertDescription>
              Kunde inte hitta giltiga konton med publiceringsdatum i den uppladdade datan.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            Trendanalys över tid
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {meta?.dateRange && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Tidsperiod</AlertTitle>
              <AlertDescription>
                Data från {meta.dateRange.startDate} till {meta.dateRange.endDate}
                ({monthlyAccountData.months.length} månader)
              </AlertDescription>
            </Alert>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            {/* Account selector */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-medium">
                  {accountSelectorLabel} ({selectedAccounts.length} valda)
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleAllAccounts}
                >
                  {allAccountsSelected ? 'Avmarkera alla' : 'Välj alla'}
                </Button>
              </div>

              <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-2 bg-gray-50">
                {monthlyAccountData.accountData.map(account => (
                  <Label
                    key={account.account_id}
                    className="flex items-center gap-2 cursor-pointer hover:bg-white p-2 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(account.account_id)}
                      onChange={() => handleAccountToggle(account.account_id)}
                      className="h-4 w-4 accent-blue-600"
                    />
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {account.account_name}
                      <PlatformBadge platform={account._platform} />
                      {account._isCollab && <CollabBadge compact />}
                    </span>
                  </Label>
                ))}
              </div>
            </div>

            {/* Metric selector */}
            <div>
              <Label className="text-base font-medium mb-3 block">
                Välj datapunkt att analysera
              </Label>

              <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-gray-50">
                {Object.entries(availableMetrics).map(([key, label]) => (
                  <Label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-white p-1 rounded"
                  >
                    <input
                      type="radio"
                      name="trendMetric"
                      value={key}
                      checked={selectedMetric === key}
                      onChange={() => setSelectedMetric(key)}
                      className="h-4 w-4 border-gray-300 accent-primary"
                    />
                    <span className="text-sm">{label}</span>
                  </Label>
                ))}
              </div>
            </div>
          </div>

          {selectedMetric && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
              <h3 className="text-lg font-bold text-primary">
                Visar: {availableMetrics[selectedMetric]}
              </h3>
              <p className="text-sm text-primary/70 mt-1">
                Utveckling över tid för valda konton
              </p>
            </div>
          )}

          {showChart ? (
            <div className="space-y-4">
              {/* Legend */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {chartLines.map(line => (
                  <div key={line.account_id} className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full border flex-shrink-0"
                      style={{ backgroundColor: line.color }}
                    />
                    <span className="text-sm font-medium truncate flex items-center gap-1" title={line.account_name}>
                      {line.account_name.length > 20
                        ? line.account_name.substring(0, 17) + '...'
                        : line.account_name}
                      <PlatformBadge platform={line._platform} />
                      {line._isCollab && <CollabBadge compact />}
                    </span>
                  </div>
                ))}
              </div>

              {/* Line chart */}
              <div className="relative">
                <svg
                  width="100%"
                  height="500"
                  viewBox="0 0 1000 500"
                  className="border rounded bg-gray-50"
                  onMouseLeave={() => setHoveredDataPoint(null)}
                >
                  {/* Grid */}
                  <defs>
                    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />

                  {/* Y-axis ticks */}
                  {yAxisConfig.ticks.map(tickValue => {
                    const yPos = 450 - ((tickValue - yAxisConfig.min) / (yAxisConfig.max - yAxisConfig.min)) * 380;
                    return (
                      <g key={tickValue}>
                        <line x1="70" y1={yPos} x2="930" y2={yPos} stroke="#d1d5db" strokeWidth="1" />
                        <text x="65" y={yPos + 4} textAnchor="end" fontSize="14" fill="#6b7280">
                          {tickValue.toLocaleString()}
                        </text>
                      </g>
                    );
                  })}

                  {/* X-axis months */}
                  {monthlyAccountData.months.map((monthKey, index) => {
                    const [year, month] = monthKey.split('-').map(Number);
                    const xPos = 70 + (index / Math.max(1, monthlyAccountData.months.length - 1)) * 860;
                    return (
                      <g key={monthKey}>
                        <line x1={xPos} y1="70" x2={xPos} y2="450" stroke="#d1d5db" strokeWidth="1" />
                        <text x={xPos} y="475" textAnchor="middle" fontSize="14" fill="#6b7280">
                          {getMonthName(month)}
                        </text>
                        <text x={xPos} y="490" textAnchor="middle" fontSize="12" fill="#9ca3af">
                          {year}
                        </text>
                      </g>
                    );
                  })}

                  {/* Lines */}
                  {chartLines.map(line => {
                    if (line.points.length < 1) return null;

                    const pathPoints = line.points.map((point, index) => {
                      const x = 70 + (index / Math.max(1, monthlyAccountData.months.length - 1)) * 860;
                      const y = 450 - ((point.value - yAxisConfig.min) / (yAxisConfig.max - yAxisConfig.min)) * 380;
                      return { x, y, point };
                    });

                    return (
                      <g key={line.account_id}>
                        {line.points.length > 1 && (
                          <path
                            d={createSmoothPath(pathPoints)}
                            fill="none"
                            stroke={line.color}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {pathPoints.map(({ x, y, point }, index) => (
                          <circle
                            key={index}
                            cx={x}
                            cy={y}
                            r="5"
                            fill={line.color}
                            stroke="white"
                            strokeWidth="2"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handleMouseMove(e, {
                              ...point,
                              account_name: line.account_name,
                              color: line.color
                            })}
                          />
                        ))}
                      </g>
                    );
                  })}

                  {/* Tooltip */}
                  {hoveredDataPoint && (
                    <g>
                      {(() => {
                        const tooltipWidth = 220;
                        const tooltipHeight = 70;
                        let tooltipX = mousePosition.x + 15;
                        let tooltipY = mousePosition.y - 35;

                        if (tooltipX + tooltipWidth > 980) {
                          tooltipX = mousePosition.x - tooltipWidth - 15;
                        }
                        if (tooltipY < 15) {
                          tooltipY = mousePosition.y + 15;
                        }
                        if (tooltipY + tooltipHeight > 480) {
                          tooltipY = mousePosition.y - tooltipHeight - 15;
                        }

                        const [year, month] = hoveredDataPoint.month.split('-').map(Number);

                        return (
                          <>
                            <rect
                              x={tooltipX} y={tooltipY}
                              width={tooltipWidth} height={tooltipHeight}
                              fill="rgba(0,0,0,0.85)" rx="6"
                            />
                            <text x={tooltipX + 12} y={tooltipY + 20} fill="white" fontSize="13" fontWeight="bold">
                              {hoveredDataPoint.account_name}
                            </text>
                            <text x={tooltipX + 12} y={tooltipY + 38} fill="white" fontSize="12">
                              {getMonthName(month)} {year}
                            </text>
                            <text x={tooltipX + 12} y={tooltipY + 55} fill="white" fontSize="12">
                              {availableMetrics[selectedMetric]}: {hoveredDataPoint.value.toLocaleString()}
                            </text>
                          </>
                        );
                      })()}
                    </g>
                  )}
                </svg>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <LineChart className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Välj konton och datapunkt för att visa trend</p>
              <p className="text-sm">
                {selectedAccounts.length === 0
                  ? 'Markera minst ett konto i listan ovan'
                  : monthlyAccountData.months.length === 0
                  ? 'Ingen tidsdata hittades i uppladdade CSV-filer'
                  : 'Valda konton är redo - väntar på datapunkt-val'
                }
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TrendAnalysisView;
