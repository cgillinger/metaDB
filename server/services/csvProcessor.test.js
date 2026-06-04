import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from './csvProcessor.js';

// Minimal Facebook CSV (header 'Sidnamn' makes detectPlatform pick facebook).
// Row 1: empty Sidnamn + resolvable permalink → attributed from slug map.
// Row 2: empty Sidnamn + denylisted reel URL → must NOT be attributed.
// Row 3: present Sidnamn → untouched.
const CSV = [
  'Publicerings-id,Sidnamn,Permalänk,Publiceringstid',
  '1,,https://www.facebook.com/p4kalmar/posts/pfbid0abc,2026-02-10 12:00:00',
  '2,,https://www.facebook.com/reel/699716579231102/,2026-02-11 12:00:00',
  '3,P4 Named,https://www.facebook.com/p4named/posts/x,2026-02-12 12:00:00',
].join('\n');

const slugMap = new Map([
  ['facebook::p4kalmar', { account_name: 'P4 Kalmar Sveriges Radio', account_id: '123' }],
]);

test('parseCSV attributes empty Sidnamn from permalink slug', () => {
  const { posts, stats } = parseCSV(CSV, 'fb.csv', { slugMap });
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));

  // Positive: resolved from slug map.
  assert.equal(byId['1'].account_name, 'P4 Kalmar Sveriges Radio');
  assert.equal(byId['1'].account_id, '123');

  // Denylisted URL (reel) → never attributed, stays empty.
  assert.equal(byId['2'].account_name, null);

  // Existing name untouched.
  assert.equal(byId['3'].account_name, 'P4 Named');

  assert.equal(stats.attributedViaPermalink, 1);
});

test('parseCSV without a slugMap leaves empty Sidnamn empty', () => {
  const { posts, stats } = parseCSV(CSV, 'fb.csv');
  const byId = Object.fromEntries(posts.map(p => [p.post_id, p]));
  assert.equal(byId['1'].account_name, null);
  assert.equal(stats.attributedViaPermalink, 0);
});
