import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractSlug, resolveAccountFromPermalink, buildSlugToAccount, SLUG_DENYLIST,
} from './permalinkResolver.js';

test('extractSlug pulls the page handle, lowercased', () => {
  assert.equal(extractSlug('https://www.facebook.com/P4extra/posts/pfbid0abc'), 'p4extra');
  assert.equal(extractSlug('https://www.facebook.com/sverigesradioblekinge/posts/x'), 'sverigesradioblekinge');
  assert.equal(extractSlug('https://www.instagram.com/p4kalmar/'), 'p4kalmar');
});

test('extractSlug returns null for denylisted / generic segments', () => {
  for (const url of [
    'https://www.facebook.com/photo.php?fbid=123',
    'https://www.facebook.com/permalink.php?story_fbid=1',
    'https://www.facebook.com/reel/699716579231102/',
    'https://www.instagram.com/reel/DE67PcNOqpE/',
    'https://www.instagram.com/p/DFfNefyoJ2r/',
    'https://www.facebook.com/story.php?story_fbid=9',
  ]) {
    assert.equal(extractSlug(url), null, `should not extract a slug from ${url}`);
  }
  assert.equal(extractSlug(''), null);
  assert.equal(extractSlug(null), null);
  assert.equal(extractSlug('https://example.com/p4extra/'), null); // unknown host
});

test('SLUG_DENYLIST covers the directive-mandated generic segments', () => {
  for (const seg of ['photo.php', 'permalink.php', 'story.php', 'watch', 'media',
    'share', 'groups', 'events', 'profile.php', 'reel', 'p']) {
    assert.ok(SLUG_DENYLIST.has(seg), `denylist missing ${seg}`);
  }
});

test('resolveAccountFromPermalink: name from DB map, denylist → null, override wins', () => {
  const map = new Map([['facebook::p4kalmar', { account_name: 'P4 Kalmar Sveriges Radio', account_id: '111' }]]);
  // positive
  assert.deepEqual(
    resolveAccountFromPermalink({ platform: 'facebook', permalink: 'https://www.facebook.com/p4kalmar/posts/x' }, map),
    { account_name: 'P4 Kalmar Sveriges Radio', account_id: '111' });
  // denylisted → never attribute (leave empty)
  assert.equal(
    resolveAccountFromPermalink({ platform: 'facebook', permalink: 'https://www.facebook.com/reel/9' }, map), null);
  // unknown slug → null
  assert.equal(
    resolveAccountFromPermalink({ platform: 'facebook', permalink: 'https://www.facebook.com/unknownpage/posts/x' }, map), null);
  // denylisted FIRST segment → null even when an override map is present
  const ov = { 'facebook::p4kalmar': { account_name: 'Override Name', account_id: '999' } };
  assert.equal(
    resolveAccountFromPermalink({ platform: 'facebook', permalink: 'https://www.facebook.com/reel/123' }, map, ov), null);
  // override takes precedence over the DB map for a real handle
  assert.equal(
    resolveAccountFromPermalink({ platform: 'facebook', permalink: 'https://www.facebook.com/p4kalmar/posts/x' }, map, ov).account_name,
    'Override Name');
});

// --- db-backed: buildSlugToAccount picks the most common name/id per slug ---
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-resolver-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
const { getDb, closeDb } = await import('../db/connection.js');
const db = getDb();
const importId = db.prepare("INSERT INTO imports (filename, platform, month) VALUES ('t.csv','facebook','2026-02')").run().lastInsertRowid;
let seq = 0;
const ins = db.prepare(`INSERT INTO posts (import_id, post_id, account_name, account_id, platform, permalink) VALUES (?,?,?,?,?,?)`);
// 3 posts for the canonical name, 1 for an old name → most common wins.
for (let i = 0; i < 3; i++) ins.run(importId, `a${seq++}`, 'P4 Kalmar Sveriges Radio', 'PID', 'facebook', 'https://www.facebook.com/p4kalmar/posts/x');
ins.run(importId, `a${seq++}`, 'P4 Kalmar', 'PID', 'facebook', 'https://www.facebook.com/p4kalmar/posts/y');
// a denylisted-URL named post must NOT create a slug entry
ins.run(importId, `a${seq++}`, 'Whatever', 'Q', 'facebook', 'https://www.facebook.com/photo.php?fbid=1');
after(() => { closeDb(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('buildSlugToAccount maps slug → most common account (no denylisted keys)', () => {
  const map = buildSlugToAccount(db);
  assert.deepEqual(map.get('facebook::p4kalmar'), { account_name: 'P4 Kalmar Sveriges Radio', account_id: 'PID' });
  assert.equal(map.has('facebook::photo.php'), false);
});
