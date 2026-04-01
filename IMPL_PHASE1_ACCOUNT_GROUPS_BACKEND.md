# Implementation Directive — Account Groups: Phase 1 (Backend)

**Version bump:** 2.3.0 (minor — new feature)
**Model:** Sonnet
**Commit message:** `feat(account-groups): add DB schema and CRUD API for account groups (v2.3.0)`

---

## Repo Access

You have full access to the Git repository. **Always read the actual source files before making changes** — do not rely solely on the code samples in this directive. The samples illustrate intent and patterns, but the repo is the source of truth.

Key files to read first:
- `server/db/connection.js` — understand the migration system
- `server/db/migrations/` — see existing migration naming convention
- `server/services/gaListensImporter.js` — reference for service pattern
- `server/routes/gaListens.js` — reference for route pattern and Express conventions
- `src/utils/apiClient.js` — understand existing API client pattern
- `server/index.js` (or wherever routes are mounted) — find where to register the new route

---

## Overview

Add persistent account groups — user-defined named collections of accounts that can be treated as a single aggregated entity. This phase covers the database migration, service layer, and REST API. No frontend changes.

---

## 1. Database Migration

Create `server/db/migrations/003_account_groups.sql`:

```sql
-- Migration 003: Account Groups
-- User-defined named groups of accounts for aggregated viewing.
-- Groups are source-scoped: a group contains only accounts from one source type.

CREATE TABLE IF NOT EXISTS account_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('ga_listens', 'posts')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(name, source)
);

CREATE TABLE IF NOT EXISTS account_group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,  -- For posts: "account_name::platform", for GA: "account_name::ga_listens"
  UNIQUE(group_id, account_key)
);

CREATE INDEX IF NOT EXISTS idx_agm_group ON account_group_members(group_id);
```

The migration system in `server/db/connection.js` will pick this up automatically (file prefix `003`).

---

## 2. Service Layer

Create `server/services/accountGroupService.js`:

```js
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
```

---

## 3. REST API Routes

Create `server/routes/accountGroups.js`:

```js
/**
 * Account Groups API
 * CRUD endpoints for managing named account groups.
 */
import { Router } from 'express';
import {
  getAccountGroups,
  getAccountGroup,
  createAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
  deleteAllAccountGroups,
} from '../services/accountGroupService.js';

const router = Router();

// GET /api/account-groups?source=ga_listens
router.get('/', (req, res) => {
  const source = req.query.source || null;
  const groups = getAccountGroups(source);
  res.json({ groups });
});

// GET /api/account-groups/:id
router.get('/:id', (req, res) => {
  const group = getAccountGroup(Number(req.params.id));
  if (!group) return res.status(404).json({ error: 'Gruppen hittades inte.' });
  res.json(group);
});

// POST /api/account-groups  { name, source, members: string[] }
router.post('/', (req, res) => {
  try {
    const { name, source, members } = req.body;
    const group = createAccountGroup(name, source, members);
    res.status(201).json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/account-groups/:id  { name?, members?: string[] }
router.put('/:id', (req, res) => {
  try {
    const group = updateAccountGroup(Number(req.params.id), req.body);
    if (!group) return res.status(404).json({ error: 'Gruppen hittades inte.' });
    res.json(group);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/account-groups/all — delete ALL groups (must come before /:id)
router.delete('/all', (req, res) => {
  const deleted = deleteAllAccountGroups();
  res.json({ deleted });
});

// DELETE /api/account-groups/:id
router.delete('/:id', (req, res) => {
  const deleted = deleteAccountGroup(Number(req.params.id));
  if (deleted === 0) return res.status(404).json({ error: 'Gruppen hittades inte.' });
  res.json({ deleted });
});

export default router;
```

---

## 4. Register Routes

Find the main server file where routes are mounted (read the repo — likely `server/index.js` or similar). Look for existing `app.use('/api/...')` calls and add:

```js
import accountGroupRoutes from './routes/accountGroups.js';
// ...
app.use('/api/account-groups', accountGroupRoutes);
```

**CRITICAL:** The `/all` DELETE route is registered before `/:id` in the router file itself, so no ordering issue at the app level. (This is the same pattern used for the GA listens batch delete — read `server/routes/gaListens.js` to see the precedent.)

---

## 5. API Client Methods

Read `src/utils/apiClient.js` and match the existing pattern (look at how `getGAListensSummary`, `deleteGaListensMonth`, etc. are structured). Add these methods to the same object:

```js
/**
 * Fetch all account groups, optionally filtered by source.
 * @param {'ga_listens'|'posts'|null} source
 * @returns {Promise<{groups: Array}>}
 */
getAccountGroups: (source = null) => {
  const params = source ? `?source=${source}` : '';
  return fetch(`/api/account-groups${params}`).then(handleResponse);
},

/**
 * Create a new account group.
 * @param {string} name
 * @param {'ga_listens'|'posts'} source
 * @param {string[]} members - Array of account_key strings
 * @returns {Promise<{id, name, source, members}>}
 */
createAccountGroup: (name, source, members) => {
  return fetch('/api/account-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, source, members }),
  }).then(handleResponse);
},

/**
 * Update an account group.
 * @param {number} id
 * @param {{name?: string, members?: string[]}} updates
 * @returns {Promise<{id, name, source, members}>}
 */
updateAccountGroup: (id, updates) => {
  return fetch(`/api/account-groups/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).then(handleResponse);
},

/**
 * Delete a single account group.
 * @param {number} id
 */
deleteAccountGroup: (id) => {
  return fetch(`/api/account-groups/${id}`, { method: 'DELETE' }).then(handleResponse);
},

/**
 * Delete ALL account groups.
 */
deleteAllAccountGroups: () => {
  return fetch('/api/account-groups/all', { method: 'DELETE' }).then(handleResponse);
},
```

---

## 6. Verification Plan

1. Start the app — migration 003 should apply automatically (check console log)
2. Test via curl or browser devtools:
   ```bash
   # Create
   curl -X POST http://localhost:3000/api/account-groups \
     -H 'Content-Type: application/json' \
     -d '{"name":"Alla P4","source":"ga_listens","members":["P4 Dalarna::ga_listens","P4 Norrbotten::ga_listens"]}'

   # List
   curl http://localhost:3000/api/account-groups?source=ga_listens

   # Update
   curl -X PUT http://localhost:3000/api/account-groups/1 \
     -H 'Content-Type: application/json' \
     -d '{"name":"Alla P4 stationer"}'

   # Delete one
   curl -X DELETE http://localhost:3000/api/account-groups/1

   # Delete all
   curl -X DELETE http://localhost:3000/api/account-groups/all
   ```
3. Verify foreign key CASCADE: delete a group → members should be gone
4. Verify UNIQUE constraint: creating duplicate name+source should fail with 400

---

## Files Changed (summary)

| File | Action |
|---|---|
| `server/db/migrations/003_account_groups.sql` | **CREATE** |
| `server/services/accountGroupService.js` | **CREATE** |
| `server/routes/accountGroups.js` | **CREATE** |
| `server/index.js` (or main server) | **EDIT** — register route |
| `src/utils/apiClient.js` | **EDIT** — add 5 methods |
| `src/utils/version.js` + `package.json` | **EDIT** — bump to 2.3.0 |
