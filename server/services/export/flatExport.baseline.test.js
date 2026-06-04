import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Binds export cells to the captured service outputs in baseline.json. Requires the
// production snapshot the baseline was captured against (.baseline-prod/analytics.db);
// skips gracefully where it isn't present (e.g. CI) so the suite stays green.
const SNAP = '.baseline-prod/analytics.db';
const hasSnapshot = fs.existsSync(SNAP);
const opts = hasSnapshot ? {} : { skip: 'no .baseline-prod snapshot present' };

let sheet, baseline;
if (hasSnapshot) {
  process.env.DB_PATH = SNAP;
  const XLSX = await import('xlsx');
  const { buildFlatWorkbook } = await import('./flatExport.js');
  baseline = JSON.parse(fs.readFileSync('baseline.json', 'utf-8')).fixtures;
  const wb = buildFlatWorkbook();
  sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { raw: true });
}

const find = (tab, pred) => sheet(tab).find(pred);

test('posts_groups_monthly "Alla P4" feb 2026 == Fixture E', opts, () => {
  const exp = baseline.E_group_sbs_alla_p4_feb2026.group.avg_daily_link_clicks; // 54229.2
  const row = find('posts_groups_monthly', r => r.group_name === 'Alla P4' && r.month === '2026-02');
  assert.ok(row, 'Alla P4 feb row missing');
  assert.equal(row.avg_daily_link_clicks, exp);
  assert.equal(row.link_clicks, baseline.E_group_sbs_alla_p4_feb2026.group.sum_link_clicks);
});

test('estimated_unique_clicks_monthly P4 Göteborg feb 2026 == Fixture D', opts, () => {
  const d = baseline.D_estimated_unique_clicks_gbg_feb2026.data[0]; // {value, lower, quality}
  const row = find('estimated_unique_clicks_monthly',
    r => r.account_name === 'P4 Göteborg, Sveriges Radio' && r.month === '2026-02');
  assert.ok(row, 'GBG estimate row missing');
  assert.equal(row.estimate_upper, d.value);   // 24312
  assert.equal(row.estimate_lower, d.lower);   // 16208
  assert.equal(row.quality, d.quality);        // ok
  assert.ok(Math.abs(row.overlap_factor_f - 4.49) < 0.01, `F=${row.overlap_factor_f}`);
});

test('ga_listens_groups_monthly "Alla P4 Lokalt" == Fixture F', opts, () => {
  const exp = baseline.F_ga_listens_group_sbs_feb2026.groups['10'].avg_daily_listens; // 33731.5
  const row = find('ga_listens_groups_monthly', r => r.group_name === 'Alla P4 Lokalt' && r.month === '2026-02');
  assert.ok(row);
  assert.equal(row.avg_daily_listens, exp);
});

test('ga_site_visits_groups_monthly "Alla P4" + "P4 Syd" == Fixture G', opts, () => {
  const g = baseline.G_ga_site_visits_group_sbs_feb2026.groups;
  const alla = find('ga_site_visits_groups_monthly', r => r.group_name === 'Alla P4' && r.month === '2026-02');
  const syd = find('ga_site_visits_groups_monthly', r => r.group_name === 'P4 Syd' && r.month === '2026-02');
  assert.equal(alla.avg_daily_visits, g['8'].avg_daily_visits); // 89114.7
  assert.equal(syd.avg_daily_visits, g['7'].avg_daily_visits);  // 34288.3 (snapshot)
});

test('posts_monthly P4 Göteborg feb 2026 == Fixture A', opts, () => {
  const a = baseline.A_snitt_per_dag_feb2026.accounts['P4 Göteborg, Sveriges Radio'];
  const row = find('posts_monthly',
    r => r.account_name === 'P4 Göteborg, Sveriges Radio' && r.platform === 'facebook' && r.month === '2026-02');
  assert.ok(row);
  assert.equal(row.avg_daily_link_clicks, a.avg_daily_link_clicks); // 3898.5
  assert.equal(row.posts_per_day, a.posts_per_day);                 // 7.89
});

test('normalized_name unifies Meta + GA P4 Göteborg across sources', opts, () => {
  const meta = find('posts_monthly', r => r.account_name === 'P4 Göteborg, Sveriges Radio');
  const ga = find('ga_listens_monthly', r => r.account_name === 'P4 Göteborg');
  assert.equal(meta.normalized_name, 'P4 Göteborg');
  assert.equal(ga.normalized_name, 'P4 Göteborg');
  assert.equal(meta.normalized_name, ga.normalized_name);
});

test('dim_account_key has unique normalized_name on real data', opts, () => {
  const keys = sheet('dim_account_key').map(r => r.normalized_name);
  assert.equal(keys.length, new Set(keys).size, 'duplicate normalized_name keys');
  assert.ok(keys.includes('P4 Göteborg'));
});
