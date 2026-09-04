import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the connection at a throwaway DB BEFORE importing it (DB_PATH is read at
// module eval). Dynamic import after the env is set guarantees ordering.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-roster-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const {
  processImportRoster, listOpenGaps, retireAccount, listRoster,
  getScopedHistory, getScopedOpenGapAccounts,
  dismissGapMonth, reopenGapMonth, registerGaps, autoResolveGaps,
} = await import('./accountRoster.js');

const db = getDb(); // runs schema + migrations (incl. 011) on the empty temp DB

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let importSeq = 0;
let postSeq = 0;

/** Inserts an `imports` row with a controlled imported_at so ordering is deterministic. */
function makeImport(platform, month, seqOverride) {
  importSeq++;
  const seq = seqOverride ?? importSeq;
  const importedAt = `2026-01-${String(seq).padStart(2, '0')} 00:00:00`;
  const info = db.prepare(
    'INSERT INTO imports (filename, platform, month, imported_at) VALUES (?, ?, ?, ?)'
  ).run(`f${seq}.csv`, platform, month, importedAt);
  return info.lastInsertRowid;
}

function makePost(importId, platform, accountName, month, accountId = null) {
  postSeq++;
  db.prepare(`
    INSERT INTO posts (import_id, post_id, account_name, account_id, platform, publish_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(importId, `p${postSeq}`, accountName, accountId, platform, `${month}-15 10:00:00`);
}

// A five-account "riks" group posts every month; used across several tests.
const RIKS = ['P4 Alpha', 'P4 Bravo', 'P4 Charlie', 'P4 Delta', 'P4 Echo'];

test('processImportRoster: konto som saknas >=4/6 gånger flaggas med reason=threshold', () => {
  // 6 historical "riks" imports, all with the full RIKS group.
  for (let i = 1; i <= 6; i++) {
    const importId = makeImport('facebook', `2025-0${i}`, i);
    for (const name of RIKS) makePost(importId, 'facebook', name, `2025-0${i}`);
    processImportRoster(db, 'facebook', `2025-0${i}`, importId, RIKS);
  }

  // The 7th import (same "riks" scope) is missing P4 Charlie.
  const missingSet = RIKS.filter(n => n !== 'P4 Charlie');
  const importId = makeImport('facebook', '2025-07', 7);
  for (const name of missingSet) makePost(importId, 'facebook', name, '2025-07');
  const result = processImportRoster(db, 'facebook', '2025-07', importId, missingSet);

  assert.equal(result.missingAccounts.length, 1);
  assert.equal(result.missingAccounts[0].account_name, 'P4 Charlie');
  assert.equal(result.missingAccounts[0].reason, 'threshold');
  assert.equal(result.missingAccounts[0].seenIn, 6);
  assert.equal(result.gapsRegistered, 1);

  // The gap now exists in account_gaps and shows up in "Öppna luckor".
  const gaps = listOpenGaps('facebook');
  const charlie = gaps.find(g => g.account_name === 'P4 Charlie');
  assert.ok(charlie, 'P4 Charlie ska ha en öppen lucka');
  assert.deepEqual(charlie.months, ['2025-07']);
});

test('auto-rensning: en senare import som innehåller kontot igen stänger luckan', () => {
  // Builds on the gap from the previous test (P4 Charlie missing 2025-07).
  const importId = makeImport('facebook', '2025-08', 8);
  for (const name of RIKS) makePost(importId, 'facebook', name, '2025-08');
  const result = processImportRoster(db, 'facebook', '2025-08', importId, RIKS);

  // Charlie is back — no new alarm for Charlie this time.
  assert.ok(!result.missingAccounts.some(m => m.account_name === 'P4 Charlie'));

  // But the gap for 2025-07 is still open (this import only contained
  // 2025-08 posts for Charlie, not 2025-07).
  const gapsAfter = listOpenGaps('facebook');
  const charlie = gapsAfter.find(g => g.account_name === 'P4 Charlie');
  assert.ok(charlie, 'lucka för 2025-07 ska fortfarande vara öppen — importen fyllde bara 2025-08');
});

test('auto-rensning stänger rätt (konto, månad) när en riktad backfill fyller just den luckan', () => {
  const importId = makeImport('facebook', '2025-07', 9);
  makePost(importId, 'facebook', 'P4 Charlie', '2025-07');
  processImportRoster(db, 'facebook', '2025-07', importId, ['P4 Charlie']);

  const gaps = listOpenGaps('facebook');
  const charlie = gaps.find(g => g.account_name === 'P4 Charlie');
  assert.ok(!charlie, 'lucka för P4 Charlie 2025-07 ska vara stängd efter backfillen');
});

test('retirerat konto döljs ur Öppna luckor men raden i account_gaps raderas inte', () => {
  const importId = makeImport('facebook', '2025-09', 10);
  const withoutDelta = RIKS.filter(n => n !== 'P4 Delta');
  for (const name of withoutDelta) makePost(importId, 'facebook', name, '2025-09');
  processImportRoster(db, 'facebook', '2025-09', importId, withoutDelta);

  let gaps = listOpenGaps('facebook');
  assert.ok(gaps.find(g => g.account_name === 'P4 Delta'), 'Delta ska ha en lucka innan avveckling');

  retireAccount('P4 Delta', 'facebook', 'Nedlagt program');

  gaps = listOpenGaps('facebook');
  assert.ok(!gaps.find(g => g.account_name === 'P4 Delta'), 'avvecklat konto ska inte synas i Öppna luckor');

  const roster = listRoster('facebook');
  const deltaRow = roster.find(r => r.account_name === 'P4 Delta');
  assert.equal(deltaRow.status, 'retired');
});

test('enkonto-backfillfil förorenar inte Jaccard-historiken och larmar inte falskt', () => {
  // A targeted single-account export (low overlap both ways against the RIKS group).
  const backfillImport = makeImport('facebook', '2025-10', 11);
  makePost(backfillImport, 'facebook', 'P4 Echo', '2025-10');
  const backfillResult = processImportRoster(db, 'facebook', '2025-10', backfillImport, ['P4 Echo']);
  assert.equal(backfillResult.missingAccounts.length, 0, 'enkonto-fil ska inte larma om resten av gruppen');

  // The next real "riks" import should not see the single-account file in its history.
  const history = getScopedHistory(db, 'facebook', new Set(RIKS), { window: 6 });
  assert.ok(!history.some(h => h.names.size === 1), 'enkontofilen ska inte dyka upp i Jaccard-historiken');
});

test('öppen lucka läcker inte mellan scope (riks vs lokalt)', () => {
  // "Riks" group: six imports, one account (P4 Foxtrot) is missing from the
  // seventh and gets registered then as a gap with an import_id from that "riks" import.
  const riksAccounts = ['R1', 'R2', 'R3', 'R4', 'R5', 'P4 Foxtrot'];
  for (let i = 1; i <= 6; i++) {
    const importId = makeImport('facebook', `2024-0${i}`, 20 + i);
    for (const name of riksAccounts) makePost(importId, 'facebook', name, `2024-0${i}`);
    processImportRoster(db, 'facebook', `2024-0${i}`, importId, riksAccounts);
  }
  const withoutFoxtrot = riksAccounts.filter(n => n !== 'P4 Foxtrot');
  const gapImportId = makeImport('facebook', '2024-07', 27);
  for (const name of withoutFoxtrot) makePost(gapImportId, 'facebook', name, '2024-07');
  const gapResult = processImportRoster(db, 'facebook', '2024-07', gapImportId, withoutFoxtrot);
  assert.ok(gapResult.missingAccounts.some(m => m.account_name === 'P4 Foxtrot'));

  // A completely disjoint "lokalt" group is imported afterwards (low overlap against "riks").
  const lokaltAccounts = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  const lokaltImportId = makeImport('facebook', '2024-08', 28);
  for (const name of lokaltAccounts) makePost(lokaltImportId, 'facebook', name, '2024-08');

  // The "lokalt" file should not see P4 Foxtrot's open gap as "its own" —
  // otherwise a completely unrelated group would extend a "riks" gap every month.
  const scopedOpenGaps = getScopedOpenGapAccounts(db, 'facebook', new Set(lokaltAccounts));
  assert.ok(!scopedOpenGaps.has('P4 Foxtrot'), 'lokalt-importen ska inte scopas till riks-luckan');
});

test('NULL-import_id-lucka (seedad) scopas via kontots senaste förekomst — flaggas i en riks-liknande import', () => {
  // Simulates the Kvällspasset/Naturmorgon case: the account is below the
  // 4/6 threshold (only ONE historical import in the window) and its seeded
  // gap (migration 011) has import_id = NULL. Without special handling of
  // NULL rows it never gets scoped into openGapAccounts, and the account
  // never alarms again.
  const originAccounts = ['P6 Alpha', 'P6 Bravo', 'P6 Charlie', 'P6 Delta', 'P6 Echo', 'Kvällspasset Test'];

  // The account's most recent REAL appearance, long ago.
  const originImportId = makeImport('facebook', '2024-01', 50);
  for (const name of originAccounts) makePost(originImportId, 'facebook', name, '2024-01');
  processImportRoster(db, 'facebook', '2024-01', originImportId, originAccounts);

  // Simulates migration 011's static seed: an unresolved gap without an import_id.
  db.prepare(
    'INSERT INTO account_gaps (account_name, platform, month, import_id) VALUES (?, ?, ?, NULL)'
  ).run('Kvällspasset Test', 'facebook', '2025-01');

  // A new, "riks"-like import (Jaccard against the origin import 5/6 ≈ 0.83)
  // that still lacks the account.
  const currentAccounts = originAccounts.filter(n => n !== 'Kvällspasset Test');
  const currentImportId = makeImport('facebook', '2026-01', 60);
  for (const name of currentAccounts) makePost(currentImportId, 'facebook', name, '2026-01');
  const result = processImportRoster(db, 'facebook', '2026-01', currentImportId, currentAccounts);

  const flagged = result.missingAccounts.find(m => m.account_name === 'Kvällspasset Test');
  assert.ok(flagged, 'Kvällspasset Test ska flaggas trots att den ligger under 4/6-tröskeln');
  assert.equal(flagged.reason, 'open-gap');

  // New month registered, the seeded gap still exists — not the same row.
  const gaps = listOpenGaps('facebook');
  const kv = gaps.find(g => g.account_name === 'Kvällspasset Test');
  assert.ok(kv);
  assert.deepEqual([...kv.months].sort(), ['2025-01', '2026-01']);
});

test('NULL-import_id-lucka läcker inte till en lokalt-liknande import (scope-läckan kvarstår stängd)', () => {
  // Builds on the previous test: Kvällspasset Test now has open gaps
  // (2025-01 seeded, 2026-01 registered); the account's most recent REAL
  // appearance is still the "riks"-like import from 2024-01.
  const lokaltAccounts = ['L1 Konto', 'L2 Konto', 'L3 Konto', 'L4 Konto', 'L5 Konto', 'L6 Konto'];
  const lokaltImportId = makeImport('facebook', '2026-02', 61);
  for (const name of lokaltAccounts) makePost(lokaltImportId, 'facebook', name, '2026-02');
  const result = processImportRoster(db, 'facebook', '2026-02', lokaltImportId, lokaltAccounts);

  assert.ok(
    !result.missingAccounts.some(m => m.account_name === 'Kvällspasset Test'),
    'lokalt-liknande import ska inte se Kvällspasset Tests lucka som sin'
  );

  const scoped = getScopedOpenGapAccounts(db, 'facebook', new Set(lokaltAccounts));
  assert.ok(!scoped.has('Kvällspasset Test'));
});

test('regression: processImportRoster stör inte en helt vanlig import utan roster-relevans', () => {
  const importId = makeImport('instagram', '2026-03', 40);
  const names = ['IG Konto Ett', 'IG Konto Två'];
  for (const name of names) makePost(importId, 'instagram', name, '2026-03');
  const result = processImportRoster(db, 'instagram', '2026-03', importId, names);
  assert.deepEqual(result.missingAccounts, []);
  assert.equal(result.gapsRegistered, 0);
});

// --- gap_reach: "störst räckvidd i luckorna" sorting measure --------------

test('gap_reach: FB-konto med räckvidd i alla luckmånader summerar och gap_reach_known = months.length', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reach Konto A', 'facebook', '2026-04')"
  ).run();
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reach Konto A', 'facebook', '2026-05')"
  ).run();
  db.prepare(
    "INSERT INTO account_reach (account_name, month, reach) VALUES ('Reach Konto A', '2026-04', 10000)"
  ).run();
  db.prepare(
    "INSERT INTO account_reach (account_name, month, reach) VALUES ('Reach Konto A', '2026-05', 15000)"
  ).run();

  const gaps = listOpenGaps('facebook');
  const row = gaps.find(g => g.account_name === 'Reach Konto A');
  assert.ok(row);
  assert.equal(row.gap_reach, 25000);
  assert.equal(row.gap_reach_known, 2);
  assert.equal(row.gap_reach_known, row.months.length);
});

test('gap_reach: IG-konto med räckvidd för bara en av två luckmånader ger gap_reach_known < months.length', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reach Konto B', 'instagram', '2026-04')"
  ).run();
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reach Konto B', 'instagram', '2026-06')"
  ).run();
  db.prepare(
    "INSERT INTO ig_account_reach (account_name, month, reach) VALUES ('Reach Konto B', '2026-04', 5000)"
  ).run();
  // No ig_account_reach row for 2026-06 — that month is "unknown".

  const gaps = listOpenGaps('instagram');
  const row = gaps.find(g => g.account_name === 'Reach Konto B');
  assert.ok(row);
  assert.equal(row.gap_reach, 5000);
  assert.equal(row.gap_reach_known, 1);
  assert.equal(row.months.length, 2);
  assert.ok(row.gap_reach_known < row.months.length);
});

test('gap_reach: konto utan räckviddsdata alls ger gap_reach = 0 och gap_reach_known = 0', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reach Konto C', 'facebook', '2026-07')"
  ).run();

  const gaps = listOpenGaps('facebook');
  const row = gaps.find(g => g.account_name === 'Reach Konto C');
  assert.ok(row);
  assert.equal(row.gap_reach, 0);
  assert.equal(row.gap_reach_known, 0);
});

// --- Manual dismiss / reopen: "kontot publicerade helt enkelt inget" ------

function gapRow(accountName, platform, month) {
  return db.prepare(
    'SELECT resolved_at, resolution FROM account_gaps WHERE account_name = ? AND platform = ? AND month = ?'
  ).get(accountName, platform, month);
}

test('dismissGapMonth stänger en olöst lucka med resolution=no_posts', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Dismiss Konto A', 'facebook', '2025-09')"
  ).run();

  const changes = dismissGapMonth('Dismiss Konto A', 'facebook', '2025-09');
  assert.equal(changes, 1);

  const row = gapRow('Dismiss Konto A', 'facebook', '2025-09');
  assert.ok(row.resolved_at, 'resolved_at ska sättas');
  assert.equal(row.resolution, 'no_posts');

  // Ska försvinna ur Öppna luckor.
  const gaps = listOpenGaps('facebook');
  assert.ok(!gaps.find(g => g.account_name === 'Dismiss Konto A'));
});

test('dismissGapMonth på en redan löst rad ändrar ingenting', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Dismiss Konto B', 'facebook', '2025-10')"
  ).run();
  dismissGapMonth('Dismiss Konto B', 'facebook', '2025-10');
  const before = gapRow('Dismiss Konto B', 'facebook', '2025-10');

  const changes = dismissGapMonth('Dismiss Konto B', 'facebook', '2025-10');
  assert.equal(changes, 0);

  const after = gapRow('Dismiss Konto B', 'facebook', '2025-10');
  assert.deepEqual(after, before);
});

test('reopenGapMonth öppnar en no_posts-rad men INTE en imported-rad', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Reopen Konto', 'facebook', '2025-11')"
  ).run();
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Imported Konto', 'facebook', '2025-11')"
  ).run();
  dismissGapMonth('Reopen Konto', 'facebook', '2025-11');
  db.prepare(
    "UPDATE account_gaps SET resolved_at = datetime('now'), resolution = 'imported' WHERE account_name = 'Imported Konto' AND platform = 'facebook' AND month = '2025-11'"
  ).run();

  const reopened = reopenGapMonth('Reopen Konto', 'facebook', '2025-11');
  assert.equal(reopened, 1);
  const reopenedRow = gapRow('Reopen Konto', 'facebook', '2025-11');
  assert.equal(reopenedRow.resolved_at, null);
  assert.equal(reopenedRow.resolution, null);

  const untouched = reopenGapMonth('Imported Konto', 'facebook', '2025-11');
  assert.equal(untouched, 0);
  const importedRow = gapRow('Imported Konto', 'facebook', '2025-11');
  assert.ok(importedRow.resolved_at, 'imported-raden ska förbli löst');
  assert.equal(importedRow.resolution, 'imported');
});

test('auto-resolve sätter resolution=imported när en senare import fyller luckan', () => {
  const importId = makeImport('facebook', '2026-05', 70);
  makePost(importId, 'facebook', 'Auto Resolve Konto', '2026-05');
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Auto Resolve Konto', 'facebook', '2026-05')"
  ).run();

  const resolved = autoResolveGaps(db, 'facebook', importId);
  assert.ok(resolved >= 1);

  const row = gapRow('Auto Resolve Konto', 'facebook', '2026-05');
  assert.ok(row.resolved_at);
  assert.equal(row.resolution, 'imported');
});

test('dismissad lucka återregistreras inte av registerGaps (INSERT OR IGNORE)', () => {
  db.prepare(
    "INSERT INTO account_gaps (account_name, platform, month) VALUES ('Ateruppstar Inte Konto', 'facebook', '2026-06')"
  ).run();
  dismissGapMonth('Ateruppstar Inte Konto', 'facebook', '2026-06');

  const before = gapRow('Ateruppstar Inte Konto', 'facebook', '2026-06');
  assert.equal(before.resolution, 'no_posts');

  registerGaps(db, 'facebook', '2026-06', null, [{ account_name: 'Ateruppstar Inte Konto' }]);

  const after = gapRow('Ateruppstar Inte Konto', 'facebook', '2026-06');
  assert.deepEqual(after, before, 'INSERT OR IGNORE ska inte röra den befintliga (dismissade) raden');

  const gaps = listOpenGaps('facebook');
  assert.ok(!gaps.find(g => g.account_name === 'Ateruppstar Inte Konto'), 'ska förbli borta ur Öppna luckor');
});

// --- Rename detection (account_id identity, migration 013) ------------------

const IG_GROUP = ['IG Alpha', 'IG Bravo', 'IG Charlie', 'IG Delta'];

test('namnbyte hos Meta: samma account_id under nytt namn slås ihop i stället för att larma', () => {
  const ID = 'ig-rename-777';
  // 6 historical IG imports where the account posts under its OLD name.
  for (let i = 1; i <= 6; i++) {
    const importId = makeImport('instagram', `2025-0${i}`);
    for (const name of IG_GROUP) makePost(importId, 'instagram', name, `2025-0${i}`);
    makePost(importId, 'instagram', 'Gamla Namnet', `2025-0${i}`, ID);
    processImportRoster(db, 'instagram', `2025-0${i}`, importId, [
      ...IG_GROUP.map(n => ({ name: n })),
      { name: 'Gamla Namnet', id: ID },
    ]);
  }
  // An open gap under the old name (as if the account had been missed earlier).
  registerGaps(db, 'instagram', '2025-06', null, [{ account_name: 'Gamla Namnet' }]);

  // 7th import: the same id returns under a NEW name.
  const importId = makeImport('instagram', '2025-07');
  for (const name of IG_GROUP) makePost(importId, 'instagram', name, '2025-07');
  makePost(importId, 'instagram', 'Nya Namnet', '2025-07', ID);
  const result = processImportRoster(db, 'instagram', '2025-07', importId, [
    ...IG_GROUP.map(n => ({ name: n })),
    { name: 'Nya Namnet', id: ID, username: 'nyanamnet' },
  ]);

  // The rename is reported, and the old name does NOT alarm as missing.
  assert.deepEqual(result.renamedAccounts, [
    { account_id: ID, oldName: 'Gamla Namnet', newName: 'Nya Namnet' },
  ]);
  assert.equal(result.missingAccounts.length, 0);

  // Posts merged onto the new name.
  const postNames = db.prepare(
    'SELECT DISTINCT account_name FROM posts WHERE account_id = ?'
  ).all(ID).map(r => r.account_name);
  assert.deepEqual(postNames, ['Nya Namnet']);

  // Roster: exactly one row for the account, new name, id filled.
  const rosterRows = db.prepare(
    "SELECT account_name, account_id FROM account_roster WHERE account_name IN ('Gamla Namnet', 'Nya Namnet')"
  ).all();
  assert.deepEqual(rosterRows, [{ account_name: 'Nya Namnet', account_id: ID }]);

  // import_accounts history rewritten — the old name is gone.
  const oldIa = db.prepare(
    "SELECT COUNT(*) AS n FROM import_accounts WHERE account_name = 'Gamla Namnet'"
  ).get().n;
  assert.equal(oldIa, 0);

  // The open gap followed the rename and is still open under the new name.
  const gap = db.prepare(
    "SELECT account_name, month, resolved_at FROM account_gaps WHERE account_name = 'Nya Namnet' AND month = '2025-06'"
  ).get();
  assert.ok(gap, 'luckan ska ligga under nya namnet');
  assert.equal(gap.resolved_at, null);
});

test('namnbyte: retirerad status följer med till nya namnet', () => {
  const ID = 'ig-rename-retired';
  const importId1 = makeImport('instagram', '2025-08');
  for (const name of IG_GROUP) makePost(importId1, 'instagram', name, '2025-08');
  makePost(importId1, 'instagram', 'Pensionerat Gammalt', '2025-08', ID);
  processImportRoster(db, 'instagram', '2025-08', importId1, [
    ...IG_GROUP.map(n => ({ name: n })),
    { name: 'Pensionerat Gammalt', id: ID },
  ]);
  retireAccount('Pensionerat Gammalt', 'instagram');

  const importId2 = makeImport('instagram', '2025-09');
  for (const name of IG_GROUP) makePost(importId2, 'instagram', name, '2025-09');
  makePost(importId2, 'instagram', 'Pensionerat Nytt', '2025-09', ID);
  processImportRoster(db, 'instagram', '2025-09', importId2, [
    ...IG_GROUP.map(n => ({ name: n })),
    { name: 'Pensionerat Nytt', id: ID },
  ]);

  const row = db.prepare(
    "SELECT status FROM account_roster WHERE account_name = 'Pensionerat Nytt' AND platform = 'instagram'"
  ).get();
  assert.equal(row.status, 'retired');
});

test('guard: två konton som förekommit i samma import slås ALDRIG ihop trots delat id', () => {
  const SHARED = 'ig-shared-id';
  // 'Real A' and 'Real B' post together (data-error: same id on both).
  for (let i = 1; i <= 2; i++) {
    const importId = makeImport('instagram', `2025-1${i}`);
    makePost(importId, 'instagram', 'Real A', `2025-1${i}`, SHARED);
    makePost(importId, 'instagram', 'Real B', `2025-1${i}`, SHARED);
    for (const name of IG_GROUP) makePost(importId, 'instagram', name, `2025-1${i}`);
    processImportRoster(db, 'instagram', `2025-1${i}`, importId, [
      ...IG_GROUP.map(n => ({ name: n })),
      { name: 'Real A', id: SHARED },
      { name: 'Real B', id: SHARED },
    ]);
  }
  // Next import has only 'Real B' — co-occurrence guard must block a merge.
  const importId = makeImport('instagram', '2026-01');
  for (const name of IG_GROUP) makePost(importId, 'instagram', name, '2026-01');
  makePost(importId, 'instagram', 'Real B', '2026-01', SHARED);
  const result = processImportRoster(db, 'instagram', '2026-01', importId, [
    ...IG_GROUP.map(n => ({ name: n })),
    { name: 'Real B', id: SHARED },
  ]);

  assert.equal(result.renamedAccounts.length, 0);
  const aPosts = db.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE account_name = 'Real A'"
  ).get().n;
  assert.equal(aPosts, 2, 'Real A:s poster ska vara orörda');
});

test('bakåtkompatibilitet: processImportRoster med ren namn-array fungerar utan rename-detektering', () => {
  const importId = makeImport('facebook', '2026-02');
  for (const name of RIKS) makePost(importId, 'facebook', name, '2026-02');
  const result = processImportRoster(db, 'facebook', '2026-02', importId, RIKS);
  assert.deepEqual(result.renamedAccounts, []);
});

test('riktningsspärr: backfill av gammal fil med gammalt namn flippar INTE kanoniskt namn', () => {
  const ID = 'ig-rename-777'; // same account as the rename test: canonical = 'Nya Namnet'
  // A stale 2025-03 file resurfaces with the OLD name; the upsert path would
  // have written posts under it — simulate that too.
  const importId = makeImport('instagram', '2025-03');
  for (const name of IG_GROUP) makePost(importId, 'instagram', name, '2025-03');
  makePost(importId, 'instagram', 'Gamla Namnet', '2025-03', ID);
  const result = processImportRoster(db, 'instagram', '2025-03', importId, [
    ...IG_GROUP.map(n => ({ name: n })),
    { name: 'Gamla Namnet', id: ID, username: 'gamlanamnet' },
  ]);

  // Reported as a merge onto the CURRENT canonical name, not a rename back.
  assert.deepEqual(result.renamedAccounts, [
    { account_id: ID, oldName: 'Gamla Namnet', newName: 'Nya Namnet' },
  ]);
  // All posts (including the freshly re-labeled one) sit under the canonical name.
  const postNames = db.prepare(
    'SELECT DISTINCT account_name FROM posts WHERE account_id = ?'
  ).all(ID).map(r => r.account_name);
  assert.deepEqual(postNames, ['Nya Namnet']);
  // Roster untouched by the stale name.
  const stale = db.prepare(
    "SELECT COUNT(*) AS n FROM account_roster WHERE account_name = 'Gamla Namnet'"
  ).get().n;
  assert.equal(stale, 0);
  // This import's own account list records the canonical name.
  const ia = db.prepare(
    'SELECT account_name FROM import_accounts WHERE import_id = ? AND account_id = ?'
  ).get(importId, ID);
  assert.equal(ia.account_name, 'Nya Namnet');
});
