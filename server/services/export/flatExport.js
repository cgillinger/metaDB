/**
 * flatExport.js — platt .xlsx-export för Power BI och andra analysverktyg.
 *
 * Bygger UTESLUTANDE på det befintliga serviceskiktet (Fas 1–2): ingen ny kalkyl,
 * inga reimplementationer. Snitt/dag via metrics/dailyAverages, estimat via
 * estimatedUniqueClicks, dolda konton via hiddenAccounts, P4-whitelist via p4Regions.
 *
 * Globala regler (se _LÄS_MIG-fliken):
 *  - Dolda konton exkluderas.
 *  - Endast verkliga rader — ingen zero-fill (saknad månad = ingen rad).
 *  - Numeriska råvärden, inte display-strängar. month + month_date (äkta datum).
 *  - Grain: konto × månad (data) resp. grupp × månad (grupp-flikar).
 */

import { getDb } from '../../db/connection.js';
import {
  hiddenPostsFilter, hiddenReachFilter, hiddenGAFilter,
  hiddenSiteVisitsFilter, hiddenIGReachFilter, hiddenTikTokOverviewFilter,
} from '../hiddenAccounts.js';
import { getEstimatedUniqueClicks } from '../estimatedUniqueClicks.js';
import { getAccountGroups } from '../accountGroupService.js';
import { normalizeMetaName } from '../comparisonService.js';
import { avgPerDay } from '../metrics/dailyAverages.js';
import { daysInMonth } from '../../utils/dateHelpers.js';
import { isP4LocalStation as isP4 } from '../../../shared/p4Regions.js';
import * as XLSX from 'xlsx';

/** First day of a 'YYYY-MM' month as a real Date (local midnight → clean Excel date). */
function monthDate(month) {
  // strftime('%Y-%m', ...) yields NULL for unparseable publish_time — one bad
  // row must not 500 the whole export, so map it to an empty cell instead.
  if (!month) return null;
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

// Export guard: skip rows with no identifiable account (empty account_name). After the
// permalink backfill these are only the unattributable reel/p/photo.php URLs — excluded
// so Power BI never sees blank-account rows.
const NONEMPTY_NAME = "trim(COALESCE(account_name, '')) <> ''";

// ---- Account-grain tabs -----------------------------------------------------

function postsMonthly(db) {
  const rows = db.prepare(`
    SELECT account_name, platform, strftime('%Y-%m', publish_time) AS month,
      COUNT(*) AS post_count, SUM(views) AS views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS reach,
      SUM(link_clicks) AS link_clicks, SUM(interactions) AS interactions
    FROM posts
    WHERE strftime('%Y-%m', publish_time) IS NOT NULL AND ${NONEMPTY_NAME} ${hiddenPostsFilter()}
    GROUP BY account_name, platform, month
    ORDER BY account_name, platform, month
  `).all();
  return rows.map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    platform: r.platform,
    month: r.month, month_date: monthDate(r.month),
    post_count: r.post_count, views: r.views, reach: r.reach,
    link_clicks: r.link_clicks, interactions: r.interactions,
    avg_daily_link_clicks: avgPerDay(r.link_clicks, daysInMonth(r.month), 1),
    posts_per_day: avgPerDay(r.post_count, daysInMonth(r.month), 2),
  }));
}

function estimatedUniqueClicksMonthly() {
  // Per månad endast (exakt) — kringgår öppen fråga #2 (ingen flermånadssummering).
  return getEstimatedUniqueClicks().filter(r => r.account_name && r.account_name.trim() !== '').map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    month: r.month, month_date: monthDate(r.month),
    n_posts: r.post_count,
    overlap_factor_f: r.overlap_factor,        // null vid suppressed-utan-räckvidd
    estimate_lower: r.estimated_unique_lower,  // null vid suppressed
    estimate_upper: r.estimated_unique_upper,  // null vid suppressed
    quality: r.quality,
  }));
}

function gaListensMonthly(db) {
  const rows = db.prepare(`
    SELECT account_name, month, listens FROM ga_listens
    WHERE ${NONEMPTY_NAME} ${hiddenGAFilter()} ORDER BY account_name, month
  `).all();
  return rows.map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    month: r.month, month_date: monthDate(r.month),
    listens: r.listens,
    avg_daily_listens: avgPerDay(r.listens, daysInMonth(r.month), 1),
  }));
}

function gaSiteVisitsMonthly(db) {
  const rows = db.prepare(`
    SELECT account_name, month, visits FROM ga_site_visits
    WHERE ${NONEMPTY_NAME} ${hiddenSiteVisitsFilter()} ORDER BY account_name, month
  `).all();
  return rows.map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    month: r.month, month_date: monthDate(r.month),
    visits: r.visits,
    avg_daily_visits: avgPerDay(r.visits, daysInMonth(r.month), 1),
  }));
}

function tiktokPostsMonthly(db) {
  // TikTok-poster (Video-CSV) aggregat per konto+månad. Räckvidd och länkklick
  // finns inte i TikTok-export → utesluts från denna flik (jfr platform-skillnader).
  const rows = db.prepare(`
    SELECT account_username, account_name, strftime('%Y-%m', publish_time) AS month,
      COUNT(*) AS post_count, SUM(views) AS views,
      SUM(likes) AS likes, SUM(comments) AS comments, SUM(shares) AS shares,
      SUM(saves) AS saves, SUM(interactions) AS interactions, SUM(engagement) AS engagement
    FROM posts
    WHERE platform = 'tiktok' AND strftime('%Y-%m', publish_time) IS NOT NULL AND ${NONEMPTY_NAME} ${hiddenPostsFilter()}
    GROUP BY account_username, account_name, month
    ORDER BY account_username, month
  `).all();
  return rows.map(r => ({
    account_username: r.account_username,
    account_name: r.account_name,
    normalized_name: normalizeMetaName(r.account_name),
    month: r.month, month_date: monthDate(r.month),
    post_count: r.post_count, views: r.views,
    likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves,
    interactions: r.interactions, engagement: r.engagement,
    posts_per_day: avgPerDay(r.post_count, daysInMonth(r.month), 2),
  }));
}

function tiktokOverviewMonthly(db) {
  // TikTok Översikt-data månadsaggregerat per konto. Räckvidd som AVG av dagar
  // (icke-summerbar), övriga fält SUM. Engagement (dagsformel): summa över dagarna.
  const rows = db.prepare(`
    SELECT account_username, account_name, month,
      SUM(video_views) AS video_views,
      CAST(ROUND(AVG(reach)) AS INTEGER) AS avg_daily_reach,
      MAX(reach) AS peak_daily_reach,
      SUM(profile_views) AS profile_views,
      SUM(likes) AS likes, SUM(shares) AS shares, SUM(comments) AS comments,
      SUM(new_followers) AS new_followers,
      SUM(lost_followers) AS lost_followers,
      COUNT(*) AS day_count
    FROM tiktok_account_daily
    WHERE 1=1 ${hiddenTikTokOverviewFilter()}
    GROUP BY account_username, account_name, month
    ORDER BY account_username, month
  `).all();
  return rows.map(r => ({
    account_username: r.account_username,
    account_name: r.account_name,
    normalized_name: normalizeMetaName(r.account_name || r.account_username),
    month: r.month, month_date: monthDate(r.month),
    day_count: r.day_count,
    video_views: r.video_views,
    avg_daily_reach: r.avg_daily_reach,
    peak_daily_reach: r.peak_daily_reach,
    profile_views: r.profile_views,
    likes: r.likes, shares: r.shares, comments: r.comments,
    new_followers: r.new_followers,
    lost_followers: r.lost_followers,
    net_follower_growth: (r.new_followers || 0) - (r.lost_followers || 0),
    daily_interactions_sum: (r.likes || 0) + (r.comments || 0) + (r.shares || 0),
    daily_engagement_sum:
      (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.new_followers || 0),
  }));
}

function tiktokOverviewDaily(db) {
  // Raw dagsdata — för Power BI-användare som vill bygga egna serier.
  const rows = db.prepare(`
    SELECT account_username, account_name, date, month,
      video_views, reach, profile_views, likes, shares, comments,
      new_followers, lost_followers
    FROM tiktok_account_daily
    WHERE 1=1 ${hiddenTikTokOverviewFilter()}
    ORDER BY account_username, date
  `).all();
  return rows.map(r => ({
    account_username: r.account_username,
    account_name: r.account_name,
    normalized_name: normalizeMetaName(r.account_name || r.account_username),
    date: r.date,
    date_value: new Date(r.date + 'T00:00:00'),
    month: r.month, month_date: monthDate(r.month),
    video_views: r.video_views,
    daily_reach: r.reach,
    profile_views: r.profile_views,
    likes: r.likes, shares: r.shares, comments: r.comments,
    new_followers: r.new_followers,
    lost_followers: r.lost_followers,
    net_follower_growth: (r.new_followers || 0) - (r.lost_followers || 0),
  }));
}

function accountReachMonthly(db) {
  const fb = db.prepare(`
    SELECT account_name, month, reach FROM account_reach
    WHERE ${NONEMPTY_NAME} ${hiddenReachFilter()} ORDER BY account_name, month
  `).all().map(r => ({ ...r, platform: 'facebook' }));
  const ig = db.prepare(`
    SELECT account_name, month, reach FROM ig_account_reach
    WHERE ${NONEMPTY_NAME} ${hiddenIGReachFilter()} ORDER BY account_name, month
  `).all().map(r => ({ ...r, platform: 'instagram' }));
  return [...fb, ...ig].map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    platform: r.platform,
    month: r.month, month_date: monthDate(r.month), account_reach: r.reach,
  }));
}

function accountViewersMonthly(db) {
  // FB unique viewers — successor to legacy account_reach (frozen 2024-01..2026-05).
  // Separate tab: different measure definition, series must never be merged.
  return db.prepare(`
    SELECT account_name, month, viewers, period_start, period_end, views_source
    FROM account_viewers
    WHERE ${NONEMPTY_NAME} ${hiddenReachFilter()} ORDER BY account_name, month
  `).all().map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    platform: 'facebook',
    month: r.month, month_date: monthDate(r.month), unique_viewers: r.viewers,
    period_start: r.period_start, period_end: r.period_end, views_source: r.views_source,
  }));
}

// ---- Group-grain tabs (SBS, source-scoped) ----------------------------------

/**
 * Aggregate a per-account monthly table into per-group-per-month rows.
 * Members are matched by name (and platform for posts). Only months with member
 * data emit a row. avg_daily is SBS: sum raw first, divide by that month's days.
 */
function groupMonthly(groups, accountRows, keyOf, sumFields, avgSpec) {
  // index account rows by member key → month → row
  const byKey = {};
  for (const r of accountRows) {
    const k = keyOf(r);
    (byKey[k] = byKey[k] || {})[r.month] = r;
  }
  const out = [];
  for (const g of groups) {
    const perMonth = {};
    for (const memberKey of g.members) {
      const months = byKey[memberKey];
      if (!months) continue;
      for (const [month, row] of Object.entries(months)) {
        const acc = perMonth[month] || (perMonth[month] = { month, _members: 0 });
        acc._members += 1;
        for (const f of sumFields) acc[f] = (acc[f] || 0) + (row[f] || 0);
      }
    }
    for (const month of Object.keys(perMonth).sort()) {
      const acc = perMonth[month];
      const rec = {
        group_id: g.id, group_name: g.name,
        month, month_date: monthDate(month),
        member_count: g.members.length,
      };
      for (const f of sumFields) rec[f] = acc[f] || 0;
      rec[avgSpec.out] = avgPerDay(acc[avgSpec.from] || 0, daysInMonth(month), 1);
      out.push(rec);
    }
  }
  return out;
}

// ---- Dimensions -------------------------------------------------------------

// Raw-account detail dimension: one row per raw account_name × platform, with the
// normalized join key alongside. NOT unique on normalized_name (the same account
// appears under different raw names per source) — relate cross-source on dim_account_key.
function dimAccounts(postsRows, reachRows, tiktokPostsRows, tiktokOverviewRows) {
  const seen = new Set();
  const out = [];
  for (const r of [...postsRows, ...reachRows]) {
    const k = `${r.account_name}::${r.platform}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      account_name: r.account_name, normalized_name: r.normalized_name,
      platform: r.platform, is_p4: isP4(r.account_name),
    });
  }
  // TikTok-poster: använd account_username (handle) som kanonisk identitet,
  // account_name som display.
  for (const r of (tiktokPostsRows || [])) {
    const k = `${r.account_username}::tiktok`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      account_name: r.account_name || r.account_username,
      normalized_name: r.normalized_name,
      platform: 'tiktok', is_p4: isP4(r.account_name || ''),
    });
  }
  // TikTok Översikt: konton som kanske inte finns i posts (om bara Översikt-CSV
  // importerats). Lägg in dem som separat platform-värde 'tiktok_overview' så
  // Power BI kan särskilja datakällor även på dim-nivå.
  for (const r of (tiktokOverviewRows || [])) {
    const k = `${r.account_username}::tiktok_overview`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      account_name: r.account_name || r.account_username,
      normalized_name: r.normalized_name,
      platform: 'tiktok_overview', is_p4: isP4(r.account_name || ''),
    });
  }
  return out.sort((a, b) =>
    a.account_name.localeCompare(b.account_name, 'sv') || a.platform.localeCompare(b.platform));
}

// Canonical join-key dimension: one row per UNIQUE normalized_name across every source.
// This is the dimension Power BI relates the data sheets to (1-to-many on normalized_name).
function dimAccountKey(rowArrays) {
  const seen = new Set();
  const out = [];
  for (const rows of rowArrays) {
    for (const r of rows) {
      const n = r.normalized_name;
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push({ normalized_name: n, is_p4: isP4(n) });
    }
  }
  return out.sort((a, b) => a.normalized_name.localeCompare(b.normalized_name, 'sv'));
}

function dimGroups(allGroups) {
  return allGroups.map(g => ({ group_id: g.id, group_name: g.name, source: g.source }));
}

function dimGroupMembers(allGroups) {
  const out = [];
  for (const g of allGroups) {
    for (const memberKey of g.members) {
      const account_name = memberKey.split('::')[0];
      out.push({ group_id: g.id, account_name, normalized_name: normalizeMetaName(account_name) });
    }
  }
  return out;
}

// ---- README -----------------------------------------------------------------

const README_LINES = [
  ['metaDB — platt analysexport'],
  [''],
  ['Den här filen innehåller färdigberäknade råvärden från metaDB. Alla mått är'],
  ['redan uträknade (snitt/dag, uppskattade unika klickare, gruppsummor) — du'],
  ['behöver inte räkna om något. Värdena är tal, inte text, så Power BI och Excel'],
  ['läser dem direkt.'],
  [''],
  ['Upplösning (grain):'],
  ['  • Dataflikar: en rad per konto och månad.'],
  ['  • Grupp-flikar: en rad per grupp och månad (förberäknade summor/snitt).'],
  ['  • Varje månad finns både som text (month, "ÅÅÅÅ-MM") och som riktigt datum'],
  ['    (month_date, månadens första dag) för relationer och tidshierarkier.'],
  [''],
  ['VIKTIGT — blanda aldrig grupp-flikar med konto-flikar i samma summering.'],
  ['Grupp-flikarna är redan summerade över medlemmarna; lägger du ihop dem med'],
  ['konto-raderna dubbelräknar du. Vill du aggregera själv: använd konto-flikarna.'],
  ['Vill du ha "Alla P4"-nivån direkt: använd grupp-flikarna.'],
  [''],
  ['Räckvidd kan inte summeras över konton eller månader — samma person kan nås'],
  ['flera gånger (överlapp). Därför finns ingen räckvidd på grupp-flikarna. Använd'],
  ['per-konto reach/account_reach som ett GENOMSNITT, aldrig som en summa. Samma'],
  ['regel gäller unique_viewers i account_viewers_monthly.'],
  [''],
  ['DEPREKERAT MÅTT — account_reach_monthly (Facebook) är fryst historik t.o.m.'],
  ['maj 2026: Meta stängde måttet (page_impressions_unique) 2026-06-15. Ersättaren'],
  ['är account_viewers_monthly ("Unika tittare (API)", page_total_media_view_unique)'],
  ['= unika konton som såg innehållet minst en gång under månaden. Nivåerna skiljer'],
  ['sig mellan måtten eftersom definitionerna skiljer: viewers kräver en faktisk'],
  ['visning (minst halva skärmen i minst 0,25 sekunder) medan gamla reach byggde på'],
  ['leverans till skärmen. Jämför ALDRIG värden över måttbytet som en serie —'],
  ['skillnaden är metodologisk, inte en publikförändring. Instagram-räckvidden i'],
  ['account_reach_monthly (platform=instagram) berörs inte: den bygger redan på'],
  ['samma mått som viewers och fortsätter obruten.'],
  [''],
  ['Uppskattade unika klickare är beräknade PER MÅNAD och får inte summeras över'],
  ['flera månader (samma person återkommer). overlap_factor_f är överlappsfaktorn;'],
  ['quality = ok / uncertain (mycket trogen publik, faktor > 5) / suppressed (för'],
  ['lite underlag — estimatkolumnerna är tomma).'],
  [''],
  ['Koppla ihop källor per konto: använd kolumnen normalized_name (samma konto har'],
  ['olika rånamn i olika källor — Meta skriver "P4 Göteborg, Sveriges Radio", GA'],
  ['skriver "P4 Göteborg"). normalized_name är det gemensamma, rensade namnet och'],
  ['fungerar som join-nyckel mellan posts-, GA- och räckviddsflikarna. account_name'],
  ['är rånamnet per källa (kvar för spårbarhet). Relatera dina dataflikar till'],
  ['fliken dim_account_key (en unik rad per normalized_name) i Power BI — den ger'],
  ['en ren 1-till-många utan dubblettnyckel. dim_accounts listar råkontona per'],
  ['plattform (med normalized_name bredvid) om du behöver den detaljnivån.'],
  [''],
  ['Dolda konton är exkluderade, precis som i appens vyer. En månad som saknas för'],
  ['ett konto betyder att det inte fanns någon publicering då — ingen rad skapas'],
  ['(ingen nolla). Hantera luckor med en egen datumtabell i Power BI.'],
  [''],
  ['Rader utan identifierbart konto är exkluderade (enstaka inlägg som Meta exporterat'],
  ['utan sidnamn och vars konto inte gick att härleda ur länken) — så att du slipper'],
  ['blanka kontorader.'],
  [''],
  ['Flikar: posts_monthly, estimated_unique_clicks_monthly, ga_listens_monthly,'],
  ['ga_site_visits_monthly, account_reach_monthly, account_viewers_monthly,'],
  ['posts_groups_monthly,'],
  ['ga_listens_groups_monthly, ga_site_visits_groups_monthly, tiktok_posts_monthly,'],
  ['tiktok_overview_monthly, tiktok_overview_daily, dim_accounts, dim_account_key,'],
  ['dim_groups, dim_group_members.'],
  [''],
  ['TikTok-flikar:'],
  ['  • tiktok_posts_monthly — Video-CSV-data aggregerat per konto×månad. Räckvidd'],
  ['    finns INTE per inlägg (TikTok exporterar inte det), så ingen reach-kolumn.'],
  ['  • tiktok_overview_monthly — Översikt-data per konto×månad (profilvisningar,'],
  ['    nya/tappade följare, dagsräckvidd som AVG). day_count = antal dagar med data.'],
  ['  • tiktok_overview_daily — råa dagsrader för egen aggregering i Power BI.'],
  ['Kanonisk TikTok-identitet är account_username (handle, t.ex. "p3dingata").'],
  ['account_name är display-namnet ("P3 Din Gata"). normalized_name fungerar som'],
  ['cross-source-nyckel även för TikTok.'],
];

// ---- Workbook builder -------------------------------------------------------

/** Add a data sheet from an array of row objects, with an explicit column order. */
function addObjectSheet(wb, name, columns, rows) {
  const header = columns;
  const aoa = [header, ...rows.map(r => columns.map(c => (r[c] === undefined ? null : r[c])))];
  // cellDates keeps Date cells as real dates (t:'d') instead of numeric serials.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
}

/**
 * Build the full flat workbook. Pure assembly over the service layer — no maths
 * beyond what the services already expose.
 * @returns {import('xlsx').WorkBook}
 */
export function buildFlatWorkbook() {
  const db = getDb();

  const posts = postsMonthly(db);
  const estimates = estimatedUniqueClicksMonthly();
  const listens = gaListensMonthly(db);
  const visits = gaSiteVisitsMonthly(db);
  const reach = accountReachMonthly(db);
  const viewers = accountViewersMonthly(db);
  const tiktokPosts = tiktokPostsMonthly(db);
  const tiktokOverview = tiktokOverviewMonthly(db);
  const tiktokDaily = tiktokOverviewDaily(db);

  const postsGroups = getAccountGroups('posts');
  const listensGroups = getAccountGroups('ga_listens');
  const visitsGroups = getAccountGroups('ga_site_visits');
  const allGroups = getAccountGroups();

  const postsGroupRows = groupMonthly(
    postsGroups, posts, r => `${r.account_name}::${r.platform}`,
    ['post_count', 'views', 'link_clicks', 'interactions'],
    { from: 'link_clicks', out: 'avg_daily_link_clicks' },
  );
  const listensGroupRows = groupMonthly(
    listensGroups, listens, r => `${r.account_name}::ga_listens`,
    ['listens'], { from: 'listens', out: 'avg_daily_listens' },
  );
  const visitsGroupRows = groupMonthly(
    visitsGroups, visits, r => `${r.account_name}::ga_site_visits`,
    ['visits'], { from: 'visits', out: 'avg_daily_visits' },
  );

  const wb = XLSX.utils.book_new();

  // README first.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(README_LINES), '_LÄS_MIG');

  addObjectSheet(wb, 'posts_monthly',
    ['account_name', 'normalized_name', 'platform', 'month', 'month_date', 'post_count',
      'views', 'reach', 'link_clicks', 'interactions', 'avg_daily_link_clicks', 'posts_per_day'], posts);
  addObjectSheet(wb, 'estimated_unique_clicks_monthly',
    ['account_name', 'normalized_name', 'month', 'month_date', 'n_posts', 'overlap_factor_f',
      'estimate_lower', 'estimate_upper', 'quality'], estimates);
  addObjectSheet(wb, 'ga_listens_monthly',
    ['account_name', 'normalized_name', 'month', 'month_date', 'listens', 'avg_daily_listens'], listens);
  addObjectSheet(wb, 'ga_site_visits_monthly',
    ['account_name', 'normalized_name', 'month', 'month_date', 'visits', 'avg_daily_visits'], visits);
  addObjectSheet(wb, 'account_reach_monthly',
    ['account_name', 'normalized_name', 'platform', 'month', 'month_date', 'account_reach'], reach);
  addObjectSheet(wb, 'account_viewers_monthly',
    ['account_name', 'normalized_name', 'platform', 'month', 'month_date', 'unique_viewers',
      'period_start', 'period_end', 'views_source'], viewers);

  // TikTok-flikar — separata från posts_monthly/account_reach eftersom TikTok-data
  // har egna fält (saves istället för reach per inlägg; dagsräckvidd istället för
  // månadsräckvidd) och egen "Översikt"-tabell med profilbesök + följartillväxt.
  addObjectSheet(wb, 'tiktok_posts_monthly',
    ['account_username', 'account_name', 'normalized_name', 'month', 'month_date',
      'post_count', 'views', 'likes', 'comments', 'shares', 'saves',
      'interactions', 'engagement', 'posts_per_day'], tiktokPosts);
  addObjectSheet(wb, 'tiktok_overview_monthly',
    ['account_username', 'account_name', 'normalized_name', 'month', 'month_date',
      'day_count', 'video_views', 'avg_daily_reach', 'peak_daily_reach',
      'profile_views', 'likes', 'shares', 'comments',
      'new_followers', 'lost_followers', 'net_follower_growth',
      'daily_interactions_sum', 'daily_engagement_sum'], tiktokOverview);
  addObjectSheet(wb, 'tiktok_overview_daily',
    ['account_username', 'account_name', 'normalized_name', 'date', 'date_value',
      'month', 'month_date', 'video_views', 'daily_reach', 'profile_views',
      'likes', 'shares', 'comments', 'new_followers', 'lost_followers',
      'net_follower_growth'], tiktokDaily);

  addObjectSheet(wb, 'posts_groups_monthly',
    ['group_id', 'group_name', 'month', 'month_date', 'member_count', 'post_count',
      'views', 'link_clicks', 'interactions', 'avg_daily_link_clicks'], postsGroupRows);
  addObjectSheet(wb, 'ga_listens_groups_monthly',
    ['group_id', 'group_name', 'month', 'month_date', 'member_count', 'listens',
      'avg_daily_listens'], listensGroupRows);
  addObjectSheet(wb, 'ga_site_visits_groups_monthly',
    ['group_id', 'group_name', 'month', 'month_date', 'member_count', 'visits',
      'avg_daily_visits'], visitsGroupRows);

  addObjectSheet(wb, 'dim_accounts',
    ['account_name', 'normalized_name', 'platform', 'is_p4'],
    dimAccounts(posts, reach, tiktokPosts, tiktokOverview));
  addObjectSheet(wb, 'dim_account_key',
    ['normalized_name', 'is_p4'],
    dimAccountKey([posts, listens, visits, reach, tiktokPosts, tiktokOverview]));
  addObjectSheet(wb, 'dim_groups',
    ['group_id', 'group_name', 'source'], dimGroups(allGroups));
  addObjectSheet(wb, 'dim_group_members',
    ['group_id', 'account_name', 'normalized_name'], dimGroupMembers(allGroups));

  return wb;
}

/** Serialise the workbook to an .xlsx Buffer for the HTTP response. */
export function buildFlatWorkbookBuffer() {
  return XLSX.write(buildFlatWorkbook(), { type: 'buffer', bookType: 'xlsx', cellDates: true });
}
