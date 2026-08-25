/**
 * roster/missingAccounts.js — account roster that alarms when an account
 * that's normally present is missing from an import (TASK-account-roster.md).
 *
 * Pure function, no DB, same style as trend/spliceViewers.js. The caller
 * (services/accountRoster.js) handles all Jaccard scoping and all DB queries
 * before calling in here — this module just counts.
 */

/**
 * Jaccard similarity between two Sets of account names: |A∩B| / |A∪B|. Empty
 * sets → 0 (no similarity), never NaN — otherwise an empty history entry
 * could match everything.
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {number}
 */
export function jaccardSimilarity(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const name of a) if (b.has(name)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Find accounts that are normally present but missing from this file.
 *
 * @param {Object} params
 * @param {Set<string>|string[]} params.importedNames - account names in the incoming file.
 * @param {Array<{month: string, names: Set<string>}>} params.history - most recent
 *   imports of the same platform, already Jaccard-filtered by the caller.
 * @param {Set<string>|string[]} [params.retired] - account names with status 'retired'.
 *   Never alarm, regardless of threshold or open gap.
 * @param {Set<string>|string[]} [params.openGapAccounts] - account names with an
 *   unresolved row in account_gaps, already Jaccard-scoped by the caller against the same file.
 *   Always included in the result when missing, regardless of threshold.
 * @param {number} [params.window] - how many recent history entries are counted.
 * @param {number} [params.minSeen] - number of occurrences (not a ratio) to reach the threshold.
 * @returns {Array<{account_name: string, seenIn: number, of: number, lastSeen: string|null, reason: 'threshold'|'open-gap'}>}
 */
export function findMissingAccounts({
  importedNames,
  history = [],
  retired = [],
  openGapAccounts = [],
  window = 6,
  minSeen = 4,
} = {}) {
  const imported = importedNames instanceof Set ? importedNames : new Set(importedNames || []);
  const retiredSet = retired instanceof Set ? retired : new Set(retired || []);
  const openGapSet = openGapAccounts instanceof Set ? openGapAccounts : new Set(openGapAccounts || []);

  // Most recent `window` history entries, newest first.
  const windowed = [...(history || [])]
    .sort((a, b) => (b.month || '').localeCompare(a.month || ''))
    .slice(0, window);
  const of = windowed.length;

  // Candidates: everything that occurred in that window, plus every account
  // with an already-open gap (unconditional tracking, see TASK §3) — even if
  // they never show up in the Jaccard-scoped history window.
  const candidates = new Set(openGapSet);
  for (const entry of windowed) {
    for (const name of entry.names || []) candidates.add(name);
  }

  const results = [];
  for (const name of candidates) {
    if (imported.has(name)) continue;  // present in the file — not missing
    if (retiredSet.has(name)) continue; // a retired account never alarms

    let seenIn = 0;
    let lastSeen = null;
    for (const entry of windowed) {
      if (entry.names && entry.names.has(name)) {
        seenIn++;
        if (lastSeen === null || entry.month > lastSeen) lastSeen = entry.month;
      }
    }

    let reason = null;
    if (seenIn >= minSeen) reason = 'threshold';
    else if (openGapSet.has(name)) reason = 'open-gap';
    if (!reason) continue;

    results.push({ account_name: name, seenIn, of, lastSeen, reason });
  }

  results.sort((a, b) => a.account_name.localeCompare(b.account_name, 'sv'));
  return results;
}
