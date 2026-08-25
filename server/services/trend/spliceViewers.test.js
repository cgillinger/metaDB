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

test('legacy-månad UTAN viewers efter bytet blir hål + skugga, aldrig linje', () => {
  // 2026-02 har bara legacy, men ligger efter att viewers tagit över.
  const r = spliceAccountSeries(AXIS, { '2025-11': 100, '2026-02': 777 }, { '2026-01': 99 });
  assert.equal(r.data[2].source, 'viewers');
  assert.equal(r.data[3].value, null, 'får inte återgå till legacy-måttet');
  assert.equal(r.data[3].source, null);
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
  assert.equal(r.data[0].source, 'legacy');
  // Brytpunkten är visuell: viewers-månaden ligger utanför axeln → inget att markera.
  assert.equal(r.breakpoint_month, null);
});

test('REGRESSION: periodfilter som klipper bort historiken får inte ge legacy företräde', () => {
  // Axeln täcker bara viewers-eran. Legacy finns för jan–maj (överlappet), men
  // ingen legacy-månad ligger före första viewers-månaden i det här fönstret.
  // Linjen måste ändå följa VIEWERS — annars visas gamla måttet som om det vore
  // det nya, i en solid omarkerad linje.
  const axis = ['2026-01', '2026-02', '2026-05', '2026-06'];
  const legacy = { '2026-01': 3244571, '2026-02': 1697711, '2026-05': 3535640 };
  const viewers = { '2026-01': 3195461, '2026-02': 1682630, '2026-05': 3996884, '2026-06': 2049739 };
  const r = spliceAccountSeries(axis, legacy, viewers);
  assert.deepEqual(r.data.map(d => d.source), ['viewers', 'viewers', 'viewers', 'viewers']);
  assert.deepEqual(r.data.map(d => d.value), [3195461, 1682630, 3996884, 2049739]);
  assert.deepEqual(r.data.map(d => d.ghost), [3244571, 1697711, 3535640, null]);
  assert.equal(r.breakpoint_month, null, 'ingen legacy-del i fönstret → inget måttbyte att markera');
});

test('samma månad ger samma värde med och utan periodfilter', () => {
  const legacy = { '2025-12': 111, '2026-01': 3244571 };
  const viewers = { '2026-01': 3195461, '2026-02': 222 };
  const full = spliceAccountSeries(['2025-12', '2026-01', '2026-02'], legacy, viewers);
  const filtered = spliceAccountSeries(['2026-01', '2026-02'], legacy, viewers);
  const janFull = full.data[full.data.length - 2];
  const janFiltered = filtered.data[0];
  assert.equal(janFull.value, janFiltered.value);
  assert.equal(janFull.source, janFiltered.source);
  assert.equal(janFull.ghost, janFiltered.ghost);
  // Markeringen skiljer sig — den är visuell och beror på om legacy-delen syns.
  assert.equal(full.breakpoint_month, '2026-01');
  assert.equal(filtered.breakpoint_month, null);
});

test('REGRESSION: partiell backfill får inte blanka legacy-historiken', () => {
  // Backfill av viewers sker en månad per körning och kan landa i godtycklig
  // ordning. En tidig backfillad månad (2024-06) följd av en lucka fick tidigare
  // ALLA legacy-månader efter den att bli hål — år av linje försvann.
  const axis = ['2024-06', '2024-07', '2024-08', '2026-01', '2026-02'];
  const legacy = { '2024-06': 90, '2024-07': 100, '2024-08': 110, '2026-01': 120 };
  const viewers = { '2024-06': 85, '2026-01': 99, '2026-02': 105 };
  const r = spliceAccountSeries(axis, legacy, viewers);
  // Viewers vinner där viewers finns; legacy bär mellanmånaderna utan viewers.
  assert.deepEqual(r.data.map(d => d.source), ['viewers', 'legacy', 'legacy', 'viewers', 'viewers']);
  assert.deepEqual(r.data.map(d => d.value), [85, 100, 110, 99, 105]);
  // Måttbytet markeras vid den AVSLUTANDE viewers-svitens start, inte vid den
  // tidiga backfillade månaden.
  assert.equal(r.breakpoint_month, '2026-01');
});

test('legacy-rad efter den avslutande viewers-sviten är fortfarande skugga', () => {
  // Även med en backfillad tidig viewers-månad får legacy inte återta linjen
  // inuti/efter den avslutande sviten.
  const axis = ['2024-06', '2024-07', '2026-01', '2026-02'];
  const legacy = { '2024-07': 100, '2026-02': 777 };
  const viewers = { '2024-06': 85, '2026-01': 99 };
  const r = spliceAccountSeries(axis, legacy, viewers);
  assert.equal(r.data[3].value, null);
  assert.equal(r.data[3].source, null);
  assert.equal(r.data[3].ghost, 777);
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
