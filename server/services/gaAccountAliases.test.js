import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the connection at a throwaway DB BEFORE importing it (DB_PATH is read at
// module eval). Dynamic import after the env is set guarantees ordering.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-alias-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { canonicalGaAccountName } = await import('./gaAccountAliases.js');
const { importGaListensCSV } = await import('./gaListensImporter.js');
const { importGaSiteVisitsCSV } = await import('./gaSiteVisitsImporter.js');

const db = getDb(); // runs schema + migrations on the empty temp DB

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('canonicalGaAccountName maps historical Ekot names', () => {
  assert.equal(canonicalGaAccountName('Nyheter (Ekot)'), 'Ekot');
  assert.equal(canonicalGaAccountName('Nyheter från Sveriges Radio Ekot'), 'Ekot');
});

test('canonicalGaAccountName leaves unknown names unchanged', () => {
  assert.equal(canonicalGaAccountName('Ekot'), 'Ekot');
  assert.equal(canonicalGaAccountName('P4 Gävleborg'), 'P4 Gävleborg');
});

test('listens import stores historical Ekot name as Ekot', () => {
  const csv = 'Programnamn,Starter (lyssnat5sek)\nNyheter från Sveriges Radio Ekot,25166\nP1 Dokumentär,1000';
  importGaListensCSV(csv, '2025-01', 'alias-test.csv');

  const rows = db.prepare(
    "SELECT account_name, listens FROM ga_listens WHERE month = '2025-01' ORDER BY account_name"
  ).all();
  assert.deepEqual(rows, [
    { account_name: 'Ekot', listens: 25166 },
    { account_name: 'P1 Dokumentär', listens: 1000 },
  ]);
});

test('visits import folds old and new Ekot names in the same file (max wins)', () => {
  const csv = 'Programnamn,Besök\nEkot,76263\nNyheter (Ekot),1';
  importGaSiteVisitsCSV(csv, '2026-04', 'alias-test.csv');

  const rows = db.prepare(
    "SELECT account_name, visits FROM ga_site_visits WHERE month = '2026-04'"
  ).all();
  assert.deepEqual(rows, [{ account_name: 'Ekot', visits: 76263 }]);
});
