import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMissingAccounts, jaccardSimilarity } from './missingAccounts.js';

const names = (...ns) => new Set(ns);

test('jaccardSimilarity: identiska mängder ger 1, disjunkta ger 0', () => {
  assert.equal(jaccardSimilarity(names('A', 'B'), names('A', 'B')), 1);
  assert.equal(jaccardSimilarity(names('A'), names('B')), 0);
  assert.equal(jaccardSimilarity(names('A', 'B', 'C'), names('A', 'B')), 2 / 3);
});

test('jaccardSimilarity: tomma mängder ger 0, aldrig NaN', () => {
  assert.equal(jaccardSimilarity(new Set(), names('A')), 0);
  assert.equal(jaccardSimilarity(new Set(), new Set()), 0);
});

test('tom historik ger inga larm', () => {
  const r = findMissingAccounts({ importedNames: names('A'), history: [] });
  assert.deepEqual(r, []);
});

test('konto som alltid funnits larmar inte', () => {
  const history = [
    { month: '2026-01', names: names('A', 'B') },
    { month: '2026-02', names: names('A', 'B') },
  ];
  const r = findMissingAccounts({ importedNames: names('A', 'B'), history });
  assert.deepEqual(r, []);
});

test('konto under tröskeln (< minSeen) larmar inte utan öppen lucka', () => {
  const history = [
    { month: '2026-01', names: names('A', 'B') },
    { month: '2026-02', names: names('A') },
    { month: '2026-03', names: names('A') },
    { month: '2026-04', names: names('A') },
  ];
  // B was only seen in 1 of 4 — below the default minSeen=4, no open gap.
  const r = findMissingAccounts({ importedNames: names('A'), history, window: 4 });
  assert.deepEqual(r, []);
});

test('konto som når tröskeln (>= minSeen) larmar, reason=threshold', () => {
  const history = [
    { month: '2026-01', names: names('A', 'B') },
    { month: '2026-02', names: names('A', 'B') },
    { month: '2026-03', names: names('A', 'B') },
    { month: '2026-04', names: names('A', 'B') },
    { month: '2026-05', names: names('A') },
    { month: '2026-06', names: names('A') },
  ];
  const r = findMissingAccounts({ importedNames: names('A'), history });
  assert.deepEqual(r, [
    { account_name: 'B', seenIn: 4, of: 6, lastSeen: '2026-04', reason: 'threshold' },
  ]);
});

test('konto borta flera månader i rad (icke-sammanhängande i fönstret) larmar ändå', () => {
  // The Kvällspasset/Naturmorgon case: gone for half a year straight, but still
  // present in >=4 of the last 6 BEFORE the absence — must still alarm.
  const history = [
    { month: '2026-01', names: names('A') },      // Kvällspasset already missing here
    { month: '2025-12', names: names('A') },
    { month: '2025-11', names: names('A', 'Kvällspasset') },
    { month: '2025-10', names: names('A', 'Kvällspasset') },
    { month: '2025-09', names: names('A', 'Kvällspasset') },
    { month: '2025-08', names: names('A', 'Kvällspasset') },
  ];
  const r = findMissingAccounts({ importedNames: names('A'), history });
  assert.deepEqual(r, [
    { account_name: 'Kvällspasset', seenIn: 4, of: 6, lastSeen: '2025-11', reason: 'threshold' },
  ]);
});

test('retirerat konto larmar aldrig, även över tröskeln eller med öppen lucka', () => {
  const history = [
    { month: '2026-01', names: names('A', 'B') },
    { month: '2026-02', names: names('A', 'B') },
    { month: '2026-03', names: names('A', 'B') },
    { month: '2026-04', names: names('A', 'B') },
  ];
  const r = findMissingAccounts({
    importedNames: names('A'),
    history,
    retired: names('B'),
    openGapAccounts: names('B'),
  });
  assert.deepEqual(r, []);
});

test('öppen lucka spåras även under tröskeln, reason=open-gap', () => {
  const history = [
    { month: '2026-01', names: names('A') },
    { month: '2026-02', names: names('A') },
    { month: '2026-03', names: names('A') },
  ];
  // 'Naturmorgon' doesn't appear in the Jaccard-scoped window at all (already
  // gone longer than the window reaches back) but has an unresolved row in account_gaps.
  const r = findMissingAccounts({
    importedNames: names('A'),
    history,
    openGapAccounts: names('Naturmorgon'),
  });
  assert.deepEqual(r, [
    { account_name: 'Naturmorgon', seenIn: 0, of: 3, lastSeen: null, reason: 'open-gap' },
  ]);
});

test('reason=threshold vinner över open-gap när båda gäller', () => {
  const history = [
    { month: '2026-01', names: names('A', 'B') },
    { month: '2026-02', names: names('A', 'B') },
    { month: '2026-03', names: names('A', 'B') },
    { month: '2026-04', names: names('A', 'B') },
  ];
  const r = findMissingAccounts({
    importedNames: names('A'),
    history,
    openGapAccounts: names('B'),
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].reason, 'threshold');
});

test('window begränsar hur många historikposter som räknas, nyast först', () => {
  const history = [
    { month: '2026-01', names: names('A') },
    { month: '2025-12', names: names('A') },
    { month: '2025-11', names: names('A') },
    { month: '2025-10', names: names('A', 'B') }, // outside window=3
  ];
  const r = findMissingAccounts({ importedNames: names('A'), history, window: 3, minSeen: 1 });
  assert.deepEqual(r, []); // B only appears outside the window
});
