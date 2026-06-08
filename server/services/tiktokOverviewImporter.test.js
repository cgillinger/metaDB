import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

// Riktigt test mot ett temporärt DB. Sätter DB_PATH innan connection-modulen laddas.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DB = path.join(__dirname, '__tiktok_tmp.db');

process.env.DB_PATH = TMP_DB;

// Importeras EFTER att DB_PATH satts.
const { importTikTokOverviewCSV, getTikTokOverviewMonths, getTikTokOverviewMonthlySummary } =
  await import('./tiktokOverviewImporter.js');

before(() => {
  // getDb() i tiktokOverviewImporter triggas via importerings-anropet — initierar nytt tomt DB.
});

after(() => {
  try { fs.unlinkSync(TMP_DB); } catch {}
  try { fs.unlinkSync(TMP_DB + '-wal'); } catch {}
  try { fs.unlinkSync(TMP_DB + '-shm'); } catch {}
});

const OVERVIEW_CSV = [
  'Datum,Videovisningar,Målgrupp som nåtts,Profilvisningar,Gilla-markeringar,Delningar,Kommentarer,Nettotillväxt,Nya följare,Tappade följare',
  '2026/04/01,60234,58934,907,3979,415,35,80,98,18',
  '2026/04/02,58807,56695,979,3217,313,41,56,70,14',
  '2026/04/03,41230,39706,576,2219,134,17,22,34,12',
].join('\n');

test('importTikTokOverviewCSV ingests rows with handle + display name', () => {
  const result = importTikTokOverviewCSV(OVERVIEW_CSV, {
    accountUsername: 'p3dingata',
    accountName: 'P3 Din Gata',
    filename: 'AprilP3_Din_Gata_versikt.csv',
  });
  assert.equal(result.imported, 3);
  assert.equal(result.month, '2026-04');
  assert.equal(result.account_username, 'p3dingata');
  assert.equal(result.account_name, 'P3 Din Gata');
  assert.equal(result.netGrowthMismatches, 0);
});

test('getTikTokOverviewMonths returns ingested month', () => {
  const months = getTikTokOverviewMonths();
  assert.deepEqual(months, ['2026-04']);
});

test('monthly summary aggregates correctly with reach as AVG, others as SUM', () => {
  const summary = getTikTokOverviewMonthlySummary(['2026-04']);
  assert.equal(summary.length, 1);
  const row = summary[0];
  assert.equal(row.account_username, 'p3dingata');
  assert.equal(row.month, '2026-04');
  // SUM över 3 dagar
  assert.equal(row.video_views, 60234 + 58807 + 41230);
  assert.equal(row.new_followers, 98 + 70 + 34);
  assert.equal(row.lost_followers, 18 + 14 + 12);
  assert.equal(row.net_follower_growth, (98 + 70 + 34) - (18 + 14 + 12));
  // AVG för räckvidd
  const avgReach = Math.round((58934 + 56695 + 39706) / 3);
  assert.equal(row.avg_daily_reach, avgReach);
  // Peak
  assert.equal(row.peak_daily_reach, 58934);
});

test('re-import same date overwrites (ny data vinner)', () => {
  const updatedCsv = [
    'Datum,Videovisningar,Målgrupp som nåtts,Profilvisningar,Gilla-markeringar,Delningar,Kommentarer,Nettotillväxt,Nya följare,Tappade följare',
    '2026/04/01,999999,999999,9999,9999,9999,9999,0,0,0',
  ].join('\n');
  importTikTokOverviewCSV(updatedCsv, {
    accountUsername: 'p3dingata',
    accountName: 'P3 Din Gata',
  });
  const summary = getTikTokOverviewMonthlySummary(['2026-04']);
  const row = summary[0];
  // Apr-01 ersatt med 999999, övriga dagar oförändrade
  assert.equal(row.video_views, 999999 + 58807 + 41230);
});

test('rejects CSV with multiple months', () => {
  const multi = [
    'Datum,Videovisningar,Målgrupp som nåtts,Profilvisningar,Gilla-markeringar,Delningar,Kommentarer,Nya följare,Tappade följare',
    '2026/03/31,100,100,10,10,1,1,1,0',
    '2026/04/01,200,200,20,20,2,2,2,0',
  ].join('\n');
  assert.throws(
    () => importTikTokOverviewCSV(multi, { accountUsername: 'multitest' }),
    /flera månader/i,
  );
});

test('rejects upload without account username', () => {
  assert.throws(
    () => importTikTokOverviewCSV(OVERVIEW_CSV, {}),
    /account_username/i,
  );
});

test('rejects non-TikTok-Översikt CSV', () => {
  const wrong = 'Foo,Bar\n1,2';
  assert.throws(
    () => importTikTokOverviewCSV(wrong, { accountUsername: 'x' }),
    /TikTok Översikt/i,
  );
});
