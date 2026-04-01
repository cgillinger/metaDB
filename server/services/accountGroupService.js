/**
 * accountGroupService — CRUD operations for account groups.
 * Groups are source-scoped ('ga_listens' | 'posts') collections of account keys.
 * Account keys use the composite format "account_name::platform".
 */
import { getDb } from '../db/connection.js';

/**
 * Get all account groups, optionally filtered by source.
 * @param {string|null} source - 'ga_listens' | 'posts' | null (all)
 * @returns {Array<{id: number, name: string, source: string, created_at: string, members: string[]}>}
 */
export function getAccountGroups(source = null) {
  const db = getDb();

  const groups = source
    ? db.prepare('SELECT * FROM account_groups WHERE source = ? ORDER BY name ASC').all(source)
    : db.prepare('SELECT * FROM account_groups ORDER BY source ASC, name ASC').all();

  const memberStmt = db.prepare(
    'SELECT account_key FROM account_group_members WHERE group_id = ? ORDER BY account_key ASC'
  );

  return groups.map(g => ({
    ...g,
    members: memberStmt.all(g.id).map(r => r.account_key),
  }));
}

/**
 * Get a single account group by ID.
 * @param {number} id
 * @returns {{id, name, source, created_at, members: string[]}|null}
 */
export function getAccountGroup(id) {
  const db = getDb();
  const group = db.prepare('SELECT * FROM account_groups WHERE id = ?').get(id);
  if (!group) return null;

  const members = db.prepare(
    'SELECT account_key FROM account_group_members WHERE group_id = ? ORDER BY account_key ASC'
  ).all(id).map(r => r.account_key);

  return { ...group, members };
}

/**
 * Create a new account group.
 * @param {string} name
 * @param {'ga_listens'|'posts'} source
 * @param {string[]} memberKeys - Array of account_key strings
 * @returns {{id: number, name: string, source: string, members: string[]}}
 */
export function createAccountGroup(name, source, memberKeys) {
  const db = getDb();

  if (!name || !name.trim()) throw new Error('Gruppnamn krävs.');
  if (!['ga_listens', 'posts'].includes(source)) throw new Error('Ogiltig källa.');
  if (!memberKeys || memberKeys.length === 0) throw new Error('Minst en medlem krävs.');

  const result = db.transaction(() => {
    const insert = db.prepare(
      'INSERT INTO account_groups (name, source) VALUES (?, ?)'
    ).run(name.trim(), source);

    const groupId = insert.lastInsertRowid;
    const memberInsert = db.prepare(
      'INSERT INTO account_group_members (group_id, account_key) VALUES (?, ?)'
    );

    for (const key of memberKeys) {
      memberInsert.run(groupId, key);
    }

    return groupId;
  })();

  return getAccountGroup(result);
}

/**
 * Update an existing account group (name and/or members).
 * @param {number} id
 * @param {{name?: string, members?: string[]}} updates
 * @returns {{id, name, source, created_at, members: string[]}|null}
 */
export function updateAccountGroup(id, updates) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM account_groups WHERE id = ?').get(id);
  if (!existing) return null;

  db.transaction(() => {
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (!trimmed) throw new Error('Gruppnamn krävs.');
      db.prepare('UPDATE account_groups SET name = ? WHERE id = ?').run(trimmed, id);
    }

    if (updates.members !== undefined) {
      if (updates.members.length === 0) throw new Error('Minst en medlem krävs.');
      db.prepare('DELETE FROM account_group_members WHERE group_id = ?').run(id);
      const insert = db.prepare(
        'INSERT INTO account_group_members (group_id, account_key) VALUES (?, ?)'
      );
      for (const key of updates.members) {
        insert.run(id, key);
      }
    }
  })();

  return getAccountGroup(id);
}

/**
 * Delete a single account group.
 * @param {number} id
 * @returns {number} Number of deleted rows (0 or 1)
 */
export function deleteAccountGroup(id) {
  const db = getDb();
  // CASCADE handles member deletion
  return db.prepare('DELETE FROM account_groups WHERE id = ?').run(id).changes;
}

/**
 * Delete ALL account groups.
 * @returns {number} Number of deleted groups
 */
export function deleteAllAccountGroups() {
  const db = getDb();
  return db.prepare('DELETE FROM account_groups').run().changes;
}
