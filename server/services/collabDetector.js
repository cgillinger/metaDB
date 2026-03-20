import { getDb } from '../db/connection.js';

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

  // Count posts per account_id, grouped by platform
  const accountCounts = db.prepare(`
    SELECT account_id, account_name, platform, COUNT(*) AS post_count
    FROM posts
    GROUP BY account_id, platform
  `).all();

  const totalAccounts = accountCounts.length;

  // Only flag if there's more than one account (collab makes no sense with one account)
  if (totalAccounts <= 1) {
    db.prepare('UPDATE posts SET is_collab = 0').run();
    return { flagged: 0, cleared: totalAccounts };
  }

  const collabAccountIds = new Set();
  const safeAccountIds = new Set();

  for (const row of accountCounts) {
    if (row.post_count <= 2 && !isSafeAccount(row.account_name)) {
      collabAccountIds.add(row.account_id);
    } else {
      safeAccountIds.add(row.account_id);
    }
  }

  // Update in a transaction
  db.transaction(() => {
    // Clear all collab flags first
    db.prepare('UPDATE posts SET is_collab = 0').run();

    // Set collab flags for detected accounts
    if (collabAccountIds.size > 0) {
      const placeholders = [...collabAccountIds].map(() => '?').join(',');
      db.prepare(
        `UPDATE posts SET is_collab = 1 WHERE account_id IN (${placeholders})`
      ).run(...collabAccountIds);
    }
  })();

  return {
    flagged: collabAccountIds.size,
    cleared: safeAccountIds.size
  };
}
