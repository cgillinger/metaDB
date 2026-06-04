import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonth, monthRange, resolveMonthAxis, resolveMonthList,
  resolvePeriodDays, resolvePeriod,
} from './resolve.js';

test('resolveMonthAxis: months are trimmed, filtered and SORTED (= buildMonthSpan)', () => {
  assert.deepEqual(resolveMonthAxis({ months: '2026-02, 2026-01 ,' }), ['2026-01', '2026-02']);
});

test('resolveMonthAxis: dateFrom/dateTo projects to inclusive month span', () => {
  assert.deepEqual(
    resolveMonthAxis({ dateFrom: '2024-12-05', dateTo: '2025-02-20' }),
    ['2024-12', '2025-01', '2025-02'],
  );
});

test('resolveMonthAxis: no filter → null', () => {
  assert.equal(resolveMonthAxis({}), null);
});

test('resolveMonthList: months NOT sorted (= accounts.js reachMonths)', () => {
  assert.deepEqual(resolveMonthList({ months: '2026-02,2026-01' }), ['2026-02', '2026-01']);
});

test('resolveMonthList: no filter → []', () => {
  assert.deepEqual(resolveMonthList({}), []);
});

test('resolvePeriodDays sums calendar days', () => {
  assert.equal(resolvePeriodDays({ months: '2026-02' }), 28);
  assert.equal(resolvePeriodDays({ months: '2026-01,2026-02' }), 59);
  assert.equal(resolvePeriodDays({}), null);
});

test('nextMonth / monthRange helpers', () => {
  assert.equal(nextMonth('2025-12'), '2026-01');
  assert.deepEqual(monthRange('2025-11', '2026-01'), ['2025-11', '2025-12', '2026-01']);
});

test('resolvePeriod bundles the normalized descriptor', () => {
  const p = resolvePeriod({ months: '2026-02,2026-01' });
  assert.deepEqual(p.monthAxis, ['2026-01', '2026-02']);
  assert.deepEqual(p.monthList, ['2026-02', '2026-01']);
  assert.equal(p.days, 59);
  assert.equal(p.hasFilter, true);

  const none = resolvePeriod({});
  assert.equal(none.monthAxis, null);
  assert.deepEqual(none.monthList, []);
  assert.equal(none.days, null);
  assert.equal(none.hasFilter, false);
});
