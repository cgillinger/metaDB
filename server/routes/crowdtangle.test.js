import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-ct-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { default: router } = await import('./crowdtangle.js');
const { loadRows } = await import('../services/crowdtangle/loader.js');

const db = getDb();
let server, base;

const ct = (platform, key, name, month, interactions, posts = 10) => ({
  platform, account_key: key, account_name: name, month, interactions, posts,
  likes: null, comments: null, shares: null, video_views: null, followers: null,
});

before(async () => {
  db.prepare("INSERT INTO imports (filename, platform, month, row_count) VALUES ('x.csv', 'facebook', '2024-01', 1)").run();
  const imp = db.prepare('SELECT id FROM imports').get().id;
  const ins = db.prepare(`INSERT INTO posts (import_id, post_id, account_id, account_name, account_username, publish_time, platform, likes, comments, interactions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run(imp, 'f1', '111', 'Radiosporten', null, '2024-01-05 10:00:00', 'facebook', 5, 2, 50);
  ins.run(imp, 'f2', '111', 'Radiosporten', null, '2024-01-20 10:00:00', 'facebook', 5, 2, 70);
  ins.run(imp, 'f3', '111', 'Radiosporten', null, '2024-02-03 10:00:00', 'facebook', 5, 2, 30);
  // Same page after Meta's mid-2024 page-id switch: new id, same account name
  ins.run(imp, 'f4', '999', 'Radiosporten', null, '2024-08-03 10:00:00', 'facebook', 5, 2, 40);
  ins.run(imp, 'i1', '900', 'P3 Nyheter', 'P3Nyheter', '2023-08-05 10:00:00', 'instagram', 10, 4, 99);
  loadRows(db, [
    ct('facebook', '111', 'Radiosporten (gammalt)', '2023-11', 400),
    ct('facebook', '111', 'Radiosporten (gammalt)', '2023-12', 410),
    ct('facebook', '111', 'Radiosporten (gammalt)', '2024-01', 100),
    ct('facebook', '222', 'Bara CT', '2023-12', 7),
    ct('facebook', '333', 'Dold konto', '2023-12', 9),
    ct('instagram', 'p3nyheter', 'P3Nyheter', '2023-07', 500),
    ct('instagram', 'p3nyheter', 'P3Nyheter', '2023-08', 600),
    ct('twitter', 'sr_ekot', 'SR Ekot', '2019-08', 5875, 670),
  ]);
  db.prepare("INSERT INTO hidden_accounts (account_name, platform) VALUES ('Dold konto', 'facebook')").run();
  const app = express();
  app.use('/api/crowdtangle', router);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api/crowdtangle`;
});

after(() => {
  server?.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get = async (u) => { const r = await fetch(base + u); return { status: r.status, body: await r.json() }; };

test('accounts: metaDB name wins, link flag, hidden filtered', async () => {
  const { body } = await get('/accounts?platform=facebook');
  const byKey = Object.fromEntries(body.accounts.map(a => [a.account_key, a]));
  assert.equal(byKey['111'].account_name, 'Radiosporten');
  assert.equal(byKey['111'].has_metadb, true);
  assert.equal(byKey['111'].first_month, '2023-11');
  assert.equal(byKey['222'].has_metadb, false);
  assert.equal(byKey['333'], undefined);
});

test('series FB interactions: CT then metaDB, breakpoint and ghost', async () => {
  const { body } = await get('/series?platform=facebook&metric=interactions&accounts=111&from=2023-11&to=2024-02');
  assert.deepEqual(body.months, ['2023-11', '2023-12', '2024-01', '2024-02']);
  const s = body.series[0];
  assert.deepEqual(s.data.map(d => d.value), [400, 410, 120, 30]);
  assert.deepEqual(s.data.map(d => d.source), ['crowdtangle', 'crowdtangle', 'metadb', 'metadb']);
  assert.equal(s.data[2].ghost, 100);
  assert.equal(s.breakpoint_month, '2024-01');
  assert.equal(s.splice_status, 'spliced');
  assert.deepEqual(s.overlap_months, ['2024-01']);
});

test('series posts counts rows; missing month is null, not 0', async () => {
  const { body } = await get('/series?platform=facebook&metric=posts&accounts=111&from=2023-10&to=2024-01');
  const s = body.series[0];
  assert.equal(s.data[0].value, null);
  assert.equal(s.data[0].source, null);
  assert.equal(s.data[3].value, 2);
});

test('series IG interactions = likes + comments on metaDB side', async () => {
  const { body } = await get('/series?platform=instagram&metric=interactions&accounts=p3nyheter');
  const s = body.series[0];
  assert.equal(s.account_name, 'P3 Nyheter');
  assert.deepEqual(s.data.map(d => d.value), [500, 14]);
  assert.equal(s.data[1].ghost, 600);
});

test('twitter has CT side only', async () => {
  const { body } = await get('/series?platform=twitter&metric=posts&accounts=sr_ekot');
  assert.equal(body.series[0].splice_status, 'crowdtangle_only');
  assert.equal(body.series[0].data[0].value, 670);
});

test('hidden account series is dropped; bad input is 400', async () => {
  assert.equal((await get('/series?platform=facebook&metric=interactions&accounts=333')).body.series.length, 0);
  assert.equal((await get('/series?platform=tiktok&metric=posts&accounts=1')).status, 400);
  assert.equal((await get('/series?platform=facebook&metric=views;DROP&accounts=1')).status, 400);
  assert.equal((await get('/series?platform=facebook&metric=posts&accounts=1&from=2023-13')).status, 400);
  assert.equal((await get('/series?platform=facebook&metric=posts')).status, 400);
});

test('loader: upsert is idempotent and dry-run saves nothing', () => {
  const row = ct('facebook', '555', 'Ny', '2020-03', 1);
  assert.deepEqual(loadRows(db, [row], { dryRun: true }), { inserted: 1, updated: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ct_monthly WHERE account_key='555'").get().n, 0);
  assert.deepEqual(loadRows(db, [row]), { inserted: 1, updated: 0 });
  assert.deepEqual(loadRows(db, [{ ...row, interactions: 2 }]), { inserted: 0, updated: 1 });
  assert.equal(db.prepare("SELECT interactions n FROM ct_monthly WHERE account_key='555'").get().n, 2);
});

test('series: metaDB side follows the account across a page-id switch', async () => {
  const { body } = await get('/series?platform=facebook&metric=interactions&accounts=111');
  const s = body.series[0];
  const at = (m) => s.data[body.months.indexOf(m)];
  assert.equal(body.months.at(-1), '2024-08');
  assert.deepEqual(at('2024-08'), { value: 40, source: 'metadb', ghost: null });
});

// ---- yearly view ----------------------------------------------------------

const cty = (platform, key, name, year, interactions, posts = 100) => ({
  platform, account_key: key, account_name: name, year, interactions, posts,
  likes: null, comments: null, shares: null, video_views: null, followers: null,
});

test('yearly setup: rows route to ct_yearly and ct_monthly by period', () => {
  const months12 = (key, from) => Array.from({ length: 12 }, (_, i) =>
    ct('facebook', key, `Konto ${key}`, `${from}-${String(i + 1).padStart(2, '0')}`, 10));
  const res = loadRows(db, [
    cty('facebook', '111', 'Radiosporten (gammalt)', '2022', 4000),
    cty('facebook', '111', 'Radiosporten (gammalt)', '2023', 5000),
    cty('facebook', '777', 'Dog 2016', '2016', 123),
    ...months12('444', '2022'),
    cty('facebook', '444', 'Konto 444', '2022', 999),
    ...months12('445', '2022').slice(0, 11),
    cty('facebook', '445', 'Konto 445', '2022', 777),
    ...months12('446', '2022').slice(0, 11),
    cty('twitter', 'sr_ekot', 'SR Ekot', '2016', 4321),
  ]);
  assert.equal(res.updated, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ct_yearly').get().n, 6);
});

test('yearly: metaDB beats CT; 12 CT months beat the year file; 11 months fall back; nothing → null', async () => {
  const { status, body } = await get('/yearly?platform=facebook&metric=interactions&accounts=111,444,445,446&from=2022&to=2024');
  assert.equal(status, 200);
  assert.deepEqual(body.years, [2022, 2023, 2024]);
  const by = Object.fromEntries(body.series.map(s => [s.account_key, s]));
  // 111: yearly file 2022/2023, metaDB 2024 (includes the post under the new page id)
  assert.deepEqual(by['111'].data.map(d => [d.value, d.source]),
    [[4000, 'crowdtangle_year'], [5000, 'crowdtangle_year'], [190, 'metadb']]);
  assert.equal(by['111'].breakpoint_year, 2024);
  assert.equal(by['111'].data[2].partial, false);
  assert.deepEqual([by['444'].data[0].value, by['444'].data[0].source], [120, 'crowdtangle_months']);
  assert.deepEqual([by['445'].data[0].value, by['445'].data[0].source], [777, 'crowdtangle_year']);
  assert.deepEqual(by['446'].data[0], { value: null, source: null, partial: false });
  assert.equal(by['444'].breakpoint_year, null);
});

test('yearly: current year from metaDB is partial; years before metaDB platform start are CT only', async () => {
  const { buildYearlySeries } = await import('../services/crowdtangle/series.js');
  const r = buildYearlySeries(db, { platform: 'facebook', metric: 'interactions', accounts: ['111'], fromYear: 2023, toYear: 2024, currentYear: 2024 });
  assert.equal(r.series[0].data[1].partial, true);
  assert.equal(r.series[0].data[0].partial, false);
  // IG metaDB starts 2023-08: 2023 is not a full metaDB year, so it is not taken from metaDB
  const ig = buildYearlySeries(db, { platform: 'instagram', metric: 'interactions', accounts: ['p3nyheter'], fromYear: 2023, toYear: 2023 });
  assert.equal(ig.series[0].data[0].source, null);
});

test('yearly: twitter is CT only; yearly-only accounts are listed; bad input is 400', async () => {
  const tw = (await get('/yearly?platform=twitter&metric=interactions&accounts=sr_ekot&from=2015&to=2017')).body;
  assert.deepEqual(tw.series[0].data.map(d => [d.value, d.source]), [[null, null], [4321, 'crowdtangle_year'], [null, null]]);
  const acc = (await get('/accounts?platform=facebook')).body.accounts.find(a => a.account_key === '777');
  assert.equal(acc.account_name, 'Dog 2016');
  assert.equal(acc.first_year, 2016);
  assert.equal(acc.ct_months, 0);
  assert.equal(acc.first_month, null);
  assert.equal(acc.has_metadb, false);
  assert.equal((await get('/yearly?platform=facebook&metric=posts&accounts=1&from=24')).status, 400);
  assert.equal((await get('/yearly?platform=facebook&metric=posts')).status, 400);
  assert.equal((await get('/yearly?platform=x&metric=posts&accounts=1')).status, 400);
});

test('loader: clear Swedish error naming migration 016 when ct_yearly is missing', async () => {
  const { default: Database } = await import('better-sqlite3');
  const bare = new Database(':memory:');
  bare.exec('CREATE TABLE ct_monthly (x)');
  assert.throws(() => loadRows(bare, [cty('facebook', '1', 'A', '2020', 1)]), /ct_yearly saknas.*migration 016/);
  bare.close();
});
