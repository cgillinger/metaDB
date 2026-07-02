import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the connection at a throwaway DB BEFORE importing it (DB_PATH is read at
// module eval). Dynamic import after the env is set guarantees ordering.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-viewers-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { importViewersCSV, isViewersCSV, getViewersMonths, deleteViewersMonth } =
  await import('./viewersImporter.js');
const { importReachCSV } = await import('./reachImporter.js');

const db = getDb(); // runs schema + migrations on the empty temp DB

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const VIEWERS_CSV = [
  'Page,Page ID,Reach,Period_start,Period_end,Views_Source,Status,Comment',
  'P4 Örebro Sveriges Radio,188449786530,968674,2026-05-01,2026-05-31,page_total_media_view_unique@v25.0,OK,',
  'Srholder1,111,5,2026-05-01,2026-05-31,page_total_media_view_unique@v25.0,OK,',
  'P4 Dalarna,222,417000,2026-05-01,2026-05-31,page_total_media_view_unique@v25.0,NO_DATA,',
].join('\n');

const LEGACY_CSV = [
  'Page,Page ID,Reach,Engaged Users,Engagements,Reactions,Publications,Status,Comment',
  'P4 Örebro Sveriges Radio,188449786530,1021732,0,900,50,80,OK,',
].join('\n');

test('isViewersCSV requires Views_Source on top of legacy headers', () => {
  assert.equal(isViewersCSV(['Page', 'Page ID', 'Reach', 'Views_Source']), true);
  assert.equal(isViewersCSV(['Page', 'Page ID', 'Reach']), false);
});

test('importViewersCSV imports viewers, auto-detects month, skips placeholders/NO_DATA', () => {
  const result = importViewersCSV(VIEWERS_CSV, 'FB_2026_05.csv');
  assert.equal(result.month, '2026-05');
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);

  const row = db.prepare(
    "SELECT * FROM account_viewers WHERE account_name = 'P4 Örebro Sveriges Radio'"
  ).get();
  assert.equal(row.viewers, 968674);
  assert.equal(row.period_start, '2026-05-01');
  assert.equal(row.period_end, '2026-05-31');
  assert.equal(row.views_source, 'page_total_media_view_unique@v25.0');
});

test('importViewersCSV rejects unknown Views_Source metric', () => {
  const bad = VIEWERS_CSV.replace(/page_total_media_view_unique@v25\.0/g, 'page_impressions@v26.0');
  assert.throws(() => importViewersCSV(bad, 'x.csv'), /Okänt mått i Views_Source/);
});

test('importReachCSV rejects viewers files (Views_Source present)', () => {
  assert.throws(() => importReachCSV(VIEWERS_CSV, null, 'FB_2026_05.csv'), /Unika tittare-export/);
});

test('importReachCSV still accepts genuine legacy files', () => {
  const result = importReachCSV(LEGACY_CSV, '2026-04', 'FB_2026_04.csv');
  assert.equal(result.imported, 1);
  const row = db.prepare(
    "SELECT reach FROM account_reach WHERE account_name = 'P4 Örebro Sveriges Radio' AND month = '2026-04'"
  ).get();
  assert.equal(row.reach, 1021732);
});

test('viewers and legacy reach for the same month live in separate tables', () => {
  importReachCSV(LEGACY_CSV, '2026-05', 'FB_2026_05_legacy.csv');
  const legacy = db.prepare(
    "SELECT reach FROM account_reach WHERE account_name = 'P4 Örebro Sveriges Radio' AND month = '2026-05'"
  ).get();
  const viewers = db.prepare(
    "SELECT viewers FROM account_viewers WHERE account_name = 'P4 Örebro Sveriges Radio' AND month = '2026-05'"
  ).get();
  assert.equal(legacy.reach, 1021732);
  assert.equal(viewers.viewers, 968674);
});

test('getViewersMonths and deleteViewersMonth round-trip', () => {
  assert.deepEqual(getViewersMonths(), ['2026-05']);
  const res = deleteViewersMonth('2026-05');
  assert.equal(res.changes, 1);
  assert.deepEqual(getViewersMonths(), []);
});
