import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the connection at a throwaway DB BEFORE importing it (DB_PATH is read at
// module eval). Dynamic import after the env is set guarantees ordering.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadb-euc-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');

const { getDb, closeDb } = await import('../db/connection.js');
const { getEstimatedUniqueClicks, getEstimatedUniqueClicksByAccount } =
  await import('./estimatedUniqueClicks.js');

const db = getDb(); // runs schema + migrations on the empty temp DB
const importId = db.prepare(
  "INSERT INTO imports (filename, platform, month) VALUES ('t.csv','facebook','2026-02')"
).run().lastInsertRowid;

let postSeq = 0;
const insPost = db.prepare(
  `INSERT INTO posts (import_id, post_id, account_name, platform, publish_time, reach, link_clicks, is_collab)
   VALUES (?, ?, ?, 'facebook', ?, ?, ?, ?)`
);
const insReach = db.prepare(
  'INSERT INTO account_reach (account_name, month, reach) VALUES (?, ?, ?)'
);

/** Seed N posts for an account in a month with given per-post reach/link_clicks. */
function seedPosts(account, month, n, reachEach, lcEach, isCollab = 0) {
  for (let i = 0; i < n; i++) {
    insPost.run(importId, `p${postSeq++}`, account, `${month}-10 12:00:00`, reachEach, lcEach, isCollab);
  }
}

// --- ok: F = 300/100 = 3, upper = round(1000/3) = 333, lower = round(333/1.5) = 222
seedPosts('AOK', '2026-02', 5, 60, 200);        // Σreach 300, Σlc 1000
insReach.run('AOK', '2026-02', 100);

// --- uncertain: F = 600/100 = 6 (>5), upper = round(1200/6) = 200, lower = 133
seedPosts('UNC', '2026-02', 5, 120, 240);       // Σreach 600, Σlc 1200
insReach.run('UNC', '2026-02', 100);

// --- suppressed: too few posts (<5)
seedPosts('FEW', '2026-02', 3, 100, 100);
insReach.run('FEW', '2026-02', 100);

// --- suppressed: no account_reach at all
seedPosts('NOREACH', '2026-02', 5, 100, 100);

// --- multi-month: feb+mar both have reach → aggregate. F = 600/200 = 3,
//     upper = round(2000/3) = 667, lower = round(667/1.5) = 445
seedPosts('MM', '2026-02', 5, 60, 200);
seedPosts('MM', '2026-03', 5, 60, 200);
insReach.run('MM', '2026-02', 100);
insReach.run('MM', '2026-03', 100);

// --- multi-month with a reach-less month: mar must be EXCLUDED, not corrupt F.
seedPosts('MMX', '2026-02', 5, 60, 200);        // feb: reach 300, lc 1000, ar 100
seedPosts('MMX', '2026-03', 5, 9999, 9999);     // mar: NO account_reach
insReach.run('MMX', '2026-02', 100);

after(() => { closeDb(); fs.rmSync(tmpDir, { recursive: true, force: true }); });

test('single month: ok branch, exact bounds', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02'] });
  assert.deepEqual(byAcct['AOK'], { upper: 333, lower: 222, quality: 'ok' });
});

test('single month reproduces the per-month service exactly', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02'] });
  const monthly = getEstimatedUniqueClicks({ accountNames: ['AOK'], months: ['2026-02'] })[0];
  assert.equal(byAcct['AOK'].upper, monthly.estimated_unique_upper);
  assert.equal(byAcct['AOK'].lower, monthly.estimated_unique_lower);
  assert.equal(byAcct['AOK'].quality, monthly.quality);
});

test('uncertain branch when F > 5', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02'] });
  assert.deepEqual(byAcct['UNC'], { upper: 200, lower: 133, quality: 'uncertain' });
});

test('suppressed: < 5 posts and missing account_reach', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02'] });
  assert.equal(byAcct['FEW'].quality, 'suppressed');
  assert.equal(byAcct['FEW'].upper, null);
  assert.equal(byAcct['NOREACH'].quality, 'suppressed');
  assert.equal(byAcct['NOREACH'].upper, null);
});

test('multi-month aggregates raw components before computing F', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02', '2026-03'] });
  assert.deepEqual(byAcct['MM'], { upper: 667, lower: 445, quality: 'ok' });
});

test('multi-month excludes months without account_reach (no F corruption)', () => {
  const byAcct = getEstimatedUniqueClicksByAccount({ months: ['2026-02', '2026-03'] });
  // Only feb contributes: F = 300/100 = 3 → upper 333, NOT inflated by mar's 9999.
  assert.deepEqual(byAcct['MMX'], { upper: 333, lower: 222, quality: 'ok' });
});

test('excludeCollab drops collaborative posts', () => {
  // Add a collab-heavy account: 5 normal + 5 collab posts.
  seedPosts('COL', '2026-02', 5, 60, 200);          // normal
  seedPosts('COL', '2026-02', 5, 1000, 1000, 1);    // collab
  insReach.run('COL', '2026-02', 100);
  const withCollab = getEstimatedUniqueClicksByAccount({ months: ['2026-02'] })['COL'];
  const without = getEstimatedUniqueClicksByAccount({ months: ['2026-02'], excludeCollab: true })['COL'];
  // Excluding collab lowers Σreach (denominator-side) and Σlink_clicks → different result.
  assert.notDeepEqual(withCollab, without);
  // Without collab: Σreach 300 / ar 100 = F 3, Σlc 1000 → upper 333.
  assert.deepEqual(without, { upper: 333, lower: 222, quality: 'ok' });
});
