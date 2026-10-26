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
