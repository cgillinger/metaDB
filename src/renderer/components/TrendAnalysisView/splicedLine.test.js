import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakpointIndex, ghostRuns, distinctBreakpointIndexes } from './splicedLine.js';

const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02'];

test('breakpointIndex hittar månaden', () => {
  assert.equal(breakpointIndex(MONTHS, '2026-01'), 2);
});

test('breakpointIndex ger -1 när månaden ligger utanför axeln', () => {
  assert.equal(breakpointIndex(MONTHS, '2026-07'), -1);
  assert.equal(breakpointIndex(MONTHS, null), -1);
});

test('breakpointIndex ger -1 i vänsterkanten', () => {
  // Index 0 = ingen legacy-del syns, alltså inget att markera.
  assert.equal(breakpointIndex(MONTHS, '2025-11'), -1);
});

test('ghostRuns: en sammanhängande körning', () => {
  const runs = ghostRuns([{ ghostY: null }, { ghostY: 10 }, { ghostY: 20 }, { ghostY: 30 }]);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].map(p => p.ghostY), [10, 20, 30]);
});

test('ghostRuns: hål bryter körningen', () => {
  const runs = ghostRuns([{ ghostY: 10 }, { ghostY: null }, { ghostY: 30 }, { ghostY: 40 }]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].map(p => p.ghostY), [10]);
  assert.deepEqual(runs[1].map(p => p.ghostY), [30, 40]);
});

test('ghostRuns: tomt och enpunkts', () => {
  assert.deepEqual(ghostRuns([]), []);
  assert.deepEqual(ghostRuns(undefined), []);
  assert.equal(ghostRuns([{ ghostY: 5 }]).length, 1);
});

test('distinctBreakpointIndexes dedupliceras och sorteras', () => {
  const lines = [
    { breakpointMonth: '2026-02' },
    { breakpointMonth: '2026-01' },
    { breakpointMonth: '2026-01' },
    { breakpointMonth: null },
    { breakpointMonth: '2027-01' },
  ];
  assert.deepEqual(distinctBreakpointIndexes(lines, MONTHS), [2, 3]);
});

test('distinctBreakpointIndexes utan linjer', () => {
  assert.deepEqual(distinctBreakpointIndexes([], MONTHS), []);
  assert.deepEqual(distinctBreakpointIndexes(undefined, MONTHS), []);
});
