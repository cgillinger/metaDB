/**
 * PlatformTrendView — "Är det plattformen eller vi?"
 *
 * Shows three fixed metrics per month (avg views, avg reach, post count) for a
 * single platform, plus a barometer summarising the recent trend in avg views.
 * Uses Chart.js (only view in the app that does) for the dual-axis line chart.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import Chart from 'chart.js/auto';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Users,
  FileText,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { api } from '@/utils/apiClient';

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

const COLOR_VIEWS = '#378ADD';
const COLOR_REACH = '#1D9E75';
const COLOR_POSTS = '#B4B2A9';

// En sanningskälla för seriernas nyckel, etikett och färg — används av både
// Chart.js-dataseten och kryssrutorna i teckenförklaringen. Ordningen är
// datasetens index i grafen.
const SERIES = [
  { key: 'views', label: 'Visningar / inlägg', color: COLOR_VIEWS, swatch: 'dot' },
  { key: 'reach', label: 'Räckvidd / inlägg', color: COLOR_REACH, swatch: 'dot' },
  { key: 'posts', label: 'Antal inlägg', color: COLOR_POSTS, swatch: 'dash' },
];

const monthName = (monthKey) => {
  const [, m] = monthKey.split('-').map(Number);
  return MONTH_NAMES_SV[m - 1] || monthKey;
};

const fmtNum = (v) => Math.round(v ?? 0).toLocaleString('sv-SE');

/** Signed percentage string, e.g. "+5%", "−12%", "±0%". */
const fmtPct = (delta) => {
  const pct = Math.round(delta * 100);
  if (pct === 0) return '±0%';
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
};

// Barometer math (calcBarometer / calcYearOverYear) now lives server-side in
// server/services/trend/barometer.js and is delivered via the platform-trends API
// (data.barometer / data.yoy). The view only formats and renders the result.

/** "2026-04" → "apr 2026" (Swedish, lowercase month). */
const yoyMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-');
  return `${(MONTH_NAMES_SV[Number(m) - 1] || m).toLowerCase()} ${y}`;
};

const BARO_STATES = {
  rising: { label: 'Stigande', Icon: TrendingUp, text: 'text-green-700', bg: 'bg-green-50' },
  stable: { label: 'Stabil', Icon: Minus, text: 'text-gray-600', bg: 'bg-gray-100' },
  falling: { label: 'Fallande', Icon: TrendingDown, text: 'text-red-700', bg: 'bg-red-50' },
};

function PillGroup({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden">
      {options.map((opt, i) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm transition-colors ${i > 0 ? 'border-l' : ''} ${
            value === opt.value
              ? 'bg-blue-50 text-blue-800 font-medium'
              : 'bg-white text-muted-foreground hover:bg-gray-50'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function BarometerCard({ label, baro, detail, insufficientText, windowToggle }) {
  return (
    <Card className="shrink-0" style={{ flex: '0 0 160px' }}>
      <CardContent className="pt-4 pb-4 flex flex-col items-center text-center h-full">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-tight mb-2 min-h-[24px] flex items-center">
          {label}
        </span>
        {baro ? (
          (() => {
            const { Icon, text, bg, label: statusLabel } = BARO_STATES[baro.status];
            return (
              <>
                <div className={`rounded-full p-2 mb-2 ${bg}`}>
                  <Icon className={text} style={{ width: 38, height: 38 }} />
                </div>
                <div className={`text-base font-semibold leading-tight ${text}`}>{statusLabel}</div>
                <div className={`text-sm ${text}`}>{fmtPct(baro.delta)}</div>
                <p className="text-xs text-muted-foreground mt-2 leading-snug">{detail}</p>
              </>
            );
          })()
        ) : (
          <>
            <div className="rounded-full p-2 mb-2 bg-gray-100">
              <Minus className="text-muted-foreground" style={{ width: 38, height: 38 }} />
            </div>
            <div className="text-base font-semibold text-muted-foreground">—</div>
            <p className="text-xs text-muted-foreground mt-2 leading-snug">{insufficientText}</p>
          </>
        )}
        {windowToggle && <div className="mt-3">{windowToggle}</div>}
      </CardContent>
    </Card>
  );
}

function SummaryCard({ label, color, value, delta, prevMonthLabel }) {
  return (
    <Card className="bg-muted/50">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="text-[21px] font-medium tabular-nums">{value}</div>
        {delta !== null && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {fmtPct(delta)} mot {prevMonthLabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScenarioBox({ title, children }) {
  return (
    <div className="flex-1 border rounded-md p-3 bg-white">
      <div className="flex items-center gap-1.5 font-medium text-sm mb-1">
        <TrendingDown className="h-4 w-4 text-muted-foreground shrink-0" />
        {title}
      </div>
      <p className="text-xs text-muted-foreground leading-snug">{children}</p>
    </div>
  );
}

const PlatformTrendView = ({ periodParams = {} }) => {
  const [platform, setPlatform] = useState('facebook');
  const [group, setGroup] = useState('all');
  const [baroWindow, setBaroWindow] = useState(4);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Kryssrutorna under grafen styr vilka linjer som ritas. Alla på från start.
  const [visibleSeries, setVisibleSeries] = useState({
    views: true,
    reach: true,
    posts: true,
  });

  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // Fetch aggregated data when platform, group or period changes.
  // Stale-flag guards against out-of-order responses on rapid filter changes:
  // only the latest request may update state or release the loading flag.
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const monthsArray = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim()).filter(Boolean)
          : null;
        const result = await api.getPlatformTrends(platform, group, monthsArray);
        if (cancelled) return;
        setData(result);
      } catch (err) {
        console.error('Fel vid hämtning av plattformstrend:', err);
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [platform, group, periodParams]);

  const months = data?.months || [];

  // Barometrar beräknas server-side (trend/barometer.js); vyn väljer rätt fönster ur
  // den färdiga barometers-mapen — pillen växlar instant, utan refetch.
  const baro = data?.barometers?.[baroWindow] ?? null;
  const yoy = data?.yoy ?? null;

  // Per-card values: latest month value + delta vs the preceding month.
  const cardData = useMemo(() => {
    if (months.length === 0) return null;
    const last = months[months.length - 1];
    const prev = months.length > 1 ? months[months.length - 2] : null;
    const prevMonthLabel = prev ? monthName(prev.month) : null;
    const delta = (cur, before) =>
      prev && before ? (cur - before) / before : null;
    return {
      prevMonthLabel,
      views: { value: last.avg_views, delta: delta(last.avg_views, prev?.avg_views) },
      reach: { value: last.avg_reach, delta: delta(last.avg_reach, prev?.avg_reach) },
      posts: { value: last.post_count, delta: delta(last.post_count, prev?.post_count) },
    };
  }, [months]);

  // Build / destroy the Chart.js instance when data changes.
  useEffect(() => {
    if (!canvasRef.current || months.length === 0) return;

    const labels = months.map((m, i) => {
      const [y] = m.month.split('-').map(Number);
      const name = monthName(m.month);
      const prevYear = i > 0 ? Number(months[i - 1].month.split('-')[0]) : null;
      return (i === 0 || y !== prevYear) ? `${name} ${String(y).slice(2)}` : name;
    });

    const config = {
      type: 'line',
      data: {
        labels,
        // Alla tre dataseten skapas alltid — kryssrutorna togglar synlighet via
        // setDatasetVisibility i effekten nedan, utan att grafen byggs om.
        datasets: [
          {
            label: SERIES[0].label,
            data: months.map(m => m.avg_views),
            borderColor: SERIES[0].color,
            backgroundColor: 'rgba(55, 138, 221, 0.06)',
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y',
          },
          {
            label: SERIES[1].label,
            data: months.map(m => m.avg_reach),
            borderColor: SERIES[1].color,
            fill: false,
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: 'y',
          },
          {
            label: SERIES[2].label,
            data: months.map(m => m.post_count),
            borderColor: SERIES[2].color,
            borderDash: [6, 4],
            fill: false,
            borderWidth: 1.5,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 3,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString('sv-SE')}`,
            },
          },
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Per inlägg' },
            ticks: {
              stepSize: 10000,
              callback: (v) => `${Math.round(v / 1000)}k`,
            },
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'Antal inlägg' },
            grid: { drawOnChartArea: false },
            ticks: {
              callback: (v) => `${(v / 1000).toFixed(1)}k`,
            },
          },
        },
      },
    };

    const chart = new Chart(canvasRef.current, config);
    chartRef.current = chart;
    return () => {
      chartRef.current = null;
      chart.destroy();
    };
  }, [months]);

  // Kryssrutorna styr dataset-synlighet på den levande instansen. Körs även efter
  // en ombyggnad (months i deps) så synligheten återappliceras på den nya grafen.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    SERIES.forEach((s, i) => chart.setDatasetVisibility(i, visibleSeries[s.key]));
    // Utan Antal inlägg ska inte en tom högeraxel stå kvar.
    chart.options.scales.y1.display = visibleSeries.posts;
    chart.update();
  }, [months, visibleSeries]);

  const footerRange = months.length > 0
    ? `${monthName(months[0].month)} ${months[0].month.split('-')[0]} – ${monthName(months[months.length - 1].month)} ${months[months.length - 1].month.split('-')[0]}`
    : '';

  return (
    <div className="space-y-4">
      {/* Group + Platform selectors */}
      <div className="flex gap-2 flex-wrap">
        <PillGroup
          value={group}
          onChange={setGroup}
          options={[{ value: 'all', label: 'Alla konton' }, { value: 'p4', label: 'P4 Lokalt' }, { value: 'riks', label: 'Riks' }]}
        />
        <PillGroup
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'facebook', label: 'Facebook' },
            { value: 'instagram', label: 'Instagram' },
          ]}
        />
      </div>

      {/* Barometers + Summary cards */}
      <div className="flex gap-3 flex-col md:flex-row">
        <div className="flex gap-3">
          <BarometerCard
            label="Kortsiktig trend"
            baro={baro}
            detail={`Senaste ${baroWindow} mån vs föregående ${baroWindow} mån`}
            insufficientText="Otillräcklig data"
            windowToggle={
              <PillGroup
                value={baroWindow}
                onChange={setBaroWindow}
                options={[{ value: 4, label: '4 mån' }, { value: 6, label: '6 mån' }]}
              />
            }
          />
          <BarometerCard
            label="Jämfört med förra året"
            baro={yoy}
            detail={yoy ? `${yoyMonthLabel(yoy.currentMonth)} vs ${yoyMonthLabel(yoy.previousMonth)}` : ''}
            insufficientText="Data för samma period förra året saknas"
          />
        </div>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SummaryCard
            label="Visningar / inlägg"
            color={COLOR_VIEWS}
            value={cardData ? fmtNum(cardData.views.value) : '—'}
            delta={cardData ? cardData.views.delta : null}
            prevMonthLabel={cardData?.prevMonthLabel}
          />
          <SummaryCard
            label="Räckvidd / inlägg"
            color={COLOR_REACH}
            value={cardData ? fmtNum(cardData.reach.value) : '—'}
            delta={cardData ? cardData.reach.delta : null}
            prevMonthLabel={cardData?.prevMonthLabel}
          />
          <SummaryCard
            label="Antal inlägg"
            color={COLOR_POSTS}
            value={cardData ? fmtNum(cardData.posts.value) : '—'}
            delta={cardData ? cardData.posts.delta : null}
            prevMonthLabel={cardData?.prevMonthLabel}
          />
        </div>
      </div>

      {/* Legend + kryssrutor: kryssa ur/i vilka serier som ritas i grafen */}
      <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
        {SERIES.map(s => (
          <label key={s.key} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleSeries[s.key]}
              onChange={() => setVisibleSeries(v => ({ ...v, [s.key]: !v[s.key] }))}
              className="h-3.5 w-3.5 accent-blue-600"
            />
            {s.swatch === 'dash'
              ? <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: s.color }} />
              : <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />}
            {s.label}
          </label>
        ))}
      </div>

      {/* Chart */}
      {months.length > 0 ? (
        <div className="relative w-full" style={{ height: '560px' }}>
          <canvas ref={canvasRef} />
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          {loading ? 'Laddar...' : 'Ingen data för vald period.'}
        </div>
      )}

      {/* Footer */}
      {months.length > 0 && (
        <div className="flex gap-4 text-xs text-muted-foreground flex-wrap items-center">
          <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{footerRange}</span>
          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{data?.accountCount ?? 0} konton</span>
          <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{(data?.totalPosts ?? 0).toLocaleString('sv-SE')} inlägg</span>
          <span className="italic">Säsongsvariationer kan påverka</span>
        </div>
      )}

      {/* Reading guide */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4" />
              Så läser du diagrammet
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Publiceringsstakten (den streckade linjen) är nyckeln. Om vi publicerar lika mycket som
              vanligt men visningarna ändå sjunker, tyder det på en förändring i plattformens algoritm.
              Om publiceringsstakten däremot sjunkit, är det den troligaste förklaringen till lägre visningar.
            </p>
          </div>

          <div className="flex gap-3 flex-col sm:flex-row">
            <ScenarioBox title="Plattformen har ändrats">
              Visningar och räckvidd sjunker, men publiceringsstakten är stabil. Förändringen drabbar
              troligen alla konton.
            </ScenarioBox>
            <ScenarioBox title="Vi publicerar mindre">
              Publiceringsstakten har sjunkit. Lägre visningar beror sannolikt på att vi når ut med
              färre inlägg.
            </ScenarioBox>
          </div>

          <div className="text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Tänk också på:</p>
            <p>
              <span className="font-medium text-foreground">Nyhetsläge</span> — Stora nyhetshändelser
              (val, terrorattacker, krigsutbrott) ger kraftiga tillfälliga toppar i visningar och räckvidd.
              Dessa speglar inte en bestående förändring i algoritmen utan en tillfällig ökning i nyhetsintresse.
            </p>
            <p>
              <span className="font-medium text-foreground">Säsong</span> — Sommarmånader (juni–augusti)
              och jul/nyår ger normalt lägre siffror. Jämför helst med samma period föregående år för en
              rättvisande bild.
            </p>
          </div>

          <div className="border rounded-md p-3 bg-white text-sm space-y-2">
            <p className="font-medium">Om mätvärdena</p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Visningar / inlägg</span> — Genomsnittligt antal
              gånger ett inlägg visats (impressions). Inkluderar upprepade visningar för samma person.
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Räckvidd / inlägg</span> — Genomsnittligt antal
              unika personer som sett ett inlägg. Alltid lägre än visningar.
            </p>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Antal inlägg</span> — Totalt antal publicerade
              inlägg under månaden. Visar om publiceringsstakten förändrats.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PlatformTrendView;
