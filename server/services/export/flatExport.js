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
  hiddenSiteVisitsFilter, hiddenIGReachFilter,
} from '../hiddenAccounts.js';
import { getEstimatedUniqueClicks } from '../estimatedUniqueClicks.js';
import { getAccountGroups } from '../accountGroupService.js';
import { normalizeMetaName } from '../comparisonService.js';
import { avgPerDay } from '../metrics/dailyAverages.js';
import { daysInMonth } from '../../utils/dateHelpers.js';
import { P4_REGIONS } from '../../../shared/p4Regions.js';
import * as XLSX from 'xlsx';

/** First day of a 'YYYY-MM' month as a real Date (local midnight → clean Excel date). */
function monthDate(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/** True if a Meta account name is one of the 25 active P4 local stations. */
function isP4(accountName) {
  return !!accountName && P4_REGIONS.some(r => accountName.startsWith(`P4 ${r}`));
}

// ---- Account-grain tabs -----------------------------------------------------

function postsMonthly(db) {
  const rows = db.prepare(`
    SELECT account_name, platform, strftime('%Y-%m', publish_time) AS month,
      COUNT(*) AS post_count, SUM(views) AS views, SUM(reach) AS reach,
      SUM(link_clicks) AS link_clicks, SUM(interactions) AS interactions
    FROM posts
    WHERE publish_time IS NOT NULL ${hiddenPostsFilter()}
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
  return getEstimatedUniqueClicks().map(r => ({
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
    WHERE 1=1 ${hiddenGAFilter()} ORDER BY account_name, month
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
    WHERE 1=1 ${hiddenSiteVisitsFilter()} ORDER BY account_name, month
  `).all();
  return rows.map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    month: r.month, month_date: monthDate(r.month),
    visits: r.visits,
    avg_daily_visits: avgPerDay(r.visits, daysInMonth(r.month), 1),
  }));
}

function accountReachMonthly(db) {
  const fb = db.prepare(`
    SELECT account_name, month, reach FROM account_reach
    WHERE 1=1 ${hiddenReachFilter()} ORDER BY account_name, month
  `).all().map(r => ({ ...r, platform: 'facebook' }));
  const ig = db.prepare(`
    SELECT account_name, month, reach FROM ig_account_reach
    WHERE 1=1 ${hiddenIGReachFilter()} ORDER BY account_name, month
  `).all().map(r => ({ ...r, platform: 'instagram' }));
  return [...fb, ...ig].map(r => ({
    account_name: r.account_name, normalized_name: normalizeMetaName(r.account_name),
    platform: r.platform,
    month: r.month, month_date: monthDate(r.month), account_reach: r.reach,
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
function dimAccounts(postsRows, reachRows) {
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
  ['per-konto reach/account_reach som ett GENOMSNITT, aldrig som en summa.'],
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
  ['Flikar: posts_monthly, estimated_unique_clicks_monthly, ga_listens_monthly,'],
  ['ga_site_visits_monthly, account_reach_monthly, posts_groups_monthly,'],
  ['ga_listens_groups_monthly, ga_site_visits_groups_monthly, dim_accounts,'],
  ['dim_account_key, dim_groups, dim_group_members.'],
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
    ['account_name', 'normalized_name', 'platform', 'is_p4'], dimAccounts(posts, reach));
  addObjectSheet(wb, 'dim_account_key',
    ['normalized_name', 'is_p4'], dimAccountKey([posts, listens, visits, reach]));
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
