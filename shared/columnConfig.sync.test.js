/**
 * Guards against drift between the canonical shared/columnConfig.js and the
 * client entry src/utils/columnConfig.js: the client module must be a pure
 * re-export, i.e. expose the exact same references (not copies).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as shared from './columnConfig.js';
import * as client from '../src/utils/columnConfig.js';

test('src/utils/columnConfig re-exports the same references as shared/columnConfig', () => {
  // Key functions must be the same function objects
  for (const name of [
    'getValue',
    'detectPlatform',
    'isTikTokOverviewCSV',
    'getMappingsForPlatform',
    'getTikTokOverviewMappings',
    'parseTikTokVideoUrl',
    'normalizeText'
  ]) {
    assert.strictEqual(client[name], shared[name], `${name} must be the same reference`);
  }

  // Key data objects must be the same object references
  for (const name of ['DISPLAY_NAMES', 'FB_COLUMN_MAPPINGS', 'IG_COLUMN_MAPPINGS']) {
    assert.strictEqual(client[name], shared[name], `${name} must be the same reference`);
  }
});

test('client module exposes every export from shared (no missing re-exports)', () => {
  const sharedExports = Object.keys(shared).sort();
  const clientExports = Object.keys(client).sort();
  const missing = sharedExports.filter(name => !clientExports.includes(name));
  assert.deepEqual(missing, [], 'client must re-export all shared exports');
});
