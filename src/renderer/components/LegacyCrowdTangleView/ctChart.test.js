import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceYAxis, ctMonthLabel, ctSegments } from './ctChart.js';

test('niceYAxis rounds up and starts at 0', () => {
  const a = niceYAxis([0, 287537, null]);
  assert.equal(a.ticks[0], 0);
  assert.ok(a.max >= 287537);
  assert.deepEqual(niceYAxis([]), { max: 1, ticks: [0, 1] });
});

test('ctMonthLabel is Swedish', () => {
  assert.equal(ctMonthLabel('2019-03'), 'mars 2019');
});

test('ctSegments breaks at gaps and takes right-hand source', () => {
  const p = (y, source) => ({ y, d: { source } });
  const segs = ctSegments([p(1, 'crowdtangle'), p(2, 'crowdtangle'), p(null, null), p(3, 'metadb'), p(4, 'metadb')]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map(s => s.source), ['crowdtangle', 'metadb']);
});

test('yearly helpers: source labels, CT detection, partial year label', async () => {
  const { CT_YEAR_SOURCE_LABEL, isCtYearSource, ctYearLabel } = await import('./ctChart.js');
  assert.equal(CT_YEAR_SOURCE_LABEL.crowdtangle_months, 'CrowdTangle, summa av 12 månader');
  assert.equal(CT_YEAR_SOURCE_LABEL.crowdtangle_year, 'CrowdTangle, helårsexport');
  assert.equal(isCtYearSource('crowdtangle_year'), true);
  assert.equal(isCtYearSource('metadb'), false);
  assert.equal(ctYearLabel(2026, true), '2026 (hittills i år)');
  assert.equal(ctYearLabel(2024, false), '2024');
});
