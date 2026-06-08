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

// TikTok Video-CSV: handle och post_id extraheras ur Videolänk; engagement-formel
// per inlägg är likes+comments+shares+saves; tidszonen är redan Stockholm (ingen konvertering).
const TIKTOK_VIDEO_CSV = [
  'Videotitel,Videolänk,Publiceringstid,Videovisningar,Gilla-markeringar,Kommentarer,Delningar,Lägg till i Favoriter',
  'Hej världen,https://www.tiktok.com/@p3dingata/video/7634573645129452822,2026/04/30 15:25:02,196277,8296,44,621,363',
  ',https://www.tiktok.com/@p3dingata/video/7634530407832128790,2026/04/30 12:37:18,12680,566,4,4,21',
].join('\n');

test('parseCSV detects TikTok and extracts handle + post_id from URL', () => {
  const { platform, posts, month } = parseCSV(TIKTOK_VIDEO_CSV, 'tt.csv');
  assert.equal(platform, 'tiktok');
  assert.equal(posts.length, 2);
  assert.equal(month, '2026-04');

  const first = posts.find(p => p.post_id === '7634573645129452822');
  assert.equal(first.account_username, 'p3dingata');
  assert.equal(first.permalink, 'https://www.tiktok.com/@p3dingata/video/7634573645129452822');
  assert.equal(first.publish_time, '2026-04-30 15:25:02'); // slash → dash, ingen TZ-konvertering
  assert.equal(first.views, 196277);
  assert.equal(first.likes, 8296);
  assert.equal(first.comments, 44);
  assert.equal(first.shares, 621);
  assert.equal(first.saves, 363);
  assert.equal(first.interactions, 8296 + 44 + 621);
  assert.equal(first.engagement, 8296 + 44 + 621 + 363); // TikTok: i+s
  assert.equal(first.post_type, 'Videor');
  assert.equal(first.description, 'Hej världen');
});

test('parseCSV handles empty TikTok title (defensive)', () => {
  const { posts } = parseCSV(TIKTOK_VIDEO_CSV, 'tt.csv');
  const empty = posts.find(p => p.post_id === '7634530407832128790');
  assert.equal(empty.description, null);
  assert.equal(empty.account_username, 'p3dingata');
});
