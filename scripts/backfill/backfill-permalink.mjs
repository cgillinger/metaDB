/**
 * Engångs-backfill: attribuera namnlösa inlägg (tomt account_name) via permalänkens
 * sidhandtag. Använder den DELADE resolvern (server/services/permalinkResolver.js) —
 * samma logik som live-importen.
 *
 *   node scripts/backfill/backfill-permalink.mjs <db-path>     # skarp körning (.backup först)
 *   DRY=1 node scripts/backfill/backfill-permalink.mjs <db>    # torrkörning (räknar, skriver inget)
 *
 * Skarp körning: tar .backup, kör konflikt-skyddsnät (avbryter om någon behövd slug
 * löser till >1 konto), uppdaterar ENDAST rader med tomt account_name (idempotent),
 * sätter account_name + account_id (COALESCE — skriver aldrig över befintligt id),
 * rör inga andra rader. Rapport + Blekinge-spot-check (nov-2025 FB).
 */
import Database from 'better-sqlite3';
import { extractSlug, buildSlugToAccount, resolveAccountFromPermalink }
  from '../../server/services/permalinkResolver.js';

const DB_PATH = process.argv[2] || process.env.BACKFILL_DB;
const DRY = process.env.DRY === '1';
if (!DB_PATH) { console.error('Usage: node backfill-permalink.mjs <db-path>  (DRY=1 for dry-run)'); process.exit(2); }

const EMPTY = "(account_name IS NULL OR trim(account_name) = '')";
const blekSql = `SELECT COUNT(*) c, COALESCE(SUM(views),0) v FROM posts
  WHERE account_name='P4 Blekinge Sveriges Radio' AND platform='facebook'
  AND strftime('%Y-%m',publish_time)='2025-11'`;

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 10000');

// 1) .backup (skarp körning)
if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${DB_PATH}.bak-permalink-${stamp}`;
  await db.backup(bak);
  console.log('BACKUP written:', bak);
}

// 2) build slug map + conflict safety-net over NEEDED slugs
const slugMap = buildSlugToAccount(db);
const namelessRows = db.prepare(`SELECT id, platform, permalink FROM posts WHERE ${EMPTY}`).all();
const named = db.prepare(`SELECT account_name, platform, permalink FROM posts
  WHERE account_name IS NOT NULL AND trim(account_name)<>'' AND permalink IS NOT NULL`).all();
const distinctPerSlug = {};
for (const r of named) {
  const s = extractSlug(r.permalink); if (!s) continue;
  const k = `${r.platform}::${s}`;
  (distinctPerSlug[k] = distinctPerSlug[k] || new Set()).add(r.account_name);
}
const needed = new Set();
for (const r of namelessRows) { const s = extractSlug(r.permalink); if (s) needed.add(`${r.platform}::${s}`); }
const conflicts = [...needed].filter(k => (distinctPerSlug[k]?.size || 0) > 1);
if (conflicts.length) {
  console.error('ABORT — conflicting slugs (>1 account):', JSON.stringify(conflicts));
  process.exit(3);
}
console.log(`needed slugs: ${needed.size} | conflicts: 0 | slug-map entries: ${slugMap.size}`);

// 3) spot-check before
const blekBefore = db.prepare(blekSql).get();

// 4) idempotent update — only empty account_name; never overwrites a present account_id
const upd = db.prepare(`UPDATE posts SET account_name=?, account_id=COALESCE(account_id, ?)
  WHERE id=? AND ${EMPTY}`);
let attributed = 0;
const byAccount = {};
const apply = db.transaction((rows) => {
  for (const r of rows) {
    const res = resolveAccountFromPermalink(r, slugMap);
    if (!res || !res.account_name) continue;
    if (!DRY) upd.run(res.account_name, res.account_id ?? null, r.id);
    attributed++;
    byAccount[res.account_name] = (byAccount[res.account_name] || 0) + 1;
  }
});
apply(namelessRows);

// 5) report
const remaining = db.prepare(`SELECT COUNT(*) c FROM posts WHERE ${EMPTY}`).get().c;
const blekAfter = db.prepare(blekSql).get();
console.log(`\n${DRY ? '[DRY] ' : ''}attributed: ${attributed} | remaining empty: ${DRY ? namelessRows.length - attributed : remaining} / ${namelessRows.length}`);
console.log('by account:', JSON.stringify(Object.entries(byAccount).sort((a, b) => b[1] - a[1]), null, 0));
console.log(`P4 Blekinge nov-2025 FB — before: count=${blekBefore.c} views=${blekBefore.v} | after: count=${blekAfter.c} views=${blekAfter.v}`);
db.close();
