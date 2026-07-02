import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the connection at a throwaway DB BEFORE importing it (DB_PATH is read at
// module eval). Dynamic import after the env is set guarantees ordering.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-igreach-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { importIGReachCSV } = await import('./igReachImporter.js');

const db = getDb(); // runs schema + migrations on the empty temp DB

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const CSV = [
  'ig_username,ig_name,fb_page_name,Reach,Views,Followers,Period_start,Period_end,Views_Source,Status,Comment',
  'stilip1,Stil i P1,Srholder9d,14853,20000,5000,2026-04-01,2026-04-30,reach@v25.0,OK,',
  'sverigesradiossymfoniorkester,,Sveriges Radios Symfoniorkester,5335,9000,12000,2026-04-01,2026-04-30,reach@v25.0,OK,',
  'srholder2x,,Srholder2,10,20,5,2026-04-01,2026-04-30,reach@v25.0,OK,',
].join('\n');

test('empty ig_name falls back to ig_username instead of being skipped', () => {
  const result = importIGReachCSV(CSV, 'IG_2026_04.csv');
  assert.equal(result.month, '2026-04');
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1); // srholder placeholder still skipped

  const row = db.prepare(
    "SELECT account_name, ig_username, reach FROM ig_account_reach WHERE ig_username = 'sverigesradiossymfoniorkester'"
  ).get();
  assert.equal(row.account_name, 'sverigesradiossymfoniorkester');
  assert.equal(row.reach, 5335);

  const named = db.prepare(
    "SELECT account_name FROM ig_account_reach WHERE ig_username = 'stilip1'"
  ).get();
  assert.equal(named.account_name, 'Stil i P1');
});
