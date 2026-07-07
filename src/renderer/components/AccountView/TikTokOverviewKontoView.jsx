/**
 * TikTokOverviewKontoView — "Per konto"-vy i Översikt-läge för TikTok.
 * Visar månadsaggregat av Översikt-CSV-data (tiktok_account_daily) per konto.
 *
 * Respekterar samma "Välj värden att visa"-mönster som AccountView: kolumnerna
 * styrs av selectedFields. Tabellen kompletterar AccountView (Video-CSV/posts)
 * via en lägesväxlare i MainView — användaren kan toggla mellan vyerna.
 *
 * Räckvidd visas som AVG av dagsräckvidd (icke-summerbar invariant).
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown, RefreshCw, Copy, Check } from 'lucide-react';
import InfoTooltip from '../ui/InfoTooltip';
import PlatformBadge from '../ui/PlatformBadge';
import ProfileIcon from '../ui/ProfileIcon';
import { api } from '@/utils/apiClient';
import { TIKTOK_DAILY_ENGAGEMENT_INFO } from '@/utils/columnConfig';
import { copyText } from '@/utils/clipboard';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('sv-SE'));

// Etiketter + info-text per fält (visas som kolumnrubrik i tabellen).
// Måste matcha TIKTOK_OVERVIEW_AVAILABLE_FIELDS i MainView.
const FIELD_META = {
  video_views: {
    label: 'Sidvisningar',
    info: 'TikTok-sidans totala dagsvisningar summerat över valda månader. ' +
      'Skiljer sig från "Visningar" i inlägg-läget, som mäter visningar på inlägg ' +
      'publicerade i perioden. En sida kan ha visningar utan att den publicerat något — ' +
      'tidigare videor som tittas på under perioden räknas här.',
    agg: 'sum',
  },
  avg_daily_reach: {
    label: 'Räckvidd / dag',
    info: 'Genomsnittlig dagsräckvidd (unika tittare per dag) över valda månader. ' +
      'Räckvidd är icke-summerbar — samma person kan nås flera dagar.',
    agg: 'avg',
  },
  profile_views: {
    label: 'Profilvisningar',
    info: 'Antal gånger profilsidan visats per dag, summerat över perioden.',
    agg: 'sum',
  },
  new_followers: { label: 'Nya följare', info: 'Summa nya följare över perioden.', agg: 'sum' },
  lost_followers: { label: 'Tappade följare', info: 'Summa tappade följare över perioden.', agg: 'sum' },
  net_follower_growth: {
    label: 'Nettotillväxt',
    info: 'Nya − tappade följare över perioden.',
    agg: 'sum',
  },
  daily_engagement_sum: {
    label: 'Dagsengagemang',
    info: TIKTOK_DAILY_ENGAGEMENT_INFO,
    agg: 'sum',
  },
};

const TikTokOverviewKontoView = ({ selectedFields = [], periodParams = {} }) => {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState({ key: 'video_views', direction: 'desc' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim()).filter(Boolean)
          : null;
        // Anpassad period (dateFrom/dateTo) har företräde framför månadslistan.
        const result = await api.getTikTokOverviewSummary(months, {
          dateFrom: periodParams.dateFrom,
          dateTo: periodParams.dateTo,
        });
        if (!cancelled) setSummary(result.summary || []);
      } catch (e) {
        if (!cancelled) setSummary([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  }, [periodParams.months, periodParams.dateFrom, periodParams.dateTo]);

  // Aggregera per konto över valda månader. SBS: summera råvärden först, beräkna AVG-
  // räckvidd vägt mot day_count så ett konto med 10 dagar i en månad och 30 dagar i en
  // annan vägs korrekt.
  const rows = useMemo(() => {
    const byAccount = {};
    for (const row of summary) {
      if (!byAccount[row.account_username]) {
        byAccount[row.account_username] = {
          account_username: row.account_username,
          account_name: row.account_name,
          months: [],
        };
      }
      byAccount[row.account_username].months.push(row);
    }
    return Object.values(byAccount).map(a => {
      const totalDays = a.months.reduce((s, m) => s + (m.day_count || 0), 0);
      const sum = (k) => a.months.reduce((s, m) => s + (m[k] || 0), 0);
      const weightedReach = a.months.reduce((s, m) => s + (m.avg_daily_reach || 0) * (m.day_count || 0), 0);
      return {
        account_username: a.account_username,
        account_name: a.account_name,
        day_count: totalDays,
        video_views: sum('video_views'),
        avg_daily_reach: totalDays > 0 ? Math.round(weightedReach / totalDays) : 0,
        profile_views: sum('profile_views'),
        new_followers: sum('new_followers'),
        lost_followers: sum('lost_followers'),
        net_follower_growth: sum('net_follower_growth'),
        daily_engagement_sum: sum('daily_engagement_sum'),
      };
    });
  }, [summary]);

  // Sortera
  const sortedRows = useMemo(() => {
    if (!sortConfig.key) return rows;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortConfig.key];
      const bv = b[sortConfig.key];
      if (typeof av === 'string') return av.localeCompare(bv, 'sv') * dir;
      return ((av || 0) - (bv || 0)) * dir;
    });
  }, [rows, sortConfig]);

  // Totals-rad. SUM för summerbara fält, vägd AVG för räckvidd (icke-summerbar).
  const totals = useMemo(() => {
    if (rows.length === 0) return null;
    const totalDays = rows.reduce((s, r) => s + r.day_count, 0);
    const weightedReach = rows.reduce((s, r) => s + (r.avg_daily_reach || 0) * r.day_count, 0);
    const sumK = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    return {
      video_views: sumK('video_views'),
      avg_daily_reach: totalDays > 0 ? Math.round(weightedReach / totalDays) : 0,
      profile_views: sumK('profile_views'),
      new_followers: sumK('new_followers'),
      lost_followers: sumK('lost_followers'),
      net_follower_growth: sumK('net_follower_growth'),
      daily_engagement_sum: sumK('daily_engagement_sum'),
    };
  }, [rows]);

  const onSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const [copyStatus, setCopyStatus] = useState({ field: null, rowId: null, copied: false });
  useEffect(() => {
    if (copyStatus.copied) {
      const t = setTimeout(() => setCopyStatus({ field: null, rowId: null, copied: false }), 1500);
      return () => clearTimeout(t);
    }
  }, [copyStatus]);

  const handleCopyValue = useCallback((value, field, rowId) => {
    if (value === undefined || value === null) return;
    const rawValue = typeof value === "number"
      ? String(value)
      : String(value).replace(/\s+/g, "").replace(/[^\d.,-]/g, "");
    copyText(rawValue)
      .then(() => setCopyStatus({ field, rowId, copied: true }))
      .catch(err => console.error("Kunde inte kopiera:", err));
  }, []);

  const CopyButton = ({ value, field, rowId }) => {
    const isCopied = copyStatus.copied && copyStatus.field === field && copyStatus.rowId === rowId;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleCopyValue(value, field, rowId); }}
        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:text-primary"
        title="Kopiera till urklipp"
      >
        {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
    );
  };

  const SortIcon = ({ field }) => {
    if (sortConfig.key !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 opacity-50" />;
    return sortConfig.direction === 'asc'
      ? <ArrowUp className="inline w-3 h-3 ml-1" />
      : <ArrowDown className="inline w-3 h-3 ml-1" />;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center h-16">
            <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            <span className="text-sm">Laddar TikTok-Översikt...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          Ingen TikTok Översikt-data för vald period.
        </CardContent>
      </Card>
    );
  }

  const visibleFields = selectedFields.filter(f => FIELD_META[f]);

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="min-w-[220px]">
                  <button onClick={() => onSort('account_name')} className="font-medium hover:text-foreground">
                    Kontonamn <SortIcon field="account_name" />
                  </button>
                </TableHead>
                {visibleFields.map(f => (
                  <TableHead key={f} className="text-right whitespace-nowrap">
                    <button onClick={() => onSort(f)} className="font-medium hover:text-foreground">
                      {FIELD_META[f].label}
                      <SortIcon field={f} />
                    </button>
                    <InfoTooltip text={FIELD_META[f].info} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Totals-rad */}
              {totals && (
                <TableRow className="bg-muted/30 font-medium">
                  <TableCell colSpan={2} className="text-primary font-semibold">
                    Totalt ({rows.length} konton)
                  </TableCell>
                  {visibleFields.map(f => (
                    <TableCell key={f} className="text-right tabular-nums">
                      <div className="flex items-center justify-end group">
                        {f === 'avg_daily_reach' ? (
                          <span title="AVG av AVG (vägd) — räckvidd kan ej summeras">
                            {fmt(totals[f])}
                          </span>
                        ) : (
                          <span>{fmt(totals[f])}</span>
                        )}
                        <CopyButton value={totals[f]} field={f} rowId="total" />
                      </div>
                    </TableCell>
                  ))}
                </TableRow>
              )}
              {sortedRows.map((r, i) => (
                <TableRow key={r.account_username}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <ProfileIcon accountName={r.account_name || r.account_username} size="sm" />
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{r.account_name || r.account_username}</span>
                          <PlatformBadge platform="tiktok_overview" />
                        </div>
                        {r.account_name && r.account_name !== r.account_username && (
                          <span className="text-xs text-muted-foreground">@{r.account_username}</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  {visibleFields.map(f => {
                    const v = r[f];
                    const copyBtn = <CopyButton value={v} field={f} rowId={`${r.account_username}-${f}`} />;
                    if (f === 'net_follower_growth') {
                      return (
                        <TableCell key={f} className={`text-right tabular-nums font-medium ${v >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          <div className="flex items-center justify-end group">
                            <span>{v > 0 ? '+' : ''}{fmt(v)}</span>
                            {copyBtn}
                          </div>
                        </TableCell>
                      );
                    }
                    if (f === 'new_followers') {
                      return (
                        <TableCell key={f} className="text-right tabular-nums text-green-700">
                          <div className="flex items-center justify-end group"><span>{fmt(v)}</span>{copyBtn}</div>
                        </TableCell>
                      );
                    }
                    if (f === 'lost_followers') {
                      return (
                        <TableCell key={f} className="text-right tabular-nums text-red-700">
                          <div className="flex items-center justify-end group"><span>{fmt(v)}</span>{copyBtn}</div>
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={f} className="text-right tabular-nums">
                        <div className="flex items-center justify-end group"><span>{fmt(v)}</span>{copyBtn}</div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default TikTokOverviewKontoView;
