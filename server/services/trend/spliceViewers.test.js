import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spliceAccountSeries, buildSplicedSeries, collectMonths } from './spliceViewers.js';

const AXIS = ['2025-11', '2025-12', '2026-01', '2026-02'];

test('bara legacy: allt märks legacy, ingen brytpunkt, inga skuggor', () => {
  const r = spliceAccountSeries(AXIS, { '2025-11': 100, '2025-12': 110, '2026-01': 120, '2026-02': 130 }, {});
  assert.deepEqual(r.data.map(d => d.source), ['legacy', 'legacy', 'legacy', 'legacy']);
  assert.equal(r.breakpoint_month, null);
  assert.equal(r.splice_status, 'legacy_only');
  assert.ok(r.data.every(d => d.ghost === null));
  assert.equal(r.legacy_last_month, '2026-02');
});

test('bara viewers: ingen brytpunkt, hela linjen solid', () => {
  const r = spliceAccountSeries(AXIS, {}, { '2025-11': 90, '2025-12': 95, '2026-01': 99, '2026-02': 105 });
  assert.deepEqual(r.data.map(d => d.source), ['viewers', 'viewers', 'viewers', 'viewers']);
  assert.equal(r.breakpoint_month, null);
  assert.equal(r.splice_status, 'viewers_only');
  assert.equal(r.viewers_first_month, '2025-11');
});

test('ren övergång utan överlapp: brytpunkt vid första viewers-månaden', () => {
  const r = spliceAccountSeries(AXIS, { '2025-11': 100, '2025-12': 110 }, { '2026-01': 99, '2026-02': 105 });
  assert.equal(r.breakpoint_month, '2026-01');
  assert.deepEqual(r.data.map(d => d.source), ['legacy', 'legacy', 'viewers', 'viewers']);
  assert.deepEqual(r.data.map(d => d.value), [100, 110, 99, 105]);
  assert.ok(r.data.every(d => d.ghost === null));
  assert.deepEqual(r.overlap_months, []);
});

test('designat överlapp: linjen följer viewers, legacy blir skugga', () => {
  const r = spliceAccountSeries(
    AXIS,
    { '2025-11': 100, '2025-12': 110, '2026-01': 120, '2026-02': 130 },
    { '2026-01': 99, '2026-02': 105 }
  );
  assert.equal(r.breakpoint_month, '2026-01');
  assert.equal(r.splice_status, 'spliced');
  assert.deepEqual(r.data.map(d => d.value), [100, 110, 99, 105]);
  assert.deepEqual(r.data.map(d => d.ghost), [null, null, 120, 130]);
  assert.deepEqual(r.overlap_months, ['2026-01', '2026-02']);
});

test('hål i serien blir null — aldrig 0', () => {
  const r = spliceAccountSeries(AXIS, { '2025-11': 100, '2026-02': 130 }, {});
  assert.deepEqual(r.data.map(d => d.value), [100, null, null, 130]);
  assert.deepEqual(r.data.map(d => d.source), ['legacy', null, null, 'legacy']);
});

test('legacy-rad efter brytpunkten hamnar i ghost, aldrig i linjen', () => {
  // Sen ombackfill av legacy för en månad som redan tillhör viewers-eran.
  const r = spliceAccountSeries(AXIS, { '2025-11': 100, '2026-02': 777 }, { '2026-01': 99, '2026-02': 105 });
  assert.equal(r.breakpoint_month, '2026-01');
  assert.equal(r.data[3].value, 105);
  assert.equal(r.data[3].source, 'viewers');
  assert.equal(r.data[3].ghost, 777);
});

test('viewers saknas helt (prod-scenariot) kraschar inte', () => {
  const r = spliceAccountSeries(AXIS, { '2025-11': 100 }, undefined);
  assert.equal(r.splice_status, 'legacy_only');
  assert.equal(r.breakpoint_month, null);
  assert.equal(r.data[0].value, 100);
});

test('tomt underlag ger enbart hål', () => {
  const r = spliceAccountSeries(AXIS, {}, {});
  assert.equal(r.splice_status, 'empty');
  assert.ok(r.data.every(d => d.value === null && d.source === null && d.ghost === null));
});

test('kortare axel än datan respekteras', () => {
  const r = spliceAccountSeries(['2025-12'], { '2025-11': 100, '2025-12': 110 }, { '2026-01': 99 });
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].value, 110);
  // Brytpunkten rapporteras även när den ligger utanför axeln — klienten tål indexOf === -1.
  assert.equal(r.breakpoint_month, '2026-01');
});

test('buildSplicedSeries: unionen av konton ur båda tabellerna', () => {
  const legacyRows = [
    { period: '2025-11', account_name: 'Bara legacy', value: 50 },
    { period: '2025-11', account_name: 'Båda', value: 100 },
  ];
  const viewersRows = [
    { period: '2026-01', account_name: 'Båda', value: 99 },
    { period: '2026-01', account_name: 'Bara viewers', value: 42 },
  ];
  const { months, series } = buildSplicedSeries({ axis: AXIS, legacyRows, viewersRows });
  assert.equal(months, AXIS);
  assert.deepEqual(series.map(s => s.account_name), ['Bara legacy', 'Bara viewers', 'Båda']);
  assert.deepEqual(series.map(s => s.splice_status), ['legacy_only', 'viewers_only', 'spliced']);
  assert.ok(series.every(s => s.platform === 'facebook'));
  assert.equal(series.find(s => s.account_name === 'Båda').breakpoint_month, '2026-01');
});

test('collectMonths tar unionen', () => {
  const set = collectMonths(
    [{ period: '2025-11' }, { period: '2025-12' }],
    [{ period: '2025-12' }, { period: '2026-01' }]
  );
  assert.deepEqual([...set].sort(), ['2025-11', '2025-12', '2026-01']);
});
