import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformFromFields, FB_ONLY_FIELDS, IG_ONLY_FIELDS } from './fieldPlatforms.js';

test('FB-only-fält ger facebook', () => {
  assert.equal(platformFromFields(['account_reach']), 'facebook');
  assert.equal(platformFromFields(['views', 'link_clicks']), 'facebook');
});

test('IG-only-fält ger instagram', () => {
  assert.equal(platformFromFields(['ig_account_reach']), 'instagram');
  assert.equal(platformFromFields(['views', 'saves']), 'instagram');
});

test('blandat urval ger null — kan inte begränsas', () => {
  assert.equal(platformFromFields(['account_reach', 'ig_account_reach']), null);
  assert.equal(platformFromFields(['link_clicks', 'follows']), null);
});

test('plattformsneutralt urval ger null', () => {
  assert.equal(platformFromFields(['views', 'likes', 'comments']), null);
});

test('tomt eller ogiltigt urval ger null', () => {
  assert.equal(platformFromFields([]), null);
  assert.equal(platformFromFields(undefined), null);
  assert.equal(platformFromFields(null), null);
});

test('listorna överlappar inte', () => {
  const overlap = FB_ONLY_FIELDS.filter(f => IG_ONLY_FIELDS.includes(f));
  assert.deepEqual(overlap, []);
});
