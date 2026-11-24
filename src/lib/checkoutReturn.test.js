import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutBaseline, checkoutReference, checkoutReturnUrls, forgetCheckout, pendingCheckout, saveCheckout, subscriptionChanged } from './checkoutReturn.js';

import { readAfterDeletion } from './readAfterDeletion.js';

test('deletion refresh only repeats a stale read and preserves other subscriptions', async () => {
  const keep = { client_id: 'second' };
  const replies = [[{client_id:'deleted'}, keep], [keep]];
  const read = async () => replies.shift();
  assert.deepEqual(await readAfterDeletion(read, 'deleted', new AbortController().signal, async () => {}), [keep]);
  assert.equal(replies.length, 0);
});

const ref = crypto.randomUUID();
test('return links only carry the receipt and preserve the configured origin and query', () => {
  assert.equal(checkoutReference('../other'), null);
  const initial = new URL('payment/success?a=1', import.meta.url);
  const links = checkoutReturnUrls({ success_url: initial.href }, ref);
  const result = new URL(links.success_url);
  assert.equal(result.pathname, initial.pathname);
  assert.equal(result.origin, initial.origin);
  assert.equal(result.searchParams.get('a'), '1');
  assert.equal(result.searchParams.get('checkout'), ref);
});

test('only changes to the purchased or renewed subscription count as visible', () => {
  const old = { client_id: 'a', expiry_time: 1, tariff_id: 1 };
  const purchase = checkoutBaseline([old]);
  const renewal = checkoutBaseline([old], 'a');
  assert.equal(subscriptionChanged(purchase, [old]), false);
  assert.equal(subscriptionChanged(purchase, [old, {client_id:'b'}]), true);
  assert.equal(subscriptionChanged(renewal, [{...old, client_id:'b', expiry_time:2}]), false);
  assert.equal(subscriptionChanged(renewal, [{...old, tariff_id:2}]), true);
  assert.equal(subscriptionChanged(renewal, [{...old, expiry_time:2}]), true);
});

test('reconciliation is scoped to the signed-in account and receipt', () => {
  const values = new Map();
  globalThis.sessionStorage = {setItem:(k,v)=>values.set(k,v), getItem:k=>values.get(k) ?? null, removeItem:k=>values.delete(k)};
  try {
    saveCheckout(1, ref, {before:[]});
    assert.equal(pendingCheckout(2, null), null);
    forgetCheckout(1, 'different');
    assert.equal(pendingCheckout(1, null).reference, ref);
    forgetCheckout(1, ref);
    assert.equal(pendingCheckout(1, null), null);
    assert.equal(pendingCheckout(2, ref).baseline, null);
  } finally { delete globalThis.sessionStorage; }
});
