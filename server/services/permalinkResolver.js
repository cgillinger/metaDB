/**
 * permalinkResolver.js — härled konto ur ett inläggs permalänk.
 *
 * Delad sanningskälla för BÅDE engångs-backfill (scripts/backfill) och live-import
 * (csvProcessor). Meta exporterar ibland inlägg utan Sidnamn; id/tid/permalänk/metrics
 * ligger ändå rätt. Permalänken innehåller normalt sidhandtaget
 * (facebook.com/<handle>/..., instagram.com/<handle>/...) → härled kontot ur det.
 *
 * PRINCIP: hellre OATTRIBUERAT än FELATTRIBUERAT. Generiska URL-segment (innehålls-/
 * systemvägar, inte sidhandtag) står på en DENYLIST och ger ingen attribuering — då
 * lämnas account_name tomt (hanteras av export-garden). Gissa aldrig.
 */

// Generiska FB/IG-segment som ALDRIG är ett sidhandtag.
export const SLUG_DENYLIST = new Set([
  'photo.php', 'permalink.php', 'story.php', 'profile.php', 'sharer.php', 'media.php',
  'watch', 'media', 'share', 'shares', 'groups', 'group', 'events', 'event',
  'reel', 'reels', 'stories', 'story', 'p', 'tv', 'live', 'video', 'videos',
  'photo', 'photos', 'posts', 'pages', 'pg', 'pfbid', 'marketplace', 'gaming',
  'notes', 'about', 'explore', 'accounts', 'direct', 'stories.php',
]);

/**
 * Extrahera sidhandtag (lowercased) ur en permalänk, eller null om inget tryggt
 * handtag finns (saknad/okänd värd, eller ett denylistat generiskt segment).
 * @param {string} permalink
 * @returns {string|null}
 */
export function extractSlug(permalink) {
  if (!permalink) return null;
  const m = String(permalink).match(/(?:facebook|instagram)\.com\/([^/?#]+)/i);
  if (!m) return null;
  let seg;
  try { seg = decodeURIComponent(m[1]).trim(); } catch { seg = m[1].trim(); }
  if (!seg) return null;
  if (SLUG_DENYLIST.has(seg.toLowerCase())) return null;
  return seg.toLowerCase();
}

/**
 * Bygg karta sidhandtag → { account_name, account_id } från ALLA namngivna inlägg
 * (vanligaste namnet/id:t per plattform+handtag). Nyckel: "<platform>::<slug>".
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, {account_name: string, account_id: string|null}>}
 */
export function buildSlugToAccount(db) {
  const rows = db.prepare(`
    SELECT account_name, account_id, platform, permalink FROM posts
    WHERE account_name IS NOT NULL AND trim(account_name) <> '' AND permalink IS NOT NULL
  `).all();
  const tally = {};
  for (const r of rows) {
    const slug = extractSlug(r.permalink);
    if (!slug) continue;
    const key = `${r.platform}::${slug}`;
    const t = tally[key] || (tally[key] = { names: {}, ids: {} });
    t.names[r.account_name] = (t.names[r.account_name] || 0) + 1;
    if (r.account_id) t.ids[r.account_id] = (t.ids[r.account_id] || 0) + 1;
  }
  const top = (o) => {
    const e = Object.entries(o).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : null;
  };
  const map = new Map();
  for (const [key, t] of Object.entries(tally)) {
    map.set(key, { account_name: top(t.names), account_id: top(t.ids) });
  }
  return map;
}

/**
 * Resolution-ordning: (1) handtag ur permalänk → (2) DB-karta → (3) override → annars
 * null (lämna tomt). Returnerar { account_name, account_id } eller null.
 * @param {{platform: string, permalink: string}} row
 * @param {Map<string, {account_name: string, account_id: string|null}>} slugMap
 * @param {Object<string, {account_name: string, account_id?: string|null}>} [overrides]
 *        nyckel "<platform>::<slug>" → { account_name, account_id }
 */
export function resolveAccountFromPermalink(row, slugMap, overrides = {}) {
  const slug = extractSlug(row.permalink);
  if (!slug) return null;
  const key = `${row.platform}::${slug}`;
  if (overrides[key]) return overrides[key];
  return slugMap.get(key) || null;
}
