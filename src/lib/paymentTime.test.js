import test from 'node:test';
import assert from 'node:assert/strict';
import { dateTime, paymentHistoryRows, paymentDateTime, paymentTimeMs, refundDateTime } from './format.js';

test('payment and refund wall times use their respective source zones', () => {
  assert.equal(paymentDateTime('2026-04-02T20:17:12.456789'), '02.04.2026, 20:17 МСК');
  assert.equal(refundDateTime('2026-04-02T21:17:00'), '03.04.2026, 00:17 МСК');
  assert.equal(paymentTimeMs('2026-04-02T20:17:00'), Date.UTC(2026, 3, 2, 17, 17));
});

test('explicit offsets and epoch values identify the same instant across midnight', () => {
  const utc = Date.UTC(2026, 3, 2, 17, 17);
  for (const value of ['2026-04-03T00:17:00+07:00', '2026-04-02T17:17:00Z', utc, utc / 1000, new Date(utc)]) {
    assert.equal(paymentDateTime(value), '02.04.2026, 20:17 МСК');
    assert.equal(refundDateTime(value), '02.04.2026, 20:17 МСК');
  }
});

test('account history orders mixed sources and renders each instant in device time', () => {
  const instant = new Date(Date.UTC(2026, 3, 2, 21, 15));
  const naive = date => date.toISOString().slice(0, -1);
  const moscow = new Date(instant.getTime() + 3 * 3600_000);
  const gift = new Date(instant.getTime() + 60_000);
  const items = [
    { provider: 'bank', created_at: naive(moscow) },
    { provider: 'unknown', created_at: null },
    { provider: 'spend', created_at: naive(instant) },
    { provider: 'gift', created_at: naive(gift) },
    { provider: 'card', created_at: instant.toISOString() },
  ];
  const rows = paymentHistoryRows(items);
  assert.deepEqual(rows.map(row => row.provider), ['gift', 'bank', 'spend', 'card', 'unknown']);
  assert.deepEqual(rows.map(row => row.createdAt), [gift, instant, instant, instant, null]);
  assert.equal(dateTime(rows[1].createdAt), dateTime(instant));
});

test('missing or invalid payment dates have a neutral placeholder', () => {
  for (const value of [null, undefined, '', 'invalid']) {
    assert.equal(paymentDateTime(value), '—');
    assert.equal(refundDateTime(value), '—');
  }
});
