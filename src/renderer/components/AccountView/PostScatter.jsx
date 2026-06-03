/**
 * PostScatter — fristående SVG-punktdiagram för inlägg per konto.
 * Visar räckvidd (Y) mot publiceringsdatum (X) med golv-linje och viral-tröskel.
 * Ingen extern styling, ingen Chart.js — ren SVG.
 */
import React, { useState } from 'react';

// Svenska månadsförkortningar
const MONTH_NAMES_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Plot-area-koordinater
const X_LEFT = 70;
const X_RIGHT = 930;
const Y_TOP = 70;
const Y_BOTTOM = 450;
const PLOT_WIDTH = X_RIGHT - X_LEFT;   // 860
const PLOT_HEIGHT = Y_BOTTOM - Y_TOP;  // 380

/**
 * Beräknar snygga y-axel-tick-värden utifrån ett maxvärde.
 * Anpassad från TrendAnalysisView.
 */
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

/**
 * Väljer ~5–7 jämnt fördelade x-ticks ur ett tidsintervall.
 * Returnerar array av ms-timestamps.
 */
const pickXTicks = (xMin, xMax, count = 6) => {
  if (xMin >= xMax) return [xMin];
  const step = (xMax - xMin) / (count - 1);
  const result = [];
  for (let i = 0; i < count; i++) result.push(Math.round(xMin + i * step));
  return result;
};

/**
 * Formaterar en ms-timestamp till svensk datumetikett: "15 jan".
 */
const formatDateLabel = (ms) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTH_NAMES_SV[d.getMonth()]}`;
};

/**
 * Skalar ett ms-värde till SVG-x-koordinat.
 */
const toSvgX = (ms, xMin, xMax) => {
  if (xMax === xMin) return (X_LEFT + X_RIGHT) / 2;
  return X_LEFT + ((ms - xMin) / (xMax - xMin)) * PLOT_WIDTH;
};

/**
 * Skalar ett reach-värde till SVG-y-koordinat.
 * Y_TOP = max, Y_BOTTOM = 0.
 */
const toSvgY = (value, yMin, yMax) => {
  if (yMax === yMin) return (Y_TOP + Y_BOTTOM) / 2;
  return Y_BOTTOM - ((value - yMin) / (yMax - yMin)) * PLOT_HEIGHT;
};

/**
 * Trunkerar en sträng till max `maxLen` tecken, lägger till "…" vid behov.
 */
const truncate = (str, maxLen = 60) => {
  if (!str) return '—';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
};

/**
 * PostScatter
 *
 * Props:
 *   points      – array av { date: number (ms), reach: number, viral: boolean,
 *                             postType: string|null, description: string|null }
 *   floorPoints – array av { date: number (ms), median: number }, sorterad stigande
 *   threshold   – number|undefined  (viral-tröskel för horisontell linje)
 *   xMin        – number|undefined  (ms, vänster kant på x-axeln)
 *   xMax        – number|undefined  (ms, höger kant på x-axeln)
 */
const PostScatter = ({ points = [], floorPoints = [], threshold, xMin, xMax }) => {
  const [hovered, setHovered] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // ── Tomt läge ──────────────────────────────────────────────────────────────
  if (!points || points.length === 0) {
    return (
      <svg
        width="100%"
        height="500"
        viewBox="0 0 1000 500"
        className="border rounded bg-gray-50"
      >
        <rect width="100%" height="100%" fill="#f9fafb" />
        <text
          x="500"
          y="260"
          textAnchor="middle"
          fontSize="18"
          fill="#6b7280"
          fontFamily="sans-serif"
        >
          Inga inlägg att visa
        </text>
      </svg>
    );
  }

  // ── Beräkna axelgränser ────────────────────────────────────────────────────
  const allDates = [
    ...points.map(p => p.date),
    ...floorPoints.map(fp => fp.date),
  ];
  const derivedXMin = Math.min(...allDates);
  const derivedXMax = Math.max(...allDates);

  const resolvedXMin = xMin !== undefined ? xMin : derivedXMin;
  const resolvedXMax = xMax !== undefined ? xMax : derivedXMax;

  // niceMax täcker max reach OCH threshold (så tröskellinjen ryms)
  const maxReach = Math.max(...points.map(p => p.reach), 0);
  const thresholdForY = threshold !== undefined ? threshold : 0;
  const rawYMax = Math.max(maxReach, thresholdForY);
  const { min: yMin, max: yMax, ticks: yTicks } = calculateNiceYAxis(rawYMax);

  // ── X-ticks ────────────────────────────────────────────────────────────────
  const xTicks = pickXTicks(resolvedXMin, resolvedXMax, 6);

  // ── Golv-polyline-punkter ──────────────────────────────────────────────────
  const floorSvgPoints = floorPoints.map(fp => ({
    x: toSvgX(fp.date, resolvedXMin, resolvedXMax),
    y: toSvgY(fp.median, yMin, yMax),
    date: fp.date,
    median: fp.median,
  }));

  const floorPolylineStr = floorSvgPoints
    .map(p => `${p.x},${p.y}`)
    .join(' ');

  // ── Tröskellinje y-koordinat ───────────────────────────────────────────────
  const thresholdY = threshold !== undefined ? toSvgY(threshold, yMin, yMax) : null;

  // ── Mouse-handler (SVG-koordinater via getBoundingClientRect) ──────────────
  const handleMouseEnter = (e, point) => {
    const rect = e.currentTarget.closest('svg').getBoundingClientRect();
    // Konvertera till SVG-koordinater (viewBox 1000×500 → faktisk storlek)
    const scaleX = 1000 / rect.width;
    const scaleY = 500 / rect.height;
    setMousePos({
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    });
    setHovered(point);
  };

  const handleMouseLeave = () => setHovered(null);

  // ── Tooltip ────────────────────────────────────────────────────────────────
  const TOOLTIP_W = 260;
  const TOOLTIP_H = 110;

  const renderTooltip = () => {
    if (!hovered) return null;
    let tx = mousePos.x + 18;
    let ty = mousePos.y - 55;
    if (tx + TOOLTIP_W > 985) tx = mousePos.x - TOOLTIP_W - 18;
    if (ty < 10) ty = mousePos.y + 18;
    if (ty + TOOLTIP_H > 485) ty = mousePos.y - TOOLTIP_H - 18;

    const d = new Date(hovered.date);
    const datumStr = d.toLocaleDateString('sv-SE');
    const typStr = hovered.postType || '—';
    const reachStr = hovered.reach.toLocaleString('sv-SE');
    const descStr = truncate(hovered.description, 60);

    return (
      <g>
        <rect
          x={tx}
          y={ty}
          width={TOOLTIP_W}
          height={TOOLTIP_H}
          fill="rgba(0,0,0,0.85)"
          rx="6"
        />
        <text x={tx + 12} y={ty + 22} fill="white" fontSize="13" fontWeight="bold" fontFamily="sans-serif">
          {datumStr}
        </text>
        <text x={tx + 12} y={ty + 40} fill="#d1d5db" fontSize="12" fontFamily="sans-serif">
          Typ: {typStr}
        </text>
        <text x={tx + 12} y={ty + 57} fill="white" fontSize="12" fontFamily="sans-serif">
          Räckvidd: {reachStr}
        </text>
        <text x={tx + 12} y={ty + 74} fill="#d1d5db" fontSize="11" fontFamily="sans-serif">
          {descStr}
        </text>
        {hovered.viral && (
          <text x={tx + 12} y={ty + 92} fill="#f97316" fontSize="11" fontWeight="bold" fontFamily="sans-serif">
            Viralt inlägg
          </text>
        )}
      </g>
    );
  };

  // ── Legend ─────────────────────────────────────────────────────────────────
  // Placeras uppe till vänster i diagrammet, ovanför plot-ytan
  const renderLegend = () => (
    <g fontFamily="sans-serif">
      {/* Blå punkt – Inlägg */}
      <circle cx={X_LEFT} cy={32} r={4} fill="#2563EB" stroke="white" strokeWidth="1.5" />
      <text x={X_LEFT + 12} y={36} fill="#374151" fontSize="12">Inlägg</text>

      {/* Orange punkt – Viral */}
      <circle cx={X_LEFT + 75} cy={32} r={5} fill="#f97316" stroke="white" strokeWidth="1.5" />
      <text x={X_LEFT + 90} y={36} fill="#374151" fontSize="12">Viral</text>

      {/* Streckad linje – Golv */}
      <line
        x1={X_LEFT + 150}
        y1={32}
        x2={X_LEFT + 180}
        y2={32}
        stroke="#475569"
        strokeWidth="2"
        strokeDasharray="6 4"
      />
      <text x={X_LEFT + 186} y={36} fill="#374151" fontSize="12">Golv (veckomedian)</text>
    </g>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <svg
      width="100%"
      height="500"
      viewBox="0 0 1000 500"
      className="border rounded bg-gray-50"
      onMouseLeave={handleMouseLeave}
    >
      {/* Grid-bakgrund */}
      <defs>
        <pattern id="scatter-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#scatter-grid)" />

      {/* Legend */}
      {renderLegend()}

      {/* ── Y-axel ticks och gridlinjer ── */}
      {yTicks.map(tickValue => {
        const yPos = toSvgY(tickValue, yMin, yMax);
        return (
          <g key={tickValue}>
            <line
              x1={X_LEFT}
              y1={yPos}
              x2={X_RIGHT}
              y2={yPos}
              stroke="#d1d5db"
              strokeWidth="1"
            />
            <text
              x={X_LEFT - 5}
              y={yPos + 4}
              textAnchor="end"
              fontSize="14"
              fill="#6b7280"
              fontFamily="sans-serif"
            >
              {tickValue.toLocaleString('sv-SE')}
            </text>
          </g>
        );
      })}

      {/* ── X-axel ticks och gridlinjer ── */}
      {xTicks.map((ms, i) => {
        const xPos = toSvgX(ms, resolvedXMin, resolvedXMax);
        return (
          <g key={i}>
            <line
              x1={xPos}
              y1={Y_TOP}
              x2={xPos}
              y2={Y_BOTTOM}
              stroke="#d1d5db"
              strokeWidth="1"
            />
            <text
              x={xPos}
              y={Y_BOTTOM + 20}
              textAnchor="middle"
              fontSize="14"
              fill="#6b7280"
              fontFamily="sans-serif"
            >
              {formatDateLabel(ms)}
            </text>
          </g>
        );
      })}

      {/* ── Viral-tröskel (horisontell streckad linje) ── */}
      {threshold !== undefined && thresholdY !== null && (
        <g>
          <line
            x1={X_LEFT}
            y1={thresholdY}
            x2={X_RIGHT}
            y2={thresholdY}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <text
            x={X_RIGHT + 4}
            y={thresholdY + 4}
            fontSize="11"
            fill="#f59e0b"
            fontFamily="sans-serif"
          >
            Viral-tröskel
          </text>
        </g>
      )}

      {/* ── Golv-polyline (veckomedian) ── */}
      {floorSvgPoints.length >= 2 && (
        <polyline
          points={floorPolylineStr}
          stroke="#475569"
          strokeWidth="2"
          strokeDasharray="6 4"
          fill="none"
        />
      )}
      {/* Valfria små markörer på varje veckoveckopunkt */}
      {floorSvgPoints.map((fp, i) => (
        <circle
          key={i}
          cx={fp.x}
          cy={fp.y}
          r="3"
          fill="#475569"
          opacity="0.6"
        />
      ))}

      {/* ── Inläggspunkter ── */}
      {points.map((p, i) => {
        const cx = toSvgX(p.date, resolvedXMin, resolvedXMax);
        const cy = toSvgY(p.reach, yMin, yMax);
        const isViral = p.viral === true;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={isViral ? 5 : 4}
            fill={isViral ? '#f97316' : '#2563EB'}
            stroke="white"
            strokeWidth="1.5"
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => handleMouseEnter(e, p)}
          />
        );
      })}

      {/* ── Tooltip ── */}
      {renderTooltip()}
    </svg>
  );
};

export default PostScatter;
