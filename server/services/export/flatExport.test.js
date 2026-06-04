import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway seeded DB — structural assertions that run anywhere (no snapshot needed).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-export-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../../db/connection.js');
const XLSX = await import('xlsx');
const { buildFlatWorkbook } = await import('./flatExport.js');

const db = getDb();
const importId = db.prepare(
  "INSERT INTO imports (filename, platform, month) VALUES ('t.csv','facebook','2026-02')"
).run().lastInsertRowid;

let seq = 0;
const insPost = db.prepare(
  `INSERT INTO posts (import_id, post_id, account_name, platform, publish_time, views, reach, link_clicks, interactions)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
function posts(account, platform, month, n, per = {}) {
  for (let i = 0; i < n; i++) {
    insPost.run(importId, `p${seq++}`, account, platform, `${month}-10 12:00:00`,
      per.views ?? 100, per.reach ?? 60, per.link_clicks ?? 200, per.interactions ?? 10);
  }
}

// Visible FB accounts across two months (≥5 posts → estimate 'ok' where reach exists).
posts('Acme', 'facebook', '2026-01', 6);
posts('Acme', 'facebook', '2026-02', 6);
posts('P4 Göteborg', 'facebook', '2026-02', 6);
// Few posts → estimate suppressed branch.
posts('Tiny', 'facebook', '2026-02', 3);
// Hidden account — must be excluded everywhere.
posts('Hidden Co', 'facebook', '2026-02', 6);

db.prepare("INSERT INTO account_reach (account_name, month, reach) VALUES ('Acme','2026-01',100)").run();
db.prepare("INSERT INTO account_reach (account_name, month, reach) VALUES ('Acme','2026-02',100)").run();
db.prepare("INSERT INTO account_reach (account_name, month, reach) VALUES ('P4 Göteborg','2026-02',100)").run();
db.prepare("INSERT INTO account_reach (account_name, month, reach) VALUES ('Tiny','2026-02',100)").run();
db.prepare("INSERT INTO ig_account_reach (account_name, month, reach) VALUES ('InstaCo','2026-02',500)").run();
db.prepare("INSERT INTO ga_listens (account_name, month, listens) VALUES ('Prog','2026-02',2800)").run();
db.prepare("INSERT INTO ga_site_visits (account_name, month, visits) VALUES ('Site','2026-02',5600)").run();

// Hide 'Hidden Co' (facebook).
db.prepare("INSERT INTO hidden_accounts (account_name, platform) VALUES ('Hidden Co','facebook')").run();

// One posts group, one ga_listens group.
const gid = db.prepare("INSERT INTO account_groups (name, source) VALUES ('Group A','posts')").run().lastInsertRowid;
db.prepare("INSERT INTO account_group_members (group_id, account_key) VALUES (?, 'Acme::facebook')").run(gid);
db.prepare("INSERT INTO account_group_members (group_id, account_key) VALUES (?, 'P4 Göteborg::facebook')").run(gid);
const lgid = db.prepare("INSERT INTO account_groups (name, source) VALUES ('LGroup','ga_listens')").run().lastInsertRowid;
db.prepare("INSERT INTO account_group_members (group_id, account_key) VALUES (?, 'Prog::ga_listens')").run(lgid);

const wb = buildFlatWorkbook();
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { raw: true });

after(() => { closeDb(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

const DATA_TABS = [
  'posts_monthly', 'estimated_unique_clicks_monthly', 'ga_listens_monthly',
  'ga_site_visits_monthly', 'account_reach_monthly', 'posts_groups_monthly',
  'ga_listens_groups_monthly', 'ga_site_visits_groups_monthly',
  'dim_accounts', 'dim_groups', 'dim_group_members',
];

test('(a) all 11 tabs + _LÄS_MIG present, README first', () => {
  assert.equal(wb.SheetNames[0], '_LÄS_MIG');
  for (const t of DATA_TABS) assert.ok(wb.SheetNames.includes(t), `missing tab ${t}`);
  assert.equal(wb.SheetNames.length, 12);
});

test('(b) metric cells are numbers, not strings', () => {
  const p = sheet('posts_monthly')[0];
  for (const f of ['post_count', 'views', 'reach', 'link_clicks', 'avg_daily_link_clicks', 'posts_per_day']) {
    assert.equal(typeof p[f], 'number', `${f} should be number`);
  }
  const g = sheet('posts_groups_monthly')[0];
  assert.equal(typeof g.avg_daily_link_clicks, 'number');
  assert.equal(typeof g.member_count, 'number');
});

test('(c) month_date is a real Date', () => {
  for (const t of ['posts_monthly', 'ga_listens_monthly', 'posts_groups_monthly']) {
    assert.ok(sheet(t)[0].month_date instanceof Date, `${t}.month_date not a Date`);
  }
});

test('(d) account tabs hold no group rows and vice versa', () => {
  for (const r of sheet('posts_monthly')) {
    assert.equal(r.group_id, undefined);
    assert.notEqual(r.account_name, 'Group A');
  }
  for (const r of sheet('posts_groups_monthly')) {
    assert.ok(r.group_id !== undefined && r.group_name);
    assert.equal(r.account_name, undefined);
  }
});

test('(e) hidden accounts excluded from data tabs and dim_accounts', () => {
  const names = new Set([
    ...sheet('posts_monthly').map(r => r.account_name),
    ...sheet('dim_accounts').map(r => r.account_name),
    ...sheet('account_reach_monthly').map(r => r.account_name),
  ]);
  assert.ok(!names.has('Hidden Co'), 'hidden account leaked');
});

test('booleans are real booleans; is_p4 whitelist works', () => {
  const da = sheet('dim_accounts');
  const gbg = da.find(r => r.account_name === 'P4 Göteborg');
  const acme = da.find(r => r.account_name === 'Acme');
  assert.equal(typeof gbg.is_p4, 'boolean');
  assert.equal(gbg.is_p4, true);
  assert.equal(acme.is_p4, false);
});

test('estimate suppressed → null estimate columns, quality set', () => {
  const tiny = sheet('estimated_unique_clicks_monthly').find(r => r.account_name === 'Tiny');
  assert.equal(tiny.quality, 'suppressed');
  assert.equal(tiny.estimate_upper, undefined); // null → empty cell → absent in json
  assert.equal(tiny.estimate_lower, undefined);
});

test('grain: account tabs per account×month, group tabs per group×month', () => {
  const acme = sheet('posts_monthly').filter(r => r.account_name === 'Acme');
  assert.deepEqual(acme.map(r => r.month).sort(), ['2026-01', '2026-02']);
  const grp = sheet('posts_groups_monthly').filter(r => r.group_name === 'Group A');
  // Acme(2 months) + P4 Göteborg(feb) → group has both months
  assert.deepEqual([...new Set(grp.map(r => r.month))].sort(), ['2026-01', '2026-02']);
  // SBS: feb link_clicks = (Acme 6 + P4 6) * 200 = 2400; /28 days → rounded
  const feb = grp.find(r => r.month === '2026-02');
  assert.equal(feb.link_clicks, 2400);
  assert.equal(feb.member_count, 2);
});
