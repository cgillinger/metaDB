import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  YOY_MONTH_AXIS,
  deriveYears,
  yearLabel,
  defaultSelectedYears,
  buildYoYLines,
} from './yearOverYear.js';

const NOW_2026_06 = new Date('2026-06-05T00:00:00');

test('YOY_MONTH_AXIS is the 12 zero-padded months', () => {
  assert.deepEqual(YOY_MONTH_AXIS, [
    '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12',
  ]);
});

test('deriveYears: empty map yields no years', () => {
  assert.deepEqual(deriveYears({}, { now: NOW_2026_06 }), []);
  assert.deepEqual(deriveYears({ '2025-01': null }, { now: NOW_2026_06 }), []);
});

test('deriveYears: complete vs partial (span-based) and latest flag', () => {
  // 2024 full, 2025 full, 2026 only through May → partial+latest+current.
  const dataMap = {};
  for (const y of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) dataMap[`${y}-${String(m).padStart(2, '0')}`] = 10;
  }
  for (let m = 1; m <= 5; m++) dataMap[`2026-${String(m).padStart(2, '0')}`] = 10;

  const years = deriveYears(dataMap, { now: NOW_2026_06 });
  assert.deepEqual(
    years.map((y) => [y.year, y.complete, y.isLatest, y.isCurrent]),
    [
      [2024, true, false, false],
      [2025, true, false, false],
      [2026, false, true, true],
    ]
  );
});

test('deriveYears: leading partial year is not complete', () => {
  // Data starts 2023-08 → 2023 is partial (leading), 2024 complete.
  const dataMap = {};
  for (let m = 8; m <= 12; m++) dataMap[`2023-${String(m).padStart(2, '0')}`] = 5;
  for (let m = 1; m <= 12; m++) dataMap[`2024-${String(m).padStart(2, '0')}`] = 5;

  const years = deriveYears(dataMap, { now: NOW_2026_06 });
  assert.deepEqual(
    years.map((y) => [y.year, y.complete, y.isLatest]),
    [
      [2023, false, false],
      [2024, true, true],
    ]
  );
});

test('yearLabel: complete, latest-partial, leading-partial', () => {
  assert.equal(yearLabel({ year: 2025, complete: true, isLatest: false }), '2025');
  assert.equal(yearLabel({ year: 2026, complete: false, isLatest: true }), '2026 (hittills)');
  assert.equal(yearLabel({ year: 2023, complete: false, isLatest: false }), '2023 (delvis)');
});

test('defaultSelectedYears: complete years + latest partial', () => {
  const years = [
    { year: 2023, complete: false, isLatest: false },
    { year: 2024, complete: true, isLatest: false },
    { year: 2025, complete: true, isLatest: false },
    { year: 2026, complete: false, isLatest: true },
  ];
  assert.deepEqual(defaultSelectedYears(years), [2024, 2025, 2026]);
});

test('defaultSelectedYears: falls back to all candidates when <2 preferred', () => {
  // Two partial years, none complete, only the latest would be preferred → fall back to all.
  const years = [
    { year: 2024, complete: false, isLatest: false },
    { year: 2025, complete: false, isLatest: true },
  ];
  assert.deepEqual(defaultSelectedYears(years), [2024, 2025]);
});

test('buildYoYLines: 12 points per year, missing months are null gaps', () => {
  const dataMap = { '2026-01': 100, '2026-02': 0, '2026-03': 50 };
  const years = deriveYears(dataMap, { now: NOW_2026_06 });
  const lines = buildYoYLines(dataMap, years, [2026], ['#abc']);

  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.equal(line.points.length, 12);
  assert.equal(line.account_name, '2026 (hittills)');
  assert.equal(line.color, '#abc');
  // Genuine zero stays 0 (baseline), absent months become null (gap).
  assert.equal(line.points[0].value, 100);
  assert.equal(line.points[1].value, 0);
  assert.equal(line.points[2].value, 50);
  assert.equal(line.points[3].value, null);
  assert.equal(line.points[11].value, null);
});

test('buildYoYLines: colors cycle by selection order', () => {
  const dataMap = {};
  for (const y of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) dataMap[`${y}-${String(m).padStart(2, '0')}`] = 1;
  }
  const years = deriveYears(dataMap, { now: NOW_2026_06 });
  const lines = buildYoYLines(dataMap, years, [2024, 2025], ['#a', '#b']);
  assert.deepEqual(lines.map((l) => l.color), ['#a', '#b']);
  assert.deepEqual(lines.map((l) => l.account_name), ['2024', '2025']);
});
