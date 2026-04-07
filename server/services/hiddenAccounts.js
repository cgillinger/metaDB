import { getDb } from '../db/connection.js';

export function hide(accountName, platform) {
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO hidden_accounts (account_name, platform) VALUES (?, ?)'
  ).run(accountName, platform);
}

export function unhide(accountName, platform) {
  const db = getDb();
  db.prepare(
    'DELETE FROM hidden_accounts WHERE account_name = ? AND platform = ?'
  ).run(accountName, platform);
}

export function listHidden() {
  const db = getDb();
  return db.prepare(
    'SELECT account_name, platform, hidden_at FROM hidden_accounts ORDER BY hidden_at DESC'
  ).all();
}

export function isHidden(accountName, platform) {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM hidden_accounts WHERE account_name = ? AND platform = ?'
  ).get(accountName, platform);
  return !!row;
}

/**
 * Returns a SQL fragment excluding hidden accounts.
 * For tables with both account_name and platform columns.
 * @param {string} [tableAlias] - Optional table alias prefix (e.g. 'p')
 */
export function hiddenAccountSQL(tableAlias) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `AND (${prefix}account_name, ${prefix}platform) NOT IN (SELECT account_name, platform FROM hidden_accounts)`;
}

/**
 * Filter for posts table (has account_name + platform columns).
 * @param {string} [alias]
 */
export function hiddenPostsFilter(alias) {
  return hiddenAccountSQL(alias);
}

/**
 * Filter for account_reach table (no platform column; always facebook).
 * @param {string} [alias]
 */
export function hiddenReachFilter(alias) {
  const prefix = alias ? `${alias}.` : '';
  return `AND ${prefix}account_name NOT IN (SELECT account_name FROM hidden_accounts WHERE platform = 'facebook')`;
}

/**
 * Filter for ga_listens table (no platform column; always ga_listens).
 * @param {string} [alias]
 */
export function hiddenGAFilter(alias) {
  const prefix = alias ? `${alias}.` : '';
  return `AND ${prefix}account_name NOT IN (SELECT account_name FROM hidden_accounts WHERE platform = 'ga_listens')`;
}
