import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from './safeNext.js';

test('keeps local return paths and rejects ambiguous navigation', () => {
  assert.equal(safeNext('/cabinet/buy?devices=2#summary'), '/cabinet/buy?devices=2#summary');
  for (const target of [null, '//other.invalid', '/\\other.invalid', '/.//other.invalid']) {
    assert.equal(safeNext(target), '/cabinet');
  }
});
