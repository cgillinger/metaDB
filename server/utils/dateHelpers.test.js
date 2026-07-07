import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodDays, daysInMonth } from './dateHelpers.js';

test('daysInMonth handles regular and leap months', () => {
  assert.equal(daysInMonth('2026-01'), 31);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2024-02'), 29);
});

// Regressionsskydd: 23:59:59-ankare + `+1` dubbelräknade — en hel månad blev
// 32 dagar och en endagsperiod 2, vilket sänkte alla snitt/dag-mätvärden.
test('periodDays counts dateFrom/dateTo ranges inclusively without off-by-one', () => {
  assert.equal(periodDays({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }), 31);
  assert.equal(periodDays({ dateFrom: '2026-06-15', dateTo: '2026-06-15' }), 1);
  assert.equal(periodDays({ dateFrom: '2026-01-01', dateTo: '2026-02-28' }), 59);
});

test('periodDays sums month lists and returns null without a filter', () => {
  assert.equal(periodDays({ months: '2026-01,2026-02' }), 59);
  assert.equal(periodDays({}), null);
});
