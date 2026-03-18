import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { getValue } from '@/utils/columnConfig';

const TREND_METRICS = {
  'views': 'Visningar',
  'average_reach': 'Genomsnittlig räckvidd',
  'engagement_total': 'Interaktioner (gilla+kommentar+delning)',
  'engagement_total_extended': 'Totalt engagemang (alla typer)',
  'likes': 'Gilla-markeringar',
  'comments': 'Kommentarer',
  'shares': 'Delningar',
  'saves': 'Sparade',
  'follows': 'Följare',
  'post_count': 'Antal publiceringar',
  'posts_per_day': 'Publiceringar per dag'
};

const CHART_COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C'
];

const MONTH_NAMES_SV = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function calculateNiceYAxis(maxValue) {
  if (maxValue === 0) return { max: 10, ticks: [0, 2, 4, 6, 8, 10] };
  const rawStep = maxValue / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep / magnitude) * magnitude;
  const niceMax = Math.ceil(maxValue / niceStep) * niceStep;
  const ticks = [];
  for (let i = 0; i <= niceMax; i += niceStep) {
    ticks.push(i);
  }
  return { max: niceMax, ticks };
}

function createSmoothPath(points, xScale, yScale, yMax) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const x = xScale(0);
    const y = yScale(points[0].value, yMax);
    return `M ${x} ${y}`;
  }
  const coords = points.map((p, i) => ({
    x: xScale(i),
    y: yScale(p.value, yMax)
  }));

  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cpX = (prev.x + curr.x) / 2;
    d += ` C ${cpX} ${prev.y}, ${cpX} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

export default function TrendAnalysisView({ data, meta }) {
  const [selectedMetric, setSelectedMetric] = useState('engagement_total');
  const [selectedAccounts, setSelectedAccounts] = useState([]);
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Gruppera data per månad och konto
  const monthlyAccountData = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return { months: [], accounts: [], data: {} };

    const accountMap = {}; // accountId -> accountName
    const monthSet = new Set();
    const grouped = {}; // `${accountId}|${yearMonth}` -> aggregated stats

    data.forEach(post => {
      const accountId = String(getValue(post, 'account_id') || 'unknown');
      const accountName = String(getValue(post, 'account_name') || accountId);
      accountMap[accountId] = accountName;

      const publishTime = getValue(post, 'publish_time');
      if (!publishTime) return;
      const date = new Date(publishTime);
      if (isNaN(date.getTime())) return;

      const year = date.getFullYear();
      const month = date.getMonth();
      const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
      monthSet.add(yearMonth);

      const key = `${accountId}|${yearMonth}`;
      if (!grouped[key]) {
        grouped[key] = {
          accountId, accountName, year, month, yearMonth,
          likes: 0, comments: 0, shares: 0, saves: 0, follows: 0,
          views: 0, post_reach: 0, post_count: 0
        };
      }

      grouped[key].likes += parseFloat(getValue(post, 'likes') || 0);
      grouped[key].comments += parseFloat(getValue(post, 'comments') || 0);
      grouped[key].shares += parseFloat(getValue(post, 'shares') || 0);
      grouped[key].saves += parseFloat(getValue(post, 'saves') || 0);
      grouped[key].follows += parseFloat(getValue(post, 'follows') || 0);
      grouped[key].views += parseFloat(getValue(post, 'views') || 0);
      grouped[key].post_reach += parseFloat(getValue(post, 'post_reach') || 0);
      grouped[key].post_count += 1;
    });

    // Beräkna avledda metriker
    Object.values(grouped).forEach(g => {
      g.engagement_total = g.likes + g.comments + g.shares;
      g.engagement_total_extended = g.likes + g.comments + g.shares + g.saves + g.follows;
      g.average_reach = g.post_count > 0 ? g.post_reach / g.post_count : 0;
      g.posts_per_day = g.post_count / getDaysInMonth(g.year, g.month);
    });

    const sortedMonths = [...monthSet].sort();
    const accounts = Object.entries(accountMap).map(([id, name]) => ({ id, name }));

    return { months: sortedMonths, accounts, data: grouped };
  }, [data]);

  // Generera linjedata per konto
  const chartLines = useMemo(() => {
    const { months, accounts, data: grouped } = monthlyAccountData;
    if (months.length === 0) return [];

    return accounts
      .filter(a => selectedAccounts.includes(a.id))
      .map((account, idx) => {
        const points = months.map((yearMonth, mIdx) => {
          const key = `${account.id}|${yearMonth}`;
          const entry = grouped[key];
          return {
            yearMonth,
            value: entry ? (entry[selectedMetric] || 0) : 0,
            monthIndex: mIdx
          };
        });
        return {
          accountId: account.id,
          accountName: account.name,
          color: CHART_COLORS[idx % CHART_COLORS.length],
          points
        };
      });
  }, [monthlyAccountData, selectedAccounts, selectedMetric]);

  // Y-axel
  const yAxisConfig = useMemo(() => {
    const allValues = chartLines.flatMap(l => l.points.map(p => p.value));
    const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
    return calculateNiceYAxis(maxValue);
  }, [chartLines]);

  if (!data || data.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-md text-blue-700">
            Ladda upp CSV-data för att se trendanalys.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (monthlyAccountData.accounts.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="pt-6">
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md text-yellow-700">
            Inga konton hittades i datan.
          </div>
        </CardContent>
      </Card>
    );
  }

  const { months, accounts } = monthlyAccountData;

  // SVG-dimensioner
  const SVG_WIDTH = 1000;
  const SVG_HEIGHT = 500;
  const PADDING = { top: 20, right: 20, bottom: 60, left: 70 };
  const CHART_WIDTH = SVG_WIDTH - PADDING.left - PADDING.right;
  const CHART_HEIGHT = SVG_HEIGHT - PADDING.top - PADDING.bottom;

  const xScale = (i) => months.length <= 1
    ? PADDING.left + CHART_WIDTH / 2
    : PADDING.left + (i / (months.length - 1)) * CHART_WIDTH;

  const yScale = (value, maxVal) => {
    if (maxVal === 0) return PADDING.top + CHART_HEIGHT;
    return PADDING.top + CHART_HEIGHT - (value / maxVal) * CHART_HEIGHT;
  };

  const handleMouseMove = (e, point, accountName, color) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHoveredDataPoint({ ...point, accountName, color });
  };

  const formatMonthLabel = (yearMonth) => {
    const [year, monthIdx] = yearMonth.split('-').map(Number);
    return `${MONTH_NAMES_SV[monthIdx]} ${year}`;
  };

  const formatValue = (val) => {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'number') {
      if (val < 1 && val > 0) return val.toFixed(2);
      return val.toLocaleString('sv-SE');
    }
    return String(val);
  };

  const toggleAccount = (accountId) => {
    if (selectedAccounts.includes(accountId)) {
      setSelectedAccounts(selectedAccounts.filter(id => id !== accountId));
    } else {
      setSelectedAccounts([...selectedAccounts, accountId]);
    }
  };

  const selectAllAccounts = () => setSelectedAccounts(accounts.map(a => a.id));
  const deselectAllAccounts = () => setSelectedAccounts([]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Trendanalys per månad</CardTitle>
        {meta?.dateRange?.startDate && (
          <p className="text-sm text-muted-foreground">
            Period: {meta.dateRange.startDate} – {meta.dateRange.endDate}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* Övre panel: kontoval och metrikval sida vid sida */}
        <div className="flex gap-6 mb-6">
          {/* Konton */}
          <div className="flex-1">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold text-sm">
                Välj konton ({selectedAccounts.length} valda)
              </h3>
              <button
                onClick={selectedAccounts.length === accounts.length ? deselectAllAccounts : selectAllAccounts}
                className="text-xs text-blue-600 hover:underline"
              >
                {selectedAccounts.length === accounts.length ? 'Avmarkera alla' : 'Välj alla'}
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto border rounded p-2">
              {accounts.map((account) => (
                <label key={account.id} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.includes(account.id)}
                    onChange={() => toggleAccount(account.id)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm truncate">{account.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Metrik */}
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-2">Välj datapunkt att analysera</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto border rounded p-2">
              {Object.entries(TREND_METRICS).map(([key, label]) => (
                <label key={key} className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="radio"
                    name="metric"
                    value={key}
                    checked={selectedMetric === key}
                    onChange={() => setSelectedMetric(key)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Diagram */}
        <div className="flex-1 min-w-0">
            {selectedAccounts.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                Välj konton för att visa trenddiagram
              </div>
            ) : (
              <div className="relative" onMouseLeave={() => setHoveredDataPoint(null)}>
                <svg
                  viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                  className="w-full"
                  style={{ fontFamily: 'sans-serif' }}
                >
                  {/* Grid-linjer */}
                  {yAxisConfig.ticks.map(tick => {
                    const y = yScale(tick, yAxisConfig.max);
                    return (
                      <g key={tick}>
                        <line
                          x1={PADDING.left} y1={y}
                          x2={PADDING.left + CHART_WIDTH} y2={y}
                          stroke="#e5e7eb" strokeWidth="1"
                        />
                        <text
                          x={PADDING.left - 8} y={y + 4}
                          textAnchor="end" fontSize="11" fill="#6b7280"
                        >
                          {formatValue(tick)}
                        </text>
                      </g>
                    );
                  })}

                  {/* X-axel etiketter */}
                  {months.map((ym, i) => {
                    const x = xScale(i);
                    const [year, monthIdx] = ym.split('-').map(Number);
                    return (
                      <text
                        key={ym}
                        x={x} y={PADDING.top + CHART_HEIGHT + 20}
                        textAnchor="middle" fontSize="11" fill="#6b7280"
                        transform={months.length > 12 ? `rotate(-45, ${x}, ${PADDING.top + CHART_HEIGHT + 20})` : ''}
                      >
                        {`${MONTH_NAMES_SV[monthIdx]} ${year}`}
                      </text>
                    );
                  })}

                  {/* Axellinjer */}
                  <line
                    x1={PADDING.left} y1={PADDING.top}
                    x2={PADDING.left} y2={PADDING.top + CHART_HEIGHT}
                    stroke="#d1d5db" strokeWidth="1"
                  />
                  <line
                    x1={PADDING.left} y1={PADDING.top + CHART_HEIGHT}
                    x2={PADDING.left + CHART_WIDTH} y2={PADDING.top + CHART_HEIGHT}
                    stroke="#d1d5db" strokeWidth="1"
                  />

                  {/* Linjer per konto */}
                  {chartLines.map(line => {
                    const pathData = createSmoothPath(
                      line.points, xScale,
                      (v, max) => yScale(v, yAxisConfig.max),
                      yAxisConfig.max
                    );
                    return (
                      <g key={line.accountId}>
                        <path
                          d={pathData}
                          fill="none"
                          stroke={line.color}
                          strokeWidth="2.5"
                          strokeLinejoin="round"
                        />
                        {line.points.map((point, i) => (
                          <circle
                            key={i}
                            cx={xScale(i)}
                            cy={yScale(point.value, yAxisConfig.max)}
                            r={hoveredDataPoint?.yearMonth === point.yearMonth && hoveredDataPoint?.accountName === line.accountName ? 6 : 4}
                            fill={line.color}
                            stroke="white"
                            strokeWidth="2"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={(e) => handleMouseMove(e, point, line.accountName, line.color)}
                            onMouseMove={(e) => handleMouseMove(e, point, line.accountName, line.color)}
                          />
                        ))}
                      </g>
                    );
                  })}
                </svg>

                {/* Tooltip */}
                {hoveredDataPoint && (
                  <div
                    className="absolute pointer-events-none bg-white border border-gray-200 shadow-lg rounded-md p-2 text-sm z-10"
                    style={{
                      left: Math.min(mousePosition.x + 12, 700),
                      top: Math.max(mousePosition.y - 60, 0)
                    }}
                  >
                    <div className="flex items-center space-x-2 mb-1">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ backgroundColor: hoveredDataPoint.color }}
                      />
                      <span className="font-medium">{hoveredDataPoint.accountName}</span>
                    </div>
                    <div className="text-gray-600">{formatMonthLabel(hoveredDataPoint.yearMonth)}</div>
                    <div className="font-semibold">
                      {TREND_METRICS[selectedMetric]}: {formatValue(hoveredDataPoint.value)}
                    </div>
                  </div>
                )}

                {/* Legenda */}
                <div className="flex flex-wrap gap-3 mt-2">
                  {chartLines.map(line => (
                    <div key={line.accountId} className="flex items-center space-x-1 text-sm">
                      <span
                        className="inline-block w-3 h-3 rounded-full"
                        style={{ backgroundColor: line.color }}
                      />
                      <span>{line.accountName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
      </CardContent>
    </Card>
  );
}
