import { getDb } from '../db/connection.js';
import { hiddenPostsFilter } from './hiddenAccounts.js';

// Partial terms — any account whose name contains these is never flagged.
const COLLAB_SAFE_TERMS = ['Sveriges Radio', 'P1', 'P2', 'P3', 'P4'];

// Known SR accounts (exact match, lowercased) that don't match the partial terms above.
const KNOWN_ACCOUNTS = new Set([
  'radiosporten',
  'nyheter från ekot',
  'berwaldhallen',
  'radiokorrespondenterna',
  'radiokorrespondenterna kina',
  'det politiska spelet',
  'europapodden',
  'mats nileskär',
  'radio sweden farsi_dari',
  'راديو السويد',
]);

/**
 * Check if an account name is a known safe account (not collab).
 */
function isSafeAccount(accountName) {
  if (!accountName) return false;
  const lower = accountName.toLowerCase();
  if (KNOWN_ACCOUNTS.has(lower)) return true;
  return COLLAB_SAFE_TERMS.some(term => lower.includes(term.toLowerCase()));
}

/**
 * Re-run collab detection across ALL posts in the database.
 * An account with ≤2 posts (and not a known SR account) is flagged as collab.
 */
export function redetectAllCollabs() {
  const db = getDb();

  // Count posts per account, grouped by platform — exclude hidden accounts.
  // Rows without account_id group by account_name instead: pooling all NULL ids
  // into one group both inflated their post count past the ≤2 threshold and
  // made them unflaggable (IN (...) never matches NULL).
  const accountCounts = db.prepare(`
    SELECT account_id, account_name, platform, COUNT(*) AS post_count
    FROM posts
    WHERE ${hiddenPostsFilter().slice(4)}
    GROUP BY COALESCE(account_id, 'noid:' || COALESCE(account_name, '')), platform
  `).all();

  const totalAccounts = accountCounts.length;

  // Only flag if there's more than one account (collab makes no sense with one account)
  if (totalAccounts <= 1) {
    db.prepare('UPDATE posts SET is_collab = 0').run();
    return { flagged: 0, cleared: totalAccounts };
  }

  const collabTargets = [];
  let cleared = 0;

  for (const row of accountCounts) {
    if (row.post_count <= 2 && !isSafeAccount(row.account_name)) {
      // Rows with neither id nor name can't be addressed — skip, never flag
      if (row.account_id != null || (row.account_name && row.account_name !== '')) {
        collabTargets.push(row);
      }
    } else {
      cleared++;
    }
  }

  // Update in a transaction
  db.transaction(() => {
    // Clear collab flags — leave hidden accounts unchanged
    db.prepare(
      `UPDATE posts SET is_collab = 0 WHERE ${hiddenPostsFilter().slice(4)}`
    ).run();

    // Set collab flags per detected account, scoped by platform so an id/name
    // reused across platforms never leaks the flag. The hidden-account filter
    // mirrors the clear step above: hidden posts are never touched, so they can
    // neither be flagged nor cleared here (avoids leaving a stale is_collab=1 on
    // a hidden post that the clear step deliberately skips).
    const byId = db.prepare(
      `UPDATE posts SET is_collab = 1 WHERE account_id = ? AND platform = ? ${hiddenPostsFilter()}`
    );
    const byName = db.prepare(
      `UPDATE posts SET is_collab = 1 WHERE account_id IS NULL AND account_name = ? AND platform = ? ${hiddenPostsFilter()}`
    );
    for (const t of collabTargets) {
      if (t.account_id != null) byId.run(t.account_id, t.platform);
      else byName.run(t.account_name, t.platform);
    }
  })();

  return {
    flagged: collabTargets.length,
    cleared
  };
}
