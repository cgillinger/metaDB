// NULL reach/views = "unknown" (Meta no longer delivers them for some 2023 posts).
// Verifies that the server read paths treat NULL as unknown, never as 0.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-nullreach-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { default: accountsRouter } = await import('./accounts.js');
const { default: postsRouter } = await import('./posts.js');
const { default: trendsRouter } = await import('./trends.js');
const { buildFlatWorkbook } = await import('../services/export/flatExport.js');

const db = getDb();
let server, base;

before(async () => {
  const imp = db.prepare("INSERT INTO imports (filename, platform, month) VALUES ('x.csv','facebook','2023-10')").run().lastInsertRowid;
  const ins = db.prepare(`INSERT INTO posts (import_id, post_id, account_name, platform, publish_time, views, reach, interactions)
    VALUES (?, ?, ?, 'facebook', ?, ?, ?, 1)`);
  // Mix: AVG(reach) must be over the two known posts only = (100+300)/2 = 200.
  ins.run(imp, 'a1', 'Mix', '2023-10-02 10:00:00', 1000, 100);
  ins.run(imp, 'a2', 'Mix', '2023-10-03 10:00:00', 2000, 300);
  ins.run(imp, 'a3', 'Mix', '2023-10-04 10:00:00', null, null);
  // Every post unknown: reach/views must stay NULL, not 0.
  ins.run(imp, 'b1', 'Allnull', '2023-10-02 10:00:00', null, null);
  ins.run(imp, 'b2', 'Allnull', '2023-10-03 10:00:00', null, null);
  ins.run(imp, 'b3', 'Allnull', '2023-11-03 10:00:00', 50, 10);
  const app = express();
  app.use('/api/accounts', accountsRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/trends', trendsRouter);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server?.close();
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const get = async (u) => (await fetch(base + u)).json();

test('accounts: AVG(reach) ignores NULL posts, SUM(views) ignores NULL', async () => {
  const { accounts } = await get('/accounts?fields=views,reach&months=2023-10');
  const mix = accounts.find(a => a.account_name === 'Mix');
  assert.equal(mix.reach, 200);
  assert.equal(mix.views, 3000);
  assert.equal(mix.post_count, 3);
  const allnull = accounts.find(a => a.account_name === 'Allnull');
  assert.equal(allnull.reach, null);
  assert.equal(allnull.views, null);
});

test('accounts: totals AVG over known posts only', async () => {
  const { totals } = await get('/accounts?fields=views,reach&months=2023-10');
  assert.equal(totals.reach, 200);
  assert.equal(totals.views, 3000);
});

test('posts list returns NULL (not 0) and sorts NULL last in both directions', async () => {
  for (const order of ['asc', 'desc']) {
    const { data } = await get(`/posts?platform=facebook&account=Mix&sort=reach&order=${order}&paginate=false`);
    assert.equal(data.length, 3);
    assert.equal(data[2].reach, null);
    assert.equal(data[2].views, null);
    assert.ok(data[0].reach !== null && data[1].reach !== null);
  }
});

test('trends: month where every post is unknown stays null, other months are numbers', async () => {
  const { months, series } = await get('/trends?metric=views&granularity=month');
  const s = series.find(x => x.account_name === 'Allnull');
  assert.equal(s.data[months.indexOf('2023-10')], null);
  assert.equal(s.data[months.indexOf('2023-11')], 50);
  const r = await get('/trends?metric=average_reach&granularity=month');
  const mix = r.series.find(x => x.account_name === 'Mix');
  assert.equal(mix.data[r.months.indexOf('2023-10')], 200);
});

test('flat export: all-unknown month gives empty (null) views/reach, mixed month stays summed/averaged', () => {
  const wb = buildFlatWorkbook();
  const ws = wb.Sheets.posts_monthly;
  const header = [];
  const rows = [];
  const range = (ws['!ref'] || '').match(/[A-Z]+(\d+):[A-Z]+(\d+)/);
  const last = Number(range[2]);
  const cols = Object.keys(ws).filter(k => /^[A-Z]+1$/.test(k));
  for (const c of cols) header.push([c.replace('1', ''), ws[c].v]);
  for (let r = 2; r <= last; r++) {
    const row = {};
    for (const [col, name] of header) row[name] = ws[`${col}${r}`]?.v ?? null;
    rows.push(row);
  }
  const mix = rows.find(r => r.account_name === 'Mix');
  assert.equal(mix.views, 3000);
  assert.equal(mix.reach, 200);
  const allnull = rows.find(r => r.account_name === 'Allnull' && r.month === '2023-10');
  assert.equal(allnull.views, null);
  assert.equal(allnull.reach, null);
});
