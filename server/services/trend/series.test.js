import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextMonth, monthRange, fullMonthAxis, zeroFill, buildZeroFilledSeries,
} from './series.js';

test('nextMonth rolls over the year boundary', () => {
  assert.equal(nextMonth('2025-12'), '2026-01');
  assert.equal(nextMonth('2025-01'), '2025-02');
});

test('monthRange is inclusive', () => {
  assert.deepEqual(monthRange('2024-12', '2025-02'), ['2024-12', '2025-01', '2025-02']);
  assert.deepEqual(monthRange('2026-02', '2026-02'), ['2026-02']);
});

test('fullMonthAxis spans min..max regardless of order/gaps', () => {
  assert.deepEqual(fullMonthAxis(['2025-02', '2024-12']), ['2024-12', '2025-01', '2025-02']);
  assert.deepEqual(fullMonthAxis([]), []);
  assert.deepEqual(fullMonthAxis(['2026-03']), ['2026-03']);
});

test('zeroFill fills missing months with 0 (Fixture C scenario)', () => {
  // P4 DANS-liknande: 2025-11 saknas helt → ska bli 0, grannar bevaras
  const dataMap = { '2025-10': 986992, '2025-12': 236593 };
  const axis = ['2025-10', '2025-11', '2025-12'];
  assert.deepEqual(zeroFill(axis, dataMap), [986992, 0, 236593]);
});

test('buildZeroFilledSeries builds full axis and zero-fills all gaps', () => {
  const dataMap = { '2025-10': 986992, '2025-12': 236593 }; // 2025-11 saknas
  const { months, data } = buildZeroFilledSeries(dataMap);
  assert.deepEqual(months, ['2025-10', '2025-11', '2025-12']);
  assert.deepEqual(data, [986992, 0, 236593]);
});

test('buildZeroFilledSeries honours an explicit axis (period filter)', () => {
  const dataMap = { '2026-02': 5 };
  const { months, data } = buildZeroFilledSeries(dataMap, { axis: ['2026-01', '2026-02', '2026-03'] });
  assert.deepEqual(months, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(data, [0, 5, 0]);
});
