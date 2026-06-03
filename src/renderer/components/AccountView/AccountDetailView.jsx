/**
 * AccountDetailView — drill-down-vy för ett enskilt konto inuti "Per konto".
 *
 * Visar kontots inlägg som ett punktdiagram (räckvidd × publiceringsdatum) med
 * golv-linje (veckomedian), orange virala punkter, viral-tröskeln i klartext,
 * nyckeltal + en status-mening, samt en datadriven tillförlitlighetsnotis.
 *
 * All golv-/viral-/status-logik ligger i golvViral.js (rena, enhetstestade
 * funktioner). Här sker bara datahämtning, ihopkoppling och rendering – i linje
 * med appens princip: lagra råvärden, beräkna vid hämtning.
 */
import React, { useState, useEffect, useMemo } from 'react';
import PlatformBadge from '../ui/PlatformBadge';
import InfoTooltip from '../ui/InfoTooltip';
import { Button } from '../ui/button';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { api } from '@/utils/apiClient';
import PostScatter from './PostScatter';
import {
  VIRAL_PARAMS,
  TUNT,
  periodMedian,
  weeklyFloor,
  viralThreshold,
  isViral,
  reliability,
  viralShare,
  peerMedianOfMedians,
  floorLevel,
  floorTrend,
  statusVerdict,
} from './golvViral';

// P4 Lokalt regionala kanaler — samma explicita Set som AccountView/TrendAnalysisView.
// Används som enda tillgängliga kategorisignal för peer-jämförelsen (lokalt vs riks).
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
 * Kompakt svensk talformatering: 180000 → "180k", 22700 → "22,7k", 850 → "850".
 * En decimal under 100k (men inte för jämna tal), inga decimaler vid ≥100k.
 */
function formatK(n) {
  if (n == null || isNaN(n)) return '–';
  const abs = Math.abs(n);
  if (abs < 1000) return Math.round(n).toLocaleString('sv-SE');
  const k = n / 1000;
  const decimals = abs >= 100000 ? 0 : 1;
  const rounded = decimals === 0 ? Math.round(k) : Math.round(k * 10) / 10;
  return rounded.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: decimals }) + 'k';
}

/** Andel som svensk procent: 0,231 → "23 %". */
function formatPercent(value) {
  return value.toLocaleString('sv-SE', { style: 'percent', maximumFractionDigits: 0 });
}

/**
 * Härleder x-axelns fönster ur periodvalet (periodParams), så diagrammet
 * respekterar vald period i stället för bara datasetets utbredning.
 * Returnerar {} om perioden inte går att tolka (då härleder PostScatter själv).
 */
function periodWindow(periodParams) {
  try {
    if (periodParams.dateFrom && periodParams.dateTo) {
      return {
        xMin: new Date(`${periodParams.dateFrom}T00:00:00`).getTime(),
        xMax: new Date(`${periodParams.dateTo}T23:59:59`).getTime(),
      };
    }
    if (periodParams.months) {
      const months = periodParams.months.split(',').map(m => m.trim()).filter(Boolean).sort();
      if (months.length > 0) {
        const [fy, fm] = months[0].split('-').map(Number);
        const [ly, lm] = months[months.length - 1].split('-').map(Number);
        return {
          xMin: new Date(fy, fm - 1, 1).getTime(),
          xMax: new Date(ly, lm, 0, 23, 59, 59).getTime(), // sista dagen i sista månaden
        };
      }
    }
  } catch {
    // Faller tillbaka på datasetets utbredning
  }
  return {};
}

const StatBox = ({ label, value, hint }) => (
  <div className="rounded-lg border bg-white p-3">
    <div className="text-xs text-muted-foreground flex items-center">{label}{hint}</div>
    <div className="text-xl font-semibold mt-1">{value}</div>
  </div>
);

const TrendIcon = ({ trend }) => {
  if (trend === '↑') return <TrendingUp className="h-5 w-5 text-green-600" />;
  if (trend === '↓') return <TrendingDown className="h-5 w-5 text-red-600" />;
  return <Minus className="h-5 w-5 text-gray-400" />;
};

const AccountDetailView = ({ account, platform, periodParams = {}, onBack }) => {
  const [allPosts, setAllPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Hämta hela det filtrerade settet (plattform + period) opaginerat. Vi hämtar
  // alla plattformens inlägg en gång och härleder både kontots egna punkter och
  // peer-medianerna client-side.
  useEffect(() => {
    const fetchPosts = async () => {
      setLoading(true);
      setError(false);
      try {
        const params = { ...periodParams, paginate: 'false' };
        if (platform) params.platform = platform;
        const data = await api.getPosts(params);
        setAllPosts(data.data || []);
      } catch (err) {
        console.error('Fel vid hämtning av inlägg för kontodetalj:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchPosts();
  }, [account, platform, periodParams]);

  const params = VIRAL_PARAMS[account.platform === 'facebook' ? 'FB' : 'IG'];

  // Kontots egna inlägg (samma namn + plattform).
  const accountPosts = useMemo(
    () => allPosts.filter(p => p.account_name === account.account_name && p.platform === account.platform),
    [allPosts, account]
  );

  const analysis = useMemo(() => {
    const med = periodMedian(accountPosts);
    const floor = weeklyFloor(accountPosts);
    const threshold = viralThreshold(med, params);
    const rel = reliability(accountPosts, TUNT);
    const share = viralShare(accountPosts, med, params);
    const trend = floorTrend(floor);

    // Peer-benchmark: median av jämförbara kontons periodmedianer (median-of-medians).
    // Peer = samma plattform (redan filtrerat) + samma kategori (lokalt/riks),
    // exklusive kontot självt. Reach-only-konton saknar inlägg och faller bort
    // naturligt eftersom de inte finns i postsettet.
    //
    // KÄND BEGRÄNSNING: "riks"-hinken (allt utanför P4_CHANNELS) blandar stora
    // rikskonton med minoritetsspråkskonton (Somali, Romano, Farsi m.fl.), som då
    // hamnar mot SR-kontot/Ekot och kan läsas som "lågt golv". Det är exakt den
    // orättvisa direktivet varnar för, men den går inte att lösa snyggt utan en ny
    // kontotaxonomi (ej i scope här). Mitigering: golvnivån hålls BESKRIVANDE (båda
    // talen visas) och copy är aldrig skuldbeläggande.
    const selfLocal = P4_CHANNELS.has(account.account_name);
    const byAccount = new Map();
    for (const p of allPosts) {
      if (!byAccount.has(p.account_name)) byAccount.set(p.account_name, []);
      byAccount.get(p.account_name).push(p);
    }
    const peerMedians = [];
    for (const [name, posts] of byAccount) {
      if (name === account.account_name) continue;
      if (P4_CHANNELS.has(name) !== selfLocal) continue;
      if (posts.length === 0) continue;
      peerMedians.push(periodMedian(posts));
    }
    const peerMed = peerMedianOfMedians(peerMedians); // null om < MIN_PEERS (5)
    const level = floorLevel(med, peerMed);           // 'högt' | 'lågt' | null
    const verdict = level ? statusVerdict(level, share) : null;

    // Diagrampunkter
    const points = accountPosts
      .map(p => {
        const t = new Date(p.publish_time).getTime();
        if (isNaN(t)) return null;
        return {
          date: t,
          reach: p.reach,
          viral: isViral(p, med, params),
          postType: p.post_type,
          description: p.description,
        };
      })
      .filter(Boolean);
    const floorPoints = floor.map(w => ({ date: w.date, median: w.median }));

    return { med, floor, threshold, rel, share, trend, peerMed, peerCount: peerMedians.length, level, verdict, points, floorPoints };
  }, [accountPosts, allPosts, account, params]);

  const { xMin, xMax } = periodWindow(periodParams);

  const platformLabel = account.platform === 'facebook' ? 'Facebook' : 'Instagram';
  const kStr = params.k.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const thresholdText =
    `Viral-tröskel: ${formatK(analysis.threshold)}  ` +
    `(${formatK(params.bas)} + ${kStr} × median ${formatK(analysis.med)})`;

  // Header: bakåtknapp + kontonamn finns alltid.
  const header = (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Tillbaka
        </Button>
        <span className="text-lg font-semibold flex items-center gap-2">
          {account.account_name}
          <PlatformBadge platform={account.platform} />
        </span>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div>
        {header}
        <p className="text-center text-muted-foreground py-12">Laddar kontots inlägg…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {header}
        <p className="text-center text-muted-foreground py-12">Kunde inte hämta kontots inlägg.</p>
      </div>
    );
  }

  if (accountPosts.length === 0) {
    return (
      <div>
        {header}
        <p className="text-center text-muted-foreground py-12">
          Inga inlägg för {account.account_name} ({platformLabel}) i vald period.
        </p>
      </div>
    );
  }

  const { med, rel, share, trend, peerMed, level, verdict } = analysis;

  // Beskrivande golvnivå-text (aldrig skuldbeläggande). Jämförelse visas bara när
  // benchmarken bygger på ≥5 jämförbara konton; annars enbart kontots eget golvtal.
  const floorComparisonText = peerMed != null
    ? `Ert golv (periodmedian): ${formatK(med)} mot liknande kontons ~${formatK(peerMed)}.`
    : `Ert golv (periodmedian): ${formatK(med)}. För få jämförbara konton i vald period för en golvnivå-jämförelse.`;

  return (
    <div>
      {header}

      {/* Status-mening — vyns huvudbudskap */}
      <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-4">
        <div className="text-xs uppercase tracking-wide text-primary/70 mb-1">Status</div>
        <div className="text-lg font-bold text-primary">
          {verdict
            ? verdict
            : level === null
              ? 'Golvnivå kan inte klassas (för få jämförbara konton) – se golvtalet nedan.'
              : '—'}
        </div>
      </div>

      {/* Nyckeltal */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatBox
          label="Median (period)"
          value={formatK(med)}
          hint={<InfoTooltip text="Medianräckvidd över valda perioden, alla posttyper poolade. Detta är kontots golv." />}
        />
        <StatBox
          label="Viralandel"
          value={formatPercent(share)}
          hint={<InfoTooltip text="Andel av total räckvidd som kommer från virala inlägg (Σ räckvidd virala / Σ räckvidd alla). Mäter om kontot bygger på viraler – inte antal orange punkter." />}
        />
        <StatBox
          label="Golvtrend"
          value={<span className="inline-flex items-center gap-1"><TrendIcon trend={trend} /> {trend}</span>}
          hint={<InfoTooltip text="Golvets riktning: veckomedianen i periodens början jämfört med slutet." />}
        />
        <StatBox
          label="Underlag"
          value={`${rel.n} / ${rel.weeks}`}
          hint={<InfoTooltip text="Antal inlägg / antal veckor med minst ett inlägg." />}
        />
      </div>

      {/* Viral-tröskel i klartext + beskrivande golvnivå */}
      <div className="rounded-lg border bg-white p-4 mb-4 space-y-2">
        <div className="font-medium text-foreground">{thresholdText}</div>
        <div className="text-sm text-muted-foreground flex items-start gap-1">
          {floorComparisonText}
          <InfoTooltip text="Golvnivån jämförs mot medianen av jämförbara kontons golv (samma plattform + samma kategori riks/lokalt). OBS: kategorin är grov – ett litet konto kan ha lågt golv på grund av publikstorlek, inte kvalitet. 'Lågt golv' betyder aldrig dålig redaktion." />
        </div>
      </div>

      {/* Tillförlitlighetsnotis (blockerar inte) */}
      <div className="text-sm mb-4">
        <span className="text-muted-foreground">Bygger på {rel.n} inlägg över {rel.weeks} veckor.</span>
        {rel.thin && (
          <div className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            {rel.message}
          </div>
        )}
      </div>

      {/* Punktdiagram */}
      <PostScatter
        points={analysis.points}
        floorPoints={analysis.floorPoints}
        threshold={analysis.threshold}
        xMin={xMin}
        xMax={xMax}
        floorLabel={`Golv ~${formatK(med)}`}
      />
    </div>
  );
};

export default AccountDetailView;
