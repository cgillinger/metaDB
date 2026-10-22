import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-nfc-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { importIGReachCSV } = await import('./igReachImporter.js');
const { processImportRoster, retireAccount, listRoster } = await import('./accountRoster.js');
const { hide, isHidden } = await import('./hiddenAccounts.js');

const db = getDb();
const MIGRATION = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations/014_nfc_account_names.sql'),
  'utf-8'
);

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const NFC = 'Meänraatio';
const NFD = 'Meänraatio';
assert.notEqual(NFC, NFD);
assert.equal(NFD.normalize('NFC'), NFC);

function runMigration() {
  db.transaction(() => db.exec(MIGRATION))();
}

test('IG-CSV med NFD-namn lagras som NFC', () => {
  const csv = [
    'ig_username,ig_name,fb_page_name,Reach,Views,Followers,Period_start,Period_end,Views_Source,Status,Comment',
    `meanraatio,${NFD},Page,100,200,50,2026-04-01,2026-04-30,reach@v25.0,OK,`,
  ].join('\n');
  const result = importIGReachCSV(csv, 'IG_2026_04.csv');
  assert.equal(result.imported, 1);
  assert.equal(result.accounts[0].name, NFC);
  const row = db.prepare('SELECT account_name FROM ig_account_reach').get();
  assert.equal(row.account_name, NFC);
  assert.equal(row.account_name.normalize('NFD') === row.account_name, false);
});

test('hide/retire med NFD-namn träffar samma rad som NFC-namnet', () => {
  hide(NFC, 'instagram');
  assert.equal(isHidden(NFD, 'instagram'), true);
  hide(NFD, 'instagram'); // INSERT OR IGNORE — must not create a twin
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hidden_accounts').get().n, 1);

  retireAccount(NFC, 'instagram');
  retireAccount(NFD, 'instagram', 'x');
  const rows = listRoster('instagram').filter(r => r.account_name.normalize('NFC') === NFC);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_name, NFC);
});

test('migration 014 normaliserar NFD i alla sex tabeller och rör inte NFC-rader', () => {
  db.exec(`DELETE FROM hidden_accounts; DELETE FROM account_roster; DELETE FROM ig_account_reach;`);
  const imp = db.prepare(
    "INSERT INTO imports (filename, platform, month) VALUES ('m.csv', 'instagram', '2026-05')"
  ).run().lastInsertRowid;
  const nfd2 = 'Kräftskiva'; // second NFD name
  const nfcKeep = 'Redan NFC å';

  const insertPost = db.prepare(
    "INSERT INTO posts (import_id, post_id, account_name, platform) VALUES (?, ?, ?, 'instagram')"
  );
  insertPost.run(imp, 'mig-1', NFD);
  insertPost.run(imp, 'mig-2', nfcKeep);
  db.prepare("INSERT INTO ig_account_reach (account_name, month, reach) VALUES (?, '2026-05', 1)").run(NFD);
  db.prepare("INSERT INTO ig_account_reach (account_name, month, reach) VALUES (?, '2026-05', 2)").run(nfcKeep);
  db.prepare("INSERT INTO import_accounts (import_id, account_name) VALUES (?, ?)").run(imp, NFD);
  db.prepare("INSERT INTO import_accounts (import_id, account_name) VALUES (?, ?)").run(imp, nfcKeep);
  db.prepare("INSERT INTO account_roster (account_name, platform) VALUES (?, 'instagram')").run(NFD);
  db.prepare("INSERT INTO account_roster (account_name, platform) VALUES (?, 'instagram')").run(nfcKeep);
  db.prepare("INSERT INTO hidden_accounts (account_name, platform) VALUES (?, 'instagram')").run(nfd2);
  db.prepare("INSERT INTO account_gaps (account_name, platform, month) VALUES (?, 'instagram', '2026-04')").run(NFD);

  runMigration();

  const tables = ['posts', 'ig_account_reach', 'import_accounts', 'account_roster', 'hidden_accounts', 'account_gaps'];
  for (const t of tables) {
    const names = db.prepare(`SELECT account_name FROM ${t}`).all().map(r => r.account_name);
    assert.ok(names.length > 0, t);
    for (const n of names) assert.equal(n, n.normalize('NFC'), `${t} har fortfarande NFD: ${n}`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts WHERE account_name = ?').get(NFC).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM posts WHERE account_name = ?').get(nfcKeep).n, 1);
  assert.equal(db.prepare('SELECT reach FROM ig_account_reach WHERE account_name = ?').get(nfcKeep).reach, 2);
  assert.equal(db.prepare('SELECT account_name FROM hidden_accounts').get().account_name, nfd2.normalize('NFC'));
});

test('migration 014 kastar vid krock och ändrar ingenting', () => {
  db.exec(`DELETE FROM ig_account_reach;`);
  db.prepare("INSERT INTO ig_account_reach (account_name, month, reach) VALUES (?, '2026-06', 1)").run(NFC);
  db.prepare("INSERT INTO ig_account_reach (account_name, month, reach) VALUES (?, '2026-06', 2)").run(NFD);

  assert.throws(runMigration, /nfc_collision_found/);

  const names = db.prepare('SELECT account_name FROM ig_account_reach ORDER BY reach').all().map(r => r.account_name);
  assert.deepEqual(names, [NFC, NFD]); // rolled back, nothing merged or deleted
  db.exec('DELETE FROM ig_account_reach');
});

test('roster: samma konto i NFD efter att DB är NFC ger inget falskt namnbyte', () => {
  const ID = 'nfc-rename-1';
  const mk = (month, n) => {
    const id = db.prepare(
      'INSERT INTO imports (filename, platform, month, imported_at) VALUES (?, ?, ?, ?)'
    ).run(`n${month}.csv`, 'instagram', month, `2026-02-${String(n).padStart(2, '0')} 00:00:00`).lastInsertRowid;
    db.prepare(
      "INSERT INTO posts (import_id, post_id, account_name, account_id, platform, publish_time) VALUES (?, ?, ?, ?, 'instagram', ?)"
    ).run(id, `nfcp-${month}`, NFC, ID, `${month}-15 10:00:00`);
    return id;
  };
  processImportRoster(db, 'instagram', '2026-01', mk('2026-01', 1), [{ name: NFC, id: ID }]);

  // Next month: same account, name arrives as NFD from the export.
  const importId = mk('2026-02', 2);
  const result = processImportRoster(db, 'instagram', '2026-02', importId, [{ name: NFD, id: ID }]);

  assert.deepEqual(result.renamedAccounts, []);
  const rows = db.prepare(
    'SELECT account_name FROM account_roster WHERE account_id = ?'
  ).all(ID);
  assert.deepEqual(rows, [{ account_name: NFC }]);
});
