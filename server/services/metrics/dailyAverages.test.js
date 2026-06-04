import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avgPerDay, accountDailyAverages, groupAvgPerDay, daysOverMonths,
} from './dailyAverages.js';

test('avgPerDay reproduces baseline snitt/dag (Fixture A)', () => {
  // P4 Göteborg feb 2026: link_clicks 109157 / 28 dgr → 3898.5
  assert.equal(avgPerDay(109157, 28, 1), 3898.5);
  // P4 Stockholm feb 2026: 52743 / 28 → 1883.7
  assert.equal(avgPerDay(52743, 28, 1), 1883.7);
  // posts_per_day, 2 decimaler: 221 / 28 → 7.89
  assert.equal(avgPerDay(221, 28, 2), 7.89);
});

test('accountDailyAverages matches accounts.js contract', () => {
  const r = accountDailyAverages({ link_clicks: 109157, post_count: 221 }, 28);
  assert.deepEqual(r, { avg_daily_link_clicks: 3898.5, posts_per_day: 7.89 });
});

test('groupAvgPerDay is sum-before-scale (Fixture E "Alla P4")', () => {
  // 25 medlemmar, Σlink_clicks 1518417 / 28 → 54229.2 (aldrig medel av medel)
  const members = [
    { link_clicks: 1000000 }, { link_clicks: 500000 }, { link_clicks: 18417 },
  ];
  assert.equal(groupAvgPerDay(members, 'link_clicks', 28, 1), 54229.2);
});

test('groupAvgPerDay differs from mean-of-means', () => {
  const members = [{ link_clicks: 100 }, { link_clicks: 0 }];
  // SBS: (100+0)/10 = 10. Mean-of-means: avg(10, 0) = 5 → måste vara 10.
  assert.equal(groupAvgPerDay(members, 'link_clicks', 10, 1), 10);
});

test('avgPerDay guards days ≤ 0 and missing total', () => {
  assert.equal(avgPerDay(1000, 0), 0);
  assert.equal(avgPerDay(1000, null), 0);
  assert.equal(avgPerDay(undefined, 28), 0);
});

test('daysOverMonths sums calendar days (GA-mönster)', () => {
  assert.equal(daysOverMonths(['2026-02']), 28);     // feb 2026 = 28
  assert.equal(daysOverMonths(['2026-01', '2026-02']), 59); // 31 + 28
  assert.equal(daysOverMonths(['2024-02']), 29);     // skottår
  assert.equal(daysOverMonths([], 30), 30);          // fallback
  assert.equal(daysOverMonths(null, null), null);
});
