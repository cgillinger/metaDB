/**
 * TikTokOverviewSummary — kort som visar månadsaggregat av Översikt-data
 * (per dag/konto) när TikTok är vald plattform.
 *
 * Räckvidd visas alltid som AVG av dagsräckvidd (icke-summerbar invariant).
 * Övriga fält summeras över månadens dagar.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import InfoTooltip from '../ui/InfoTooltip';
import { Activity, RefreshCw } from 'lucide-react';
import { api } from '@/utils/apiClient';
import { TIKTOK_DAILY_ENGAGEMENT_INFO } from '@/utils/columnConfig';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('sv-SE'));

const MONTH_NAMES_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
const fmtMonth = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES_SV[parseInt(mo, 10) - 1]} ${y.slice(2)}`;
};

const TikTokOverviewSummary = ({ periodParams = {} }) => {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const months = periodParams.months
          ? periodParams.months.split(',').map(m => m.trim()).filter(Boolean)
          : null;
        const result = await api.getTikTokOverviewSummary(months);
        if (!cancelled) setSummary(result.summary || []);
      } catch (e) {
        if (!cancelled) setSummary([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [periodParams.months, periodParams.dateFrom, periodParams.dateTo]);

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

  if (summary.length === 0) {
    return null;
  }

  // Gruppera per konto för att slå ihop månader när flera är valda
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

  // Aggregera per konto över valda månader
  const rows = Object.values(byAccount).map(a => {
    const totalDays = a.months.reduce((s, m) => s + m.day_count, 0);
    const sum = (key) => a.months.reduce((s, m) => s + (m[key] || 0), 0);
    // AVG-räckvidd över alla dagar (SBS: vägt mot day_count)
    const weightedReach = a.months.reduce((s, m) => s + (m.avg_daily_reach || 0) * m.day_count, 0);
    return {
      account_username: a.account_username,
      account_name: a.account_name,
      day_count: totalDays,
      month_count: a.months.length,
      video_views: sum('video_views'),
      avg_daily_reach: totalDays > 0 ? Math.round(weightedReach / totalDays) : 0,
      peak_daily_reach: Math.max(...a.months.map(m => m.peak_daily_reach || 0)),
      profile_views: sum('profile_views'),
      new_followers: sum('new_followers'),
      lost_followers: sum('lost_followers'),
      net_follower_growth: sum('net_follower_growth'),
      daily_engagement_sum: sum('daily_engagement_sum'),
    };
  });

  rows.sort((a, b) => b.video_views - a.video_views);

  const totalMonths = [...new Set(summary.map(s => s.month))].sort();
  const periodLabel = totalMonths.length === 1
    ? fmtMonth(totalMonths[0])
    : totalMonths.length > 1
      ? `${fmtMonth(totalMonths[0])} – ${fmtMonth(totalMonths[totalMonths.length - 1])}`
      : 'all data';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Activity className="h-5 w-5" />
          TikTok Översikt — kontonivå ({periodLabel})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Konto</TableHead>
                <TableHead className="text-right">Dagar</TableHead>
                <TableHead className="text-right">Visningar (sum)</TableHead>
                <TableHead className="text-right">
                  Räckvidd / dag (snitt)
                  <InfoTooltip text="Räckvidd är icke-summerbar — visas som genomsnitt per dag över valda månader." />
                </TableHead>
                <TableHead className="text-right">Topp dagsräckvidd</TableHead>
                <TableHead className="text-right">Profilvisningar (sum)</TableHead>
                <TableHead className="text-right">Nya följare</TableHead>
                <TableHead className="text-right">Tappade följare</TableHead>
                <TableHead className="text-right">Netto-tillväxt</TableHead>
                <TableHead className="text-right">
                  Dagsengagemang (sum)
                  <InfoTooltip text={TIKTOK_DAILY_ENGAGEMENT_INFO} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.account_username}>
                  <TableCell className="font-medium">
                    {r.account_name || r.account_username}
                    {r.account_name && r.account_name !== r.account_username && (
                      <span className="text-xs text-muted-foreground ml-1">@{r.account_username}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{r.day_count}</TableCell>
                  <TableCell className="text-right">{fmt(r.video_views)}</TableCell>
                  <TableCell className="text-right">{fmt(r.avg_daily_reach)}</TableCell>
                  <TableCell className="text-right">{fmt(r.peak_daily_reach)}</TableCell>
                  <TableCell className="text-right">{fmt(r.profile_views)}</TableCell>
                  <TableCell className="text-right text-green-700">{fmt(r.new_followers)}</TableCell>
                  <TableCell className="text-right text-red-700">{fmt(r.lost_followers)}</TableCell>
                  <TableCell className={`text-right font-medium ${r.net_follower_growth >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {r.net_follower_growth > 0 ? '+' : ''}{fmt(r.net_follower_growth)}
                  </TableCell>
                  <TableCell className="text-right">{fmt(r.daily_engagement_sum)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          <strong>Data från TikTok Översikt-export</strong> (per dag, kontonivå) —
          skild från Video-CSV:n (per inlägg) som visas i tabellen "Per konto".
          Räckvidd är icke-summerbar invariant och visas som genomsnitt per dag.
        </p>
      </CardContent>
    </Card>
  );
};

export default TikTokOverviewSummary;
