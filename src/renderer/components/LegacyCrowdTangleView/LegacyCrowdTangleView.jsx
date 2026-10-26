import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { api } from '@/utils/apiClient';
import { distinctBreakpointIndexes, ghostRuns } from '../TrendAnalysisView/splicedLine.js';
import YearlyChart from './YearlyChart.jsx';
import { niceYAxis, ctMonthLabel, ctSegments, CT_SOURCE_LABEL, ctLegendEntries, selectedFirst } from './ctChart.js';

const PLATFORMS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter' },
];
const METRICS = [
  { value: 'interactions', label: 'Interaktioner' },
  { value: 'posts', label: 'Antal inlägg' },
];
const COLORS = [
  '#2563EB', '#16A34A', '#EAB308', '#DC2626', '#7C3AED', '#EA580C',
  '#0891B2', '#BE185D', '#059669', '#7C2D12', '#4338CA', '#C2410C',
];
const MAX_SELECTED = 12;
const FIRST_YEAR = 2018;
const FIRST_YEAR_YEARLY = 2014;
const X0 = 70, X1 = 930, Y_TOP = 70, Y_BOTTOM = 450;

const selectClass = 'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm';

/** One swatch + name per selected account, in series order. */
function AccountLegend({ lines }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-label="Konton i diagrammet">
      {ctLegendEntries(lines).map(e => (
        <li key={e.key} className={`flex items-center gap-1.5 ${e.empty ? 'text-muted-foreground' : ''}`}>
          <span className="inline-block w-4 h-1 rounded" style={{ backgroundColor: e.empty ? '#9ca3af' : e.color }} />
          {e.name}{e.empty && ' (ingen data i perioden)'}
        </li>
      ))}
    </ul>
  );
}

export default function LegacyCrowdTangleView() {
  const currentYear = new Date().getFullYear();
  const [platform, setPlatform] = useState('facebook');
  const [metric, setMetric] = useState('interactions');
  const [fromYear, setFromYear] = useState(FIRST_YEAR);
  const [toYear, setToYear] = useState(currentYear);
  const [view, setView] = useState('month'); // 'month' | 'year'
  const [yFromYear, setYFromYear] = useState(FIRST_YEAR_YEARLY);
  const [yToYear, setYToYear] = useState(currentYear);
  const [yData, setYData] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(null);

  // Load the account list when the platform changes; preselect the account with the longest history.
  useEffect(() => {
    let cancelled = false;
    setAccounts([]); setSelected([]); setData(null); setYData(null); setError(null); setSearch('');
    api.getCtAccounts(platform).then(res => {
      if (cancelled) return;
      setAccounts(res.accounts);
      const best = [...res.accounts].sort((a, b) =>
        (b.has_metadb - a.has_metadb) || ((b.ct_months + b.ct_years) - (a.ct_months + a.ct_years)))[0];
      if (best) setSelected([best.account_key]);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [platform]);

  useEffect(() => {
    if (view !== 'month') return undefined;
    if (!selected.length) { setData(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(null);
    const params = {
      platform, metric, accounts: selected.join(','), from: `${fromYear}-01`,
    };
    if (toYear < currentYear) params.to = `${toYear}-12`;
    api.getCtSeries(params).then(res => { if (!cancelled) setData(res); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, platform, metric, selected, fromYear, toYear, currentYear]);

  useEffect(() => {
    if (view !== 'year') return undefined;
    if (!selected.length) { setYData(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true); setError(null);
    api.getCtYearly({ platform, metric, accounts: selected.join(','), from: String(yFromYear), to: String(yToYear) })
      .then(res => { if (!cancelled) setYData(res); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, platform, metric, selected, yFromYear, yToYear]);

  const isYear = view === 'year';
  const firstSelectable = isYear ? FIRST_YEAR_YEARLY : FIRST_YEAR;
  const years = useMemo(() => Array.from({ length: currentYear - firstSelectable + 1 }, (_, i) => firstSelectable + i), [currentYear, firstSelectable]);
  const curFrom = isYear ? yFromYear : fromYear, curTo = isYear ? yToYear : toYear;
  const setCurFrom = isYear ? setYFromYear : setFromYear, setCurTo = isYear ? setYToYear : setToYear;
  const needle = search.trim().toLocaleLowerCase('sv-SE');
  const visibleAccounts = useMemo(() => {
    const list = accounts
      .filter(a => isYear || a.ct_months > 0) // yearly-only accounts have no monthly curve
      .filter(a => !needle || a.account_name.toLocaleLowerCase('sv-SE').includes(needle))
      .sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
    return needle ? list : selectedFirst(list, selected);
  }, [accounts, needle, isYear, selected]);
  const colorOf = (key) => COLORS[selected.indexOf(key) % COLORS.length];
  const selectedAccounts = selected.map(k => accounts.find(a => a.account_key === k)).filter(Boolean);

  const toggle = (key) => setSelected(prev =>
    prev.includes(key) ? prev.filter(k => k !== key) : (prev.length >= MAX_SELECTED ? prev : [...prev, key]));

  const months = data?.months ?? [];
  const lines = useMemo(() => (data?.series ?? []).map((s, i) => ({
    ...s, breakpointMonth: s.breakpoint_month, color: COLORS[selected.indexOf(s.account_key) % COLORS.length] ?? COLORS[i % COLORS.length],
  })), [data, selected]);

  const gapMonths = useMemo(() => new Set(lines.flatMap(l => l.data.map((d, i) => (d.gap ? months[i] : null))).filter(Boolean)), [lines, months]);
  const yAxis = useMemo(() => niceYAxis(lines.flatMap(l => l.data.flatMap(d => [d.value, d.ghost]))), [lines]);
  const xOf = (i) => X0 + (i / Math.max(1, months.length - 1)) * (X1 - X0);
  const yOf = (v) => Y_BOTTOM - (v / yAxis.max) * (Y_BOTTOM - Y_TOP);
  const yearLines = useMemo(() => (yData?.series ?? []).map((s, i) => ({
    ...s, breakpointMonth: s.breakpoint_year, color: COLORS[selected.indexOf(s.account_key) % COLORS.length] ?? COLORS[i % COLORS.length],
  })), [yData, selected]);
  const metricLabel = METRICS.find(m => m.value === metric).label;
  const hasMetadbSide = platform !== 'twitter';

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
          <h3 className="text-lg font-semibold">Legacy CrowdTangle</h3>
          <p className="text-muted-foreground">
            Här finns historiken från 2014 till 2024, innan appen fick egna inläggsdata (månadsvyn börjar 2018, årsvyn 2014). Siffrorna är
            <strong> månads- eller årssummor per konto från CrowdTangle</strong>, inte enskilda inlägg. Det finns ingen räckvidd i
            det här materialet.
          </p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>Facebook-interaktioner är reaktioner + kommentarer + delningar, samma som i metaDB.</li>
            <li>Instagram-interaktioner är gilla + kommentarer. Därför räknas metaDB-delen likadant här.</li>
            <li>Reels saknas i CrowdTangle från 2022.</li>
            <li>
              Där kurvan går över från CrowdTangle till metaDB visas en markering, <strong>Källbyte</strong>. Nivån kan hoppa
              där. Vid mätningen i januari 2024 låg CrowdTangle ungefär 13 % lägre för Facebook, främst för att exporten
              togs tidigt. Kurvan visar alltså formen över tid, inte exakt nivå tvärs bytet.
            </li>
            <li>Siffrorna finns bara i den här fliken och ingår inte i totaler eller exporter.</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="text-sm space-y-1 block">
              <span className="block font-medium">Visa</span>
              <div className="inline-flex h-10 rounded-md border border-input overflow-hidden" role="group" aria-label="Visa per månad eller per år">
                {[['month', 'Per månad'], ['year', 'Per år']].map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                    className={`px-3 text-sm cursor-pointer ${view === v ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-sm space-y-1 block">
              <span className="block font-medium">Kanal</span>
              <select className={selectClass} value={platform} onChange={e => setPlatform(e.target.value)}>
                {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1 block">
              <span className="block font-medium">Mått</span>
              <select className={selectClass} value={metric} onChange={e => setMetric(e.target.value)}>
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1 block">
              <span className="block font-medium">Från år</span>
              <select className={selectClass} value={curFrom}
                onChange={e => { const v = Number(e.target.value); setCurFrom(v); if (v > curTo) setCurTo(v); }}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="text-sm space-y-1 block">
              <span className="block font-medium">Till år</span>
              <select className={selectClass} value={curTo}
                onChange={e => { const v = Number(e.target.value); setCurTo(v); if (v < curFrom) setCurFrom(v); }}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Konton ({selected.length} valda, högst {MAX_SELECTED})</span>
              {selected.length > 0 && (
                <button className="text-xs underline text-muted-foreground cursor-pointer" onClick={() => setSelected([])}>Rensa val</button>
              )}
            </div>
            {selectedAccounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" aria-label="Valda konton">
                <span className="text-xs font-medium">Valda konton:</span>
                {selectedAccounts.map(a => (
                  <span key={a.account_key} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 pl-2 pr-1 py-0.5 text-xs">
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorOf(a.account_key) }} />
                    {a.account_name}
                    <button type="button" aria-label={`Ta bort ${a.account_name}`} onClick={() => toggle(a.account_key)}
                      className="rounded-full px-1.5 text-sm leading-none text-muted-foreground hover:bg-muted cursor-pointer">×</button>
                  </span>
                ))}
              </div>
            )}
            <Input placeholder="Sök konto" value={search} onChange={e => setSearch(e.target.value)} aria-label="Sök konto" />
            <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
              {visibleAccounts.length === 0 && <div className="p-3 text-sm text-muted-foreground">Inga konton hittades.</div>}
              {visibleAccounts.map(a => {
                const on = selected.includes(a.account_key);
                const colorIdx = selected.indexOf(a.account_key);
                return (
                  <label key={a.account_key} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
                    <input type="checkbox" checked={on} onChange={() => toggle(a.account_key)}
                      disabled={!on && selected.length >= MAX_SELECTED} />
                    {on && <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[colorIdx % COLORS.length] }} />}
                    <span className="flex-1">
                      {a.account_name}
                      {/* CT has no stable id for IG/Twitter — a handle change splits the series, so show the handle to tell same-named rows apart */}
                      {platform !== 'facebook' && <span className="ml-1 text-xs text-muted-foreground">@{a.account_key}</span>}
                      {a.former_names?.length > 0 && (
                        <span className="block text-xs text-muted-foreground">Hette tidigare: {a.former_names.join(', ')}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isYear ? a.first_year : a.first_month.slice(0, 4)}–{isYear ? a.last_year : (a.has_metadb ? a.last_year : a.last_month.slice(0, 4))}{hasMetadbSide && !a.has_metadb ? ' · endast CrowdTangle' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-3">
          {error && <div className="text-sm text-red-600" role="alert">Kunde inte hämta data: {error}</div>}
          {!error && selected.length === 0 && <p className="text-sm text-muted-foreground">Välj ett eller flera konton för att se kurvan.</p>}
          {loading && <p className="text-sm text-muted-foreground">Hämtar data…</p>}

          {isYear && yearLines.length > 0 && (yData?.years ?? []).length > 0 && (
            <>
              <AccountLegend lines={yearLines} />
              <YearlyChart years={yData.years} lines={yearLines} metricLabel={metricLabel} showMetadbLegend={hasMetadbSide} />
              <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                <li>Varje år kommer från <strong>en enda källa</strong>: metaDB där appen har ett helt år, annars CrowdTangle. Källorna summeras eller räknas aldrig ihop. Håll muspekaren över en punkt för att se vilken källa den kommer från.</li>
                <li>CrowdTangle mätte aldrig räckvidd, så måttet finns bara som interaktioner och antal inlägg.</li>
                <li>CrowdTangle-exporterna togs strax efter periodens slut, så CrowdTangle-nivåerna ligger något lägre än metaDB (ungefär 13 % för Facebook vid mätningen i januari 2024). Jämför formen över tid, inte exakt nivå tvärs Källbyte.</li>
                <li>2020 saknas för de flesta konton eftersom exporterna för januari och februari 2020 saknas. Undantaget är P4-lokalkanalerna, som har en helårsexport för 2020.</li>
                <li>Instagram räknar bara gilla-markeringar och kommentarer.</li>
                <li>Det pågående året visas med ihålig markering och är bara värdet hittills i år.</li>
                <li>Ihåliga punkter med saknade månader beror på att månader saknas i Metas exportfiler (se Importhantering → Öppna luckor). Årssumman är då för låg.</li>
              </ul>
              {platform === 'twitter' && (
                <p className="text-xs text-muted-foreground">Twitter finns bara i CrowdTangle-materialet (2014–2018). Appen har ingen egen Twitter-data.</p>
              )}
            </>
          )}
          {isYear && !loading && !error && selected.length > 0 && yData && yearLines.length === 0 && (
            <p className="text-sm text-muted-foreground">Inga årsvärden hittades för valda konton.</p>
          )}

          {!isYear && lines.length > 0 && months.length > 0 && (
            <>
              <AccountLegend lines={lines} />
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 4" strokeOpacity="0.45" /></svg>
                  CrowdTangle
                </span>
                {hasMetadbSide && (
                  <span className="flex items-center gap-1.5">
                    <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2.5" /></svg>
                    metaDB
                  </span>
                )}
                {hasMetadbSide && (
                  <span className="flex items-center gap-1.5">
                    <svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 3" strokeOpacity="0.35" /></svg>
                    CrowdTangle samma månad, där metaDB-data finns
                  </span>
                )}
              </div>

              <svg width="100%" viewBox="0 0 1000 500" className="border rounded bg-gray-50"
                role="img" aria-label={`${metricLabel} per månad, ${lines.map(l => l.account_name).join(', ')}`}
                onMouseLeave={() => setHover(null)}>
                {yAxis.ticks.map(t => (
                  <g key={t}>
                    <line x1={X0} y1={yOf(t)} x2={X1} y2={yOf(t)} stroke="#d1d5db" strokeWidth="1" />
                    <text x={X0 - 5} y={yOf(t) + 4} textAnchor="end" fontSize="14" fill="#6b7280">{t.toLocaleString('sv-SE')}</text>
                  </g>
                ))}
                {months.map((m, i) => (m.endsWith('-01') ? (
                  <g key={m}>
                    <line x1={xOf(i)} y1={Y_BOTTOM} x2={xOf(i)} y2={Y_BOTTOM + 5} stroke="#9ca3af" />
                    <text x={xOf(i)} y={Y_BOTTOM + 22} textAnchor="middle" fontSize="13" fill="#6b7280">{m.slice(0, 4)}</text>
                  </g>
                ) : null))}

                {months.map((m, i) => (gapMonths.has(m) ? (
                  <g key={`gap-${m}`}>
                    <title>Saknas i Metas export: {ctMonthLabel(m)}</title>
                    <rect x={xOf(i) - 4} y={Y_TOP} width="8" height={Y_BOTTOM - Y_TOP} fill="#9ca3af" fillOpacity="0.15" />
                    <circle cx={xOf(i)} cy={Y_BOTTOM} r="3" fill="#9ca3af"><title>Saknas i Metas export: {ctMonthLabel(m)}</title></circle>
                  </g>
                ) : null))}

                {lines.map(line => {
                  const pts = line.data.map((d, i) => ({
                    x: xOf(i), y: d.value === null ? null : yOf(d.value),
                    ghostY: d.ghost === null || d.ghost === undefined ? null : yOf(d.ghost), d, month: months[i],
                  }));
                  return (
                    <g key={line.account_key}>
                      {ghostRuns(pts).map((run, ri) => (run.length > 1 ? (
                        <polyline key={ri} points={run.map(p => `${p.x},${p.ghostY}`).join(' ')} fill="none"
                          stroke={line.color} strokeWidth="1" strokeDasharray="1.5 3" strokeOpacity="0.35" strokeLinecap="round" />
                      ) : (
                        <circle key={ri} cx={run[0].x} cy={run[0].ghostY} r="2.5" fill="none" stroke={line.color} strokeOpacity="0.35" />
                      )))}
                      {ctSegments(pts).map((seg, si) => (
                        <line key={si} x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y} stroke={line.color}
                          strokeWidth="2.5" strokeLinecap="round"
                          strokeDasharray={seg.source === 'crowdtangle' ? '7 4' : undefined}
                          strokeOpacity={seg.source === 'crowdtangle' ? 0.45 : 1} />
                      ))}
                      {pts.filter(p => p.y !== null).map(p => (
                        <circle key={p.month} cx={p.x} cy={p.y} r={months.length > 48 ? 3.5 : 5} fill={line.color}
                          fillOpacity={p.d.source === 'crowdtangle' ? 0.45 : 1} stroke="white" strokeWidth="1.5"
                          className="cursor-pointer"
                          onMouseEnter={() => setHover({ x: p.x, y: p.y, month: p.month, value: p.d.value, ghost: p.d.ghost, source: p.d.source, name: line.account_name })} />
                      ))}
                    </g>
                  );
                })}

                {distinctBreakpointIndexes(lines, months).map((i, n) => {
                  const x = xOf(i);
                  const right = x > 800;
                  return (
                    <g key={`bp-${i}`}>
                      <line x1={x} y1={Y_TOP} x2={x} y2={Y_BOTTOM} stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 4" />
                      {n === 0 && <text x={right ? x - 5 : x + 5} y={Y_TOP + 12} textAnchor={right ? 'end' : 'start'} fontSize="11" fill="#6b7280">Källbyte</text>}
                    </g>
                  );
                })}

                {hover && (() => {
                  const w = 250, h = hover.ghost != null ? 108 : 90;
                  let tx = hover.x + 15, ty = hover.y - 45;
                  if (tx + w > 990) tx = hover.x - w - 15;
                  if (ty < 10) ty = hover.y + 15;
                  if (ty + h > 490) ty = hover.y - h - 15;
                  return (
                    <g pointerEvents="none">
                      <rect x={tx} y={ty} width={w} height={h} fill="rgba(0,0,0,0.85)" rx="6" />
                      <text x={tx + 12} y={ty + 20} fill="white" fontSize="13" fontWeight="bold">{hover.name}</text>
                      <text x={tx + 12} y={ty + 38} fill="white" fontSize="12">{ctMonthLabel(hover.month)}</text>
                      <text x={tx + 12} y={ty + 58} fill="white" fontSize="14" fontWeight="bold">{metricLabel}: {hover.value.toLocaleString('sv-SE')}</text>
                      <text x={tx + 12} y={ty + 76} fill="#d1d5db" fontSize="11">Källa: {CT_SOURCE_LABEL[hover.source]}</text>
                      {hover.ghost != null && (
                        <text x={tx + 12} y={ty + 94} fill="#d1d5db" fontSize="11">CrowdTangle samma månad: {hover.ghost.toLocaleString('sv-SE')}</text>
                      )}
                    </g>
                  );
                })()}
              </svg>

              {lines.some(l => l.splice_status === 'crowdtangle_only') && hasMetadbSide && (
                <p className="text-xs text-muted-foreground">
                  Vissa konton saknar koppling till metaDB-data (eller har inga egna inlägg i appen) och visas därför bara med CrowdTangle-siffror.
                </p>
              )}
              {platform === 'twitter' && (
                <p className="text-xs text-muted-foreground">Twitter finns bara i CrowdTangle-materialet (2018–2019). Appen har ingen egen Twitter-data.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
