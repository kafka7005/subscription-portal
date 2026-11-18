import test from 'node:test';
import assert from 'node:assert/strict';
import { recurringTerms, availableProviders, canCheckout, autopayConsent } from './paymentPolicy.js';

test('enabled autopay requires a valid provider-specific preview; one-off flows exclude recurring', () => {
  const ids = ['YOOKASSA_AUTOPAY', 'YOOKASSA_SBP', 'KASSAI_AUTOPAY', 'UNKNOWN_AUTOPAY'];
  assert.deepEqual(availableProviders(ids), ['YOOKASSA_SBP']);
  assert.deepEqual(availableProviders(ids, { autopay_price_rub: 629, autopay_period_days: 180 }), ['YOOKASSA_AUTOPAY', 'YOOKASSA_SBP']);
  assert.deepEqual(availableProviders(['YOOKASSA_SBP'], { autopay_price_rub: 629, autopay_period_days: 180 }), ['YOOKASSA_SBP']);
  assert.deepEqual(recurringTerms('KASSAI_AUTOPAY', { kassai_autopay_price_rub: 100, kassai_autopay_period_days: 30 }), { amount: 100, period: 30 });
  for (const period of [0, -1, 1.5, Infinity]) assert.equal(recurringTerms('YOOKASSA_AUTOPAY', { autopay_price_rub: 100, autopay_period_days: period }), null);
});

test('one-off checkout needs a ready quote; recurring checkout also needs explicit consent', () => {
  const oneOff = { ready: true };
  assert.equal(canCheckout({ ...oneOff, ready: false }, false), false);
  assert.equal(canCheckout(oneOff, false), true);
  const recurring = { ready: true, recurring: { amount: 100, period: 30 }, renewal: { amount: 100, gross: 105, period: 30 } };
  assert.equal(canCheckout(recurring, false), false);
  assert.equal(canCheckout({ ...recurring, ready: false }, true), false);
  assert.equal(canCheckout({ ...recurring, renewal: null }, true), false);
  assert.equal(canCheckout(recurring, true), true);
  assert.deepEqual(autopayConsent(recurring, false), { autopay_consent: false });
  assert.deepEqual(autopayConsent(oneOff, true), { autopay_consent: false });
  assert.deepEqual(autopayConsent(recurring, true), { autopay_consent: true, autopay_accepted_amount: 100, autopay_accepted_gross_amount: 105, autopay_accepted_period_days: 30 });
});
