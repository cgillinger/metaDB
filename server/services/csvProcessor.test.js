import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from './csvProcessor.js';

// Minimal Facebook CSV (header 'Sidnamn' makes detectPlatform pick facebook).
// Row 1: empty Sidnamn + resolvable permalink → attributed from slug map.
// Row 2: empty Sidnamn + denylisted reel URL → must NOT be attributed.
// Row 3: present Sidnamn → untouched.
const CSV = [
  'Publicerings-id,Sidnamn,Permalänk,Publiceringstid',
  '1,,https://www.facebook.com/p4kalmar/posts/pfbid0abc,2026-02-10 12:00:00',
  '2,,https://www.facebook.com/reel/699716579231102/,2026-02-11 12:00:00',
  '3,P4 Named,https://www.facebook.com/p4named/posts/x,2026-02-12 12:00:00',
].join('\n');

const slugMap = new Map([
  ['facebook::p4kalmar', { account_name: 'P4 Kalmar Sveriges Radio', account_id: '123' }],
]);

test('parseCSV attributes empty Sidnamn from permalink slug', () => {
  const { posts, stats } = parseCSV(CSV, 'fb.csv', { slugMap });
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));

  // Positive: resolved from slug map.
  assert.equal(byId['1'].account_name, 'P4 Kalmar Sveriges Radio');
  assert.equal(byId['1'].account_id, '123');

  // Denylisted URL (reel) → never attributed, stays empty.
  assert.equal(byId['2'].account_name, null);

  // Existing name untouched.
  assert.equal(byId['3'].account_name, 'P4 Named');

  assert.equal(stats.attributedViaPermalink, 1);
});

test('parseCSV without a slugMap leaves empty Sidnamn empty', () => {
  const { posts, stats } = parseCSV(CSV, 'fb.csv');
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));
  assert.equal(byId['1'].account_name, null);
  assert.equal(stats.attributedViaPermalink, 0);
});

// Pacific→Stockholm-konverteringen måste vara oberoende av processens tidszon.
// Regressionsskydd för TZ-buggen där `new Date(str)` tolkades i serverns lokala
// tidszon: resultatet var bara korrekt på UTC-servrar, och inlägg nära midnatt
// vid månadsskifte bokfördes på fel månad.
test('parseCSV converts Pacific publish times to Stockholm, TZ-independent', () => {
  const csv = [
    'Publicerings-id,Sidnamn,Titel,Publiceringstid,Inläggstyp',
    '10,TestSida,Vinter,2026-01-15 14:30:00,Foton',   // PST (UTC-8) → +9h till Stockholm
    '11,TestSida,Sommar,2026-05-31 16:30:00,Foton',   // PDT (UTC-7) → +9h, korsar månadsskiftet
  ].join('\n');
  const { posts, month, dateRangeStart, dateRangeEnd } = parseCSV(csv, 'fb.csv');
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));

  assert.equal(byId['10'].publish_time, '2026-01-15 23:30:00');
  assert.equal(byId['11'].publish_time, '2026-06-01 01:30:00');

  // Månad och datumintervall härleds ur Stockholm-tider, inte UTC-round-trip
  assert.equal(month, '2026-01');
  assert.equal(dateRangeStart, '2026-01-15');
  assert.equal(dateRangeEnd, '2026-06-01');
});

// Meta Business Suite exporterar publiceringstid i US-format MM/DD/YYYY HH:MM
// (utan sekunder). Regressionsskydd för julibuggen 2026-08: v2.22.0:s strikta
// ISO-regex släppte igenom US-datum oparsade → NULL-månader i alla aggregat.
test('parseCSV converts US-format (MM/DD/YYYY) Meta dates to Stockholm', () => {
  const csv = [
    'Publicerings-id,Sidnamn,Titel,Publiceringstid,Inläggstyp',
    '20,TestSida,Juli,07/01/2026 00:15,Foton',      // PDT (UTC-7) → +9h till Stockholm
    '21,TestSida,Vinter,01/15/2026 14:30,Foton',    // PST (UTC-8) → +9h
  ].join('\n');
  const { posts, dateRangeStart } = parseCSV(csv, 'fb.csv');
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));

  assert.equal(byId['20'].publish_time, '2026-07-01 09:15:00');
  assert.equal(byId['21'].publish_time, '2026-01-15 23:30:00');
  assert.equal(dateRangeStart, '2026-01-15');
});

// Okänt datumformat får aldrig importeras tyst — hela filen ska avvisas
// med ett fel som visar exempelvärden.
test('parseCSV rejects the whole file on unparseable publish times', () => {
  const csv = [
    'Publicerings-id,Sidnamn,Titel,Publiceringstid,Inläggstyp',
    '30,TestSida,Trasig,15 januari 2026 kl 14:30,Foton',
  ].join('\n');
  assert.throws(
    () => parseCSV(csv, 'fb.csv'),
    /okänt datumformat.*15 januari 2026/
  );
});

// --- Spärr mot FB-exporter med daglig nedbrytning (TASK-import-guard-daily-breakdown.md) ---
// Meta Business Suite kan exportera per-inlägg-statistik uppdelad per dag i
// stället för per inlägg. Filen saknar Visningar helt och varje Publicerings-id
// förekommer en gång per dag i exportperioden, vilket ger views = 0 och
// interaktioner för en enskild dag i stället för månadstotalen om den släpps
// igenom.
function buildDailyBreakdownCsv() {
  const header = 'Publicerings-id,Sidnamn,Datum,Publiceringstid,Reaktioner,Kommentarer,Delningar';
  const rows = [];
  // Två inlägg, vardera nedbrutet på fyra dagar → radie unika id/rader = 2/8 = 0.25.
  for (const id of ['500', '501']) {
    for (let day = 1; day <= 4; day++) {
      rows.push(`${id},Radio Romano,2026-02-0${day},02/0${day}/2026 12:00,10,2,1`);
    }
  }
  return [header, ...rows].join('\n');
}

test('parseCSV avvisar FB-fil med daglig nedbrytning (Visningar saknas, låg id-radie)', () => {
  assert.throws(
    () => parseCSV(buildDailyBreakdownCsv(), 'daily.csv'),
    /daglig nedbrytning/
  );
});

// Regressionsskydd: en korrekt inläggsexport har också en Datum-liknande kolumn
// (Publiceringstid) och radie nära 1 — Datum ensamt får inte trigga spärren.
test('parseCSV accepterar normal FB-inläggsexport (Visningar finns, radie ~1)', () => {
  const csv = [
    'Publicerings-id,Sidnamn,Datum,Publiceringstid,Visningar,Reaktioner,Kommentarer,Delningar',
    '600,Radio Romano,2026-02-01,02/01/2026 12:00,1200,10,2,1',
    '601,Radio Romano,2026-02-05,02/05/2026 12:00,980,8,1,0',
    '602,Radio Romano,2026-02-10,02/10/2026 12:00,2100,15,3,2',
  ].join('\n');
  const { posts, platform } = parseCSV(csv, 'fb.csv');
  assert.equal(platform, 'facebook');
  assert.equal(posts.length, 3);
  assert.equal(posts.find(p => p.post_id === '600').views, 1200);
});

// Filer som inte kan identifieras som Facebook eller Instagram ska fortfarande
// avvisas med det befintliga plattformsfelet, inte den nya daglig-nedbrytning-
// spärren — spärren ligger bakom platform === 'facebook' och får inte
// skugga det generella felet. (TikTok Översikt fanns i den ursprungliga
// testplanen men är borttaget ur kodbasen sedan migration 010 — ingen
// TikTok-importväg finns kvar att testa mot.)
test('parseCSV: okänd plattform ger fortfarande plattformsfelet, inte daglig-nedbrytning-felet', () => {
  const csv = [
    'Video ID,Video views,Date,Likes',
    '1,999,2026-02-01,5',
  ].join('\n');
  assert.throws(
    () => parseCSV(csv, 'unknown.csv'),
    /Kunde inte identifiera plattform/
  );
});

// Instagram-vägen ska aldrig träffas av FB-spärren, även i ett adversariellt
// fall (ingen Visningar-kolumn, samma Publicerings-id upprepat) som skulle
// avvisats om guarden läckt in på IG-vägen.
test('parseCSV: IG-export med lågt id/rad-förhållande avvisas inte av FB-spärren', () => {
  const csv = [
    'Publicerings-id,Konto-id,Kontots användarnamn,Kontonamn,Publiceringstid,Gilla-markeringar,Kommentarer,Delningar',
    '700,111,p4test,P4 Test,02/01/2026 12:00,10,2,1',
    '700,111,p4test,P4 Test,02/02/2026 12:00,11,2,1',
    '700,111,p4test,P4 Test,02/03/2026 12:00,12,2,1',
    '700,111,p4test,P4 Test,02/04/2026 12:00,13,2,1',
  ].join('\n');
  const { platform, posts } = parseCSV(csv, 'ig.csv');
  assert.equal(platform, 'instagram');
  assert.ok(posts.length > 0);
});

test('parseCSV: felmeddelandet för daglig nedbrytning nämner Visningar och vad man ska göra', () => {
  assert.throws(
    () => parseCSV(buildDailyBreakdownCsv(), 'daily.csv'),
    /Visningar/
  );
  assert.throws(
    () => parseCSV(buildDailyBreakdownCsv(), 'daily.csv'),
    /inläggsvyn/
  );
});
