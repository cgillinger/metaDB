#!/usr/bin/env node
/**
 * importCrowdtangle.js — two-step import of historic CrowdTangle monthly totals.
 *
 *   node server/scripts/importCrowdtangle.js --archive <dir> --out <file.ndjson>
 *     Walks the archive, parses leaderboard CSVs, picks one export per
 *     account+platform+month and writes NDJSON. Runs on the workstation.
 *
 *   node server/scripts/importCrowdtangle.js --load <file.ndjson> --db <path> [--dry-run]
 *     Upserts the NDJSON into ct_monthly in one transaction (migration 015 must
 *     already have run, i.e. the app must have started once on that DB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { parseFilename, parseLeaderboard, selectRows } from '../services/crowdtangle/parser.js';
import { loadRows } from '../services/crowdtangle/loader.js';

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '$RECYCLE.BIN') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function parseArchive(archive) {
  const skipped = {};
  const skip = (r) => { skipped[r] = (skipped[r] || 0) + 1; };
  const candidates = [];
  let filesUsed = 0;
  for (const file of walk(archive)) {
    const base = path.basename(file);
    if (!/leaderboard/i.test(base)) continue;
    if (!/\.csv$/i.test(base.replace(/ \(\d+\)(?=\.csv$)/i, ''))) { skip('not_csv'); continue; }
    const meta = parseFilename(base);
    if (!meta.ok) { skip(meta.reason); continue; }
    let text;
    try { text = fs.readFileSync(file, 'utf-8'); } catch { skip('unreadable'); continue; }
    const rows = parseLeaderboard(text, meta.platform);
    if (!rows.length) { skip('no_rows'); continue; }
    let exportedAt = meta.exportedAt, source = meta.exportDateSource;
    if (!exportedAt) { exportedAt = fs.statSync(file).mtime.toISOString(); source = 'mtime'; }
    filesUsed++;
    for (const r of rows) {
      candidates.push({ ...r, month: meta.month, source_list: meta.list, source_filename: base,
        exported_at: exportedAt, export_date_source: source });
    }
  }
  return { selected: selectRows(candidates), candidates: candidates.length, filesUsed, skipped };
}

function monthsBetween(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [ey, em] = b.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

function printCoverage({ selected, candidates, filesUsed, skipped }) {
  console.log(`Filer använda: ${filesUsed}; kandidatrader: ${candidates}; valda rader: ${selected.length}`);
  console.log('Filer hoppade över:', JSON.stringify(skipped));
  for (const p of ['facebook', 'instagram', 'twitter']) {
    const rows = selected.filter(r => r.platform === p);
    if (!rows.length) { console.log(`${p}: inga rader`); continue; }
    const months = [...new Set(rows.map(r => r.month))].sort();
    const missing = monthsBetween(months[0], months[months.length - 1]).filter(m => !months.includes(m));
    const byYear = {};
    for (const r of rows) byYear[r.month.slice(0, 4)] = (byYear[r.month.slice(0, 4)] || 0) + 1;
    const srcs = {};
    for (const r of rows) srcs[r.export_date_source] = (srcs[r.export_date_source] || 0) + 1;
    console.log(`${p}: ${rows.length} rader, ${new Set(rows.map(r => r.account_key)).size} konton, ${months[0]} → ${months[months.length - 1]}`);
    console.log(`  rader per år: ${JSON.stringify(byYear)}`);
    console.log(`  månader som saknas: ${missing.join(', ') || '-'}`);
    console.log(`  exportdatum-källa: ${JSON.stringify(srcs)}`);
  }
}

function main() {
  const { values: a } = parseArgs({ options: {
    archive: { type: 'string' }, out: { type: 'string' }, load: { type: 'string' },
    db: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  } });

  if (a.archive && a.out) {
    const result = parseArchive(a.archive);
    fs.writeFileSync(a.out, result.selected.map(r => JSON.stringify(r)).join('\n') + '\n');
    printCoverage(result);
    console.log(`Skrev ${result.selected.length} rader till ${a.out}`);
  } else if (a.load && a.db) {
    const rows = fs.readFileSync(a.load, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const db = new Database(a.db);
    db.pragma('busy_timeout = 5000');
    try {
      const res = loadRows(db, rows, { dryRun: a['dry-run'] });
      const total = db.prepare('SELECT COUNT(*) AS n FROM ct_monthly').get().n;
      console.log(`${a['dry-run'] ? '[dry-run, inget sparat] ' : ''}Nya: ${res.inserted}, uppdaterade: ${res.updated}, rader i filen: ${rows.length}, ct_monthly totalt nu: ${total}`);
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    } finally { db.close(); }
  } else {
    console.error('Användning: --archive <dir> --out <fil.ndjson>  |  --load <fil.ndjson> --db <sökväg> [--dry-run]');
    process.exitCode = 2;
  }
}

main();
