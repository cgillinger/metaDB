import React, { useState } from 'react';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

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

const ComparisonChart = ({ data, seriesAConfig, seriesBConfig, dualAxis }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  if (!data || data.length === 0) return null;

  const months = data.map(d => d.month);
  const seriesAValues = data.map(d => d.seriesA).filter(v => v !== null);
  const seriesBValues = data.map(d => d.seriesB).filter(v => v !== null);

  const maxA = seriesAValues.length > 0 ? Math.max(...seriesAValues) : 0;
  const maxB = seriesBValues.length > 0 ? Math.max(...seriesBValues) : 0;

  const yAxisA = calculateNiceYAxis(dualAxis ? maxA : Math.max(maxA, maxB));
  const yAxisB = dualAxis ? calculateNiceYAxis(maxB) : yAxisA;

  const xLeft = 70, xRight = 930;
  const yTop = 70, yBottom = 450;
  const xSpan = xRight - xLeft;
  const ySpan = yBottom - yTop;

  const toX = (index) => xLeft + (index / Math.max(1, months.length - 1)) * xSpan;
  const toYA = (val) => {
    const range = yAxisA.max - yAxisA.min;
    return range > 0 ? yBottom - ((val - yAxisA.min) / range) * ySpan : yBottom;
  };
  const toYB = (val) => {
    const range = yAxisB.max - yAxisB.min;
    return range > 0 ? yBottom - ((val - yAxisB.min) / range) * ySpan : yBottom;
  };

  const pointsA = data
    .map((d, i) => d.seriesA !== null ? { x: toX(i), y: toYA(d.seriesA), month: d.month, value: d.seriesA } : null)
    .filter(Boolean);

  const pointsB = data
    .map((d, i) => d.seriesB !== null ? { x: toX(i), y: toYB(d.seriesB), month: d.month, value: d.seriesB } : null)
    .filter(Boolean);

  const handleMouseEnter = (e, point, series) => {
    const rect = e.currentTarget.closest('svg').getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setHoveredPoint({ ...point, series });
  };

  return (
    <div>
      {/* Legend */}
      <div className="flex flex-wrap gap-6 mb-3">
        <div className="flex items-center gap-2">
          <svg width="28" height="12">
            <line x1="0" y1="6" x2="28" y2="6" stroke={seriesAConfig.color} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium" style={{ color: seriesAConfig.color }}>
            {seriesAConfig.label}{dualAxis ? ' (vänster axel)' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="28" height="12">
            <line x1="0" y1="6" x2="28" y2="6" stroke={seriesBConfig.color} strokeWidth="2.5" strokeDasharray="8 4" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium" style={{ color: seriesBConfig.color }}>
            {seriesBConfig.label}{dualAxis ? ' (höger axel)' : ''}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        <svg width="100%" height="500" viewBox="0 0 1000 500" className="border rounded bg-gray-50"
          onMouseLeave={() => setHoveredPoint(null)}>
          <defs>
            <pattern id="compgrid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#compgrid)" />

          {/* Left y-axis ticks (seriesA) */}
          {yAxisA.ticks.map(tick => {
            const yPos = toYA(tick);
            return (
              <g key={`a-${tick}`}>
                <line x1={xLeft} y1={yPos} x2={xRight} y2={yPos} stroke="#d1d5db" strokeWidth="1" />
                <text x={xLeft - 5} y={yPos + 4} textAnchor="end" fontSize="13"
                  fill={dualAxis ? seriesAConfig.color : '#6b7280'}>
                  {tick.toLocaleString('sv-SE')}
                </text>
              </g>
            );
          })}

          {/* Right y-axis ticks (seriesB, only in dual mode) */}
          {dualAxis && yAxisB.ticks.map(tick => {
            const yPos = toYB(tick);
            return (
              <text key={`b-${tick}`} x={xRight + 5} y={yPos + 4} textAnchor="start" fontSize="13"
                fill={seriesBConfig.color}>
                {tick.toLocaleString('sv-SE')}
              </text>
            );
          })}

          {/* X-axis months */}
          {months.map((monthKey, index) => {
            const [year, month] = monthKey.split('-').map(Number);
            const xPos = toX(index);
            return (
              <g key={monthKey}>
                <line x1={xPos} y1={yTop} x2={xPos} y2={yBottom} stroke="#d1d5db" strokeWidth="1" />
                <text x={xPos} y={yBottom + 18} textAnchor="middle" fontSize="13" fill="#6b7280">
                  {MONTH_NAMES_SV[month - 1]}
                </text>
                <text x={xPos} y={yBottom + 32} textAnchor="middle" fontSize="11" fill="#9ca3af">
                  {year}
                </text>
          </g>
            );
          })}

          {/* Series A line */}
          {pointsA.length > 1 && (
            <path
              d={createSmoothPath(pointsA)}
              fill="none"
              stroke={seriesAConfig.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Series B line */}
          {pointsB.length > 1 && (
            <path
              d={createSmoothPath(pointsB)}
              fill="none"
              stroke={seriesBConfig.color}
              strokeWidth="2.5"
              strokeDasharray="8 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Series A dots */}
          {pointsA.map((p, i) => (
            <circle
              key={`a-dot-${i}`}
              cx={p.x} cy={p.y}
              r={hoveredPoint?.month === p.month && hoveredPoint?.series === 'A' ? 7 : 5}
              fill={seriesAConfig.color}
              stroke="white"
              strokeWidth="2"
              className="cursor-pointer"
              onMouseEnter={(e) => handleMouseEnter(e, p, 'A')}
            />
          ))}

          {/* Series B dots */}
          {pointsB.map((p, i) => (
            <circle
              key={`b-dot-${i}`}
              cx={p.x} cy={p.y}
              r={hoveredPoint?.month === p.month && hoveredPoint?.series === 'B' ? 7 : 5}
              fill={seriesBConfig.color}
              stroke="white"
              strokeWidth="2"
              className="cursor-pointer"
              onMouseEnter={(e) => handleMouseEnter(e, p, 'B')}
            />
          ))}

          {/* Tooltip */}
          {hoveredPoint && (() => {
            const tooltipW = 240, tooltipH = 96;
            let tx = mousePos.x + 15, ty = mousePos.y - 48;
            if (tx + tooltipW > 980) tx = mousePos.x - tooltipW - 15;
            if (ty < 15) ty = mousePos.y + 15;
            if (ty + tooltipH > 480) ty = mousePos.y - tooltipH - 15;

            const [year, month] = hoveredPoint.month.split('-').map(Number);
            const monthName = `${MONTH_NAMES_SV[month - 1]} ${year}`;

            const dataPoint = data.find(d => d.month === hoveredPoint.month);
            const valA = dataPoint?.seriesA;
            const valB = dataPoint?.seriesB;

            return (
              <g>
                <rect x={tx} y={ty} width={tooltipW} height={tooltipH} fill="rgba(0,0,0,0.85)" rx="6" />
                <text x={tx + 12} y={ty + 20} fill="white" fontSize="13" fontWeight="bold">{monthName}</text>
                <circle cx={tx + 16} cy={ty + 38} r="5" fill={seriesAConfig.color} />
                <text x={tx + 26} y={ty + 42} fill="white" fontSize="12">
                  {seriesAConfig.label}: {valA !== null && valA !== undefined ? valA.toLocaleString('sv-SE') : '–'}
                </text>
                <circle cx={tx + 16} cy={ty + 60} r="5" fill={seriesBConfig.color} />
                <text x={tx + 26} y={ty + 64} fill="white" fontSize="12">
                  {seriesBConfig.label}: {valB !== null && valB !== undefined ? valB.toLocaleString('sv-SE') : '–'}
                </text>
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
};

export default ComparisonChart;
