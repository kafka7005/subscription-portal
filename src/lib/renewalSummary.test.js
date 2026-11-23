import test from 'node:test';
import assert from 'node:assert/strict';
import { renewalSummary } from './renewalSummary.js';

const day = 86400000;
const now = 30 * day;
const expiry = 40 * day;
const sw = {is_switch:true, credit_value_rub:100};

test('values the remainder in days without reducing the displayed price', () => {
  const r = renewalSummary({...sw, credit_days:10}, '30', expiry, now);
  assert.equal(r.end, now + 40 * day);
  assert.match(r.note, /40 дней/);
  assert.doesNotMatch(r.note, /₽|баланс/);
});
test('reflects monetary fallback, refunds, and preserved expiry as quoted', () => {
  const r = renewalSummary({...sw, credit_to_balance_rub:5}, 30, expiry, now);
  assert.match(r.note,/5 ₽/);
  assert.equal(r.end, now + 30 * day);
  const kept = renewalSummary({...sw, keeps_period:true, credit_to_balance_rub:700, refund_to_balance_rub:90},30,expiry,now);
  assert.equal(kept.end,expiry);
  assert.match(kept.note,/90 ₽/);
});
test('ordinary renewal starts at the later of expiry and now', () => {
  assert.equal(renewalSummary({},30,expiry,now).end, expiry + 30*day);
  assert.equal(renewalSummary({},30,now-day,now).end, now + 30*day);
  assert.equal(renewalSummary(null,30,expiry,now),null);
});
