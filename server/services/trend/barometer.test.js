import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBarometer, calcYearOverYear } from './barometer.js';

test('calcYearOverYear reproduces baseline Fixture B (P4/FB)', () => {
  // Sista månad 2026-06 (37836) mot 2025-06 (58232) → delta −0.3502541557906306
  const months = [
    { month: '2025-06', avg_views: 58232 },
    { month: '2025-12', avg_views: 50000 },
    { month: '2026-06', avg_views: 37836 },
  ];
  const yoy = calcYearOverYear(months);
  assert.equal(yoy.currentMonth, '2026-06');
  assert.equal(yoy.previousMonth, '2025-06');
  assert.equal(yoy.currentValue, 37836);
  assert.equal(yoy.previousValue, 58232);
  assert.equal(yoy.delta, (37836 - 58232) / 58232);
  assert.equal(yoy.delta, -0.3502541557906306);
  assert.equal(yoy.status, 'falling');
});

test('calcYearOverYear returns null when same month last year is missing', () => {
  assert.equal(calcYearOverYear([{ month: '2026-06', avg_views: 100 }]), null);
  const noPrev = [{ month: '2025-05', avg_views: 100 }, { month: '2026-06', avg_views: 100 }];
  assert.equal(calcYearOverYear(noPrev), null);
});

test('calcYearOverYear returns null when previous value is 0 (no division)', () => {
  const months = [{ month: '2025-06', avg_views: 0 }, { month: '2026-06', avg_views: 100 }];
  assert.equal(calcYearOverYear(months), null);
});

test('calcBarometer compares trailing windows and classifies', () => {
  // window 2: recent [120,120] avg 120, previous [100,100] avg 100 → +20% rising
  const months = [
    { avg_views: 100 }, { avg_views: 100 }, { avg_views: 120 }, { avg_views: 120 },
  ];
  const b = calcBarometer(months, 2);
  assert.equal(b.recentAvg, 120);
  assert.equal(b.prevAvg, 100);
  assert.equal(b.delta, 0.2);
  assert.equal(b.status, 'rising');
});

test('calcBarometer ±10% band is stable', () => {
  const months = [{ avg_views: 100 }, { avg_views: 105 }]; // +5%
  assert.equal(calcBarometer(months, 1).status, 'stable');
});

test('calcBarometer guards thin data and prevAvg 0', () => {
  assert.equal(calcBarometer([{ avg_views: 1 }], 1), null);        // < window*2
  assert.equal(calcBarometer([{ avg_views: 0 }, { avg_views: 5 }], 1), null); // prevAvg 0
});
