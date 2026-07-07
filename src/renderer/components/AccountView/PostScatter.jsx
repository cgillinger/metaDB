/**
 * PostScatter — fristående SVG-punktdiagram för inlägg per konto.
 * Visar räckvidd (Y) mot publiceringsdatum (X) med golv-linje och viral-tröskel.
 * Ingen extern styling, ingen Chart.js — ren SVG.
 */
import React, { useState } from 'react';
import { calculateNiceYAxis } from '@/utils/chartAxis';

// Svenska månadsförkortningar
const MONTH_NAMES_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

// Plot-area-koordinater
const X_LEFT = 90;
const X_RIGHT = 930;
const Y_TOP = 70;
const Y_BOTTOM = 450;
const PLOT_WIDTH = X_RIGHT - X_LEFT;   // 860
const PLOT_HEIGHT = Y_BOTTOM - Y_TOP;  // 380

// Max antal x-ticks innan vi glesar ut till varannan/var tredje månad.
const X_TICK_TARGET = 24;

/**
 * Bygger x-ticks på månadsgränser (den 1:a varje månad) inom tidsintervallet.
 * Strecken ligger exakt en månad isär; vid mycket långa spann glesas de ut
 * jämnt (var 2:a/3:e månad) så etiketterna inte krockar.
 * Returnerar [{ ms, month, year, showYear }]. showYear=true vid januari, första
 * ticken och varje årsbyte – så att årsskiftet alltid framgår.
 */
const buildMonthTicks = (xMin, xMax) => {
  if (!(xMax > xMin)) {
    const d = new Date(xMin);
    return [{ ms: xMin, month: d.getMonth(), year: d.getFullYear(), showYear: true }];
  }
  const first = new Date(xMin);
  let y = first.getFullYear();
  let m = first.getMonth();
  // Hoppa till nästa månadsstart om xMin inte redan ligger på den 1:a kl 00:00.
  const onMonthStart =
    first.getDate() === 1 && first.getHours() === 0 &&
    first.getMinutes() === 0 && first.getSeconds() === 0;
  if (!onMonthStart) { m += 1; if (m > 11) { m -= 12; y += 1; } }

  const starts = [];
  for (let t = new Date(y, m, 1).getTime(); t <= xMax; ) {
    starts.push(t);
    m += 1; if (m > 11) { m -= 12; y += 1; }
    t = new Date(y, m, 1).getTime();
  }
  if (starts.length === 0) starts.push(xMin);

  const step = Math.max(1, Math.ceil(starts.length / X_TICK_TARGET));
  const ticks = [];
  let prevYear = null;
  for (let i = 0; i < starts.length; i += step) {
    const d = new Date(starts[i]);
    const year = d.getFullYear();
    const showYear = i === 0 || d.getMonth() === 0 || year !== prevYear;
    prevYear = year;
    ticks.push({ ms: starts[i], month: d.getMonth(), year, showYear });
  }
  return ticks;
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
const PostScatter = ({ points = [], floorPoints = [], threshold, xMin, xMax, floorLabel }) => {
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
  const xTicks = buildMonthTicks(resolvedXMin, resolvedXMax);

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
        stroke="#334155"
        strokeWidth="3"
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
              x={X_LEFT - 8}
              y={yPos + 4}
              textAnchor="end"
              fontSize="13"
              fill="#6b7280"
              fontFamily="sans-serif"
            >
              {tickValue.toLocaleString('sv-SE')}
            </text>
          </g>
        );
      })}

      {/* ── X-axel ticks och gridlinjer (månadsgränser) ── */}
      {xTicks.map((tick, i) => {
        const xPos = toSvgX(tick.ms, resolvedXMin, resolvedXMax);
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
              fontSize="13"
              fill="#6b7280"
              fontFamily="sans-serif"
            >
              {MONTH_NAMES_SV[tick.month]}
            </text>
            {tick.showYear && (
              <text
                x={xPos}
                y={Y_BOTTOM + 36}
                textAnchor="middle"
                fontSize="12"
                fontWeight="bold"
                fill="#374151"
                fontFamily="sans-serif"
              >
                {tick.year}
              </text>
            )}
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

      {/* ── Y-axeltitel: tydliggör att varje punkts värde är räckvidd ── */}
      <text
        x={20}
        y={(Y_TOP + Y_BOTTOM) / 2}
        textAnchor="middle"
        fontSize="14"
        fontWeight="bold"
        fill="#374151"
        fontFamily="sans-serif"
        transform={`rotate(-90 20 ${(Y_TOP + Y_BOTTOM) / 2})`}
      >
        Räckvidd
      </text>

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

      {/* ── Golv-polyline (veckomedian) — ritas ÖVER punkterna med vit halo ── */}
      {floorSvgPoints.length >= 2 && (
        <>
          {/* Vit halo så den streckade linjen läses mot täta punktmoln */}
          <polyline
            points={floorPolylineStr}
            stroke="white"
            strokeWidth="6"
            strokeLinejoin="round"
            fill="none"
            opacity="0.85"
          />
          <polyline
            points={floorPolylineStr}
            stroke="#334155"
            strokeWidth="3"
            strokeDasharray="6 4"
            fill="none"
          />
        </>
      )}
      {/* Markörer på varje veckopunkt (vit kant för kontrast) */}
      {floorSvgPoints.map((fp, i) => (
        <circle
          key={i}
          cx={fp.x}
          cy={fp.y}
          r="3.5"
          fill="#334155"
          stroke="white"
          strokeWidth="1.5"
        />
      ))}
      {/* Golv-etikett vid linjens slut — identifierbar även i linjär skala */}
      {floorLabel && floorSvgPoints.length >= 1 && (() => {
        const last = floorSvgPoints[floorSvgPoints.length - 1];
        const ly = Math.min(Math.max(last.y - 8, Y_TOP + 12), Y_BOTTOM - 4);
        return (
          <text
            x={X_RIGHT - 6}
            y={ly}
            textAnchor="end"
            fontSize="12"
            fontWeight="bold"
            fill="#334155"
            stroke="white"
            strokeWidth="3"
            paintOrder="stroke"
            fontFamily="sans-serif"
          >
            {floorLabel}
          </text>
        );
      })()}

      {/* ── Tooltip ── */}
      {renderTooltip()}
    </svg>
  );
};

export default PostScatter;
