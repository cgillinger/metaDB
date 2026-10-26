import React, { useState } from 'react';
import { distinctBreakpointIndexes } from '../TrendAnalysisView/splicedLine.js';
import { niceYAxis, ctSegments, isCtYearSource, CT_YEAR_SOURCE_LABEL, ctYearNotes } from './ctChart.js';

const X0 = 70, X1 = 930, Y_TOP = 70, Y_BOTTOM = 450, X_PAD = 30;

/**
 * Yearly CrowdTangle/metaDB chart: one line per account, a marker per year.
 * Every point has exactly one source; gaps (null) break the line.
 */
export default function YearlyChart({ years, lines, metricLabel, showMetadbLegend }) {
  const [hover, setHover] = useState(null);
  const yAxis = niceYAxis(lines.flatMap(l => l.data.map(d => d.value)));
  const n = years.length;
  const xOf = (i) => (n === 1 ? (X0 + X1) / 2 : X0 + X_PAD + (i / (n - 1)) * (X1 - X0 - 2 * X_PAD));
  const yOf = (v) => Y_BOTTOM - (v / yAxis.max) * (Y_BOTTOM - Y_TOP);
  const labelEvery = n > 14 ? 2 : 1;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 4" strokeOpacity="0.45" /></svg>
          CrowdTangle (summa av 12 månader eller helårsexport)
        </span>
        {showMetadbLegend && (
          <span className="flex items-center gap-1.5">
            <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" /></svg>
            metaDB
          </span>
        )}
        {showMetadbLegend && (
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="white" stroke="currentColor" strokeWidth="2" /></svg>
            Ofullständigt år (hittills i år eller saknade månader)
          </span>
        )}
      </div>

      <svg width="100%" viewBox="0 0 1000 500" className="border rounded bg-gray-50"
        role="img" aria-label={`${metricLabel} per år, ${lines.map(l => l.account_name).join(', ')}`}
        onMouseLeave={() => setHover(null)}>
        {yAxis.ticks.map(t => (
          <g key={t}>
            <line x1={X0} y1={yOf(t)} x2={X1} y2={yOf(t)} stroke="#d1d5db" strokeWidth="1" />
            <text x={X0 - 5} y={yOf(t) + 4} textAnchor="end" fontSize="14" fill="#6b7280">{t.toLocaleString('sv-SE')}</text>
          </g>
        ))}
        {years.map((y, i) => (i % labelEvery === 0 ? (
          <g key={y}>
            <line x1={xOf(i)} y1={Y_BOTTOM} x2={xOf(i)} y2={Y_BOTTOM + 5} stroke="#9ca3af" />
            <text x={xOf(i)} y={Y_BOTTOM + 22} textAnchor="middle" fontSize="13" fill="#6b7280">{y}</text>
          </g>
        ) : null))}

        {lines.map(line => {
          const pts = line.data.map((d, i) => ({ x: xOf(i), y: d.value === null ? null : yOf(d.value), d, year: years[i] }));
          return (
            <g key={line.account_key}>
              {ctSegments(pts).map((seg, si) => {
                const ct = isCtYearSource(seg.source);
                return (
                  <line key={si} x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke={line.color}
                    strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={ct ? '7 4' : undefined} strokeOpacity={ct ? 0.45 : 1} />
                );
              })}
              {pts.filter(p => p.y !== null).map(p => {
                const ct = isCtYearSource(p.d.source);
                const hollow = p.d.partial || p.d.incomplete;
                return (
                  <circle key={p.year} cx={p.x} cy={p.y} r="6"
                    fill={hollow ? 'white' : line.color} fillOpacity={ct && !hollow ? 0.45 : 1}
                    stroke={hollow ? line.color : 'white'} strokeWidth={hollow ? 2.5 : 1.5}
                    className="cursor-pointer"
                    onMouseEnter={() => setHover({ x: p.x, y: p.y, year: p.year, d: p.d, name: line.account_name })} />
                );
              })}
            </g>
          );
        })}

        {distinctBreakpointIndexes(lines, years).map((i, k) => {
          // The line sits half-way between the last CrowdTangle year and the first metaDB year.
          const x = (xOf(i - 1) + xOf(i)) / 2;
          const right = x > 800;
          return (
            <g key={`bp-${i}`}>
              <line x1={x} y1={Y_TOP} x2={x} y2={Y_BOTTOM} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 4" />
              {k === 0 && <text x={right ? x - 5 : x + 5} y={Y_TOP + 12} textAnchor={right ? 'end' : 'start'} fontSize="11" fill="#6b7280">Källbyte</text>}
            </g>
          );
        })}

        {hover && (() => {
          const notes = ctYearNotes(hover.d);
          const w = 330, h = 90 + notes.length * 18;
          let tx = hover.x + 15, ty = hover.y - 45;
          if (tx + w > 990) tx = hover.x - w - 15;
          if (ty < 10) ty = hover.y + 15;
          if (ty + h > 490) ty = hover.y - h - 15;
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width={w} height={h} fill="rgba(0,0,0,0.85)" rx="6" />
              <text x={tx + 12} y={ty + 20} fill="white" fontSize="13" fontWeight="bold">{hover.name}</text>
              <text x={tx + 12} y={ty + 38} fill="white" fontSize="12">{hover.year}</text>
              <text x={tx + 12} y={ty + 58} fill="white" fontSize="14" fontWeight="bold">{metricLabel}: {hover.d.value.toLocaleString('sv-SE')}</text>
              <text x={tx + 12} y={ty + 76} fill="#d1d5db" fontSize="11">Källa: {CT_YEAR_SOURCE_LABEL[hover.d.source]}</text>
              {notes.map((t, i) => <text key={i} x={tx + 12} y={ty + 94 + i * 18} fill="#fbbf24" fontSize="11">{t}</text>)}
            </g>
          );
        })()}
      </svg>
    </>
  );
}
