import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePrice, deviceOptions, deviceText, validateDemoPromo } from './pricing.js';

test('all 40 configurations match the captured source calculator', async () => {
  const fixture = JSON.parse(await readFile(new URL('./__fixtures__/source-prices.json', import.meta.url), 'utf8'));
  for (const [id, amounts] of Object.entries(fixture)) {
    for (const [devices, expected] of Object.entries(amounts)) {
      assert.deepEqual(calculatePrice(id, Number(devices)), { base: expected, total: expected });
    }
  }
});
test('demo discount keeps kopecks and never compounds', () => {
  assert.deepEqual(calculatePrice('100', 1, 10), { base: 149, total: 134.1 });
  assert.deepEqual(calculatePrice('103', 10, 10), { base: 9299, total: 8369.1 });
  assert.equal(calculatePrice('103', 10, 0).total, 9299);
});
test('invalid plan selections cannot produce a misleading total', () => {
  for (const value of [0, 11, 1.5, NaN]) assert.throws(() => calculatePrice('100', value), RangeError);
  assert.throws(() => calculatePrice('missing', 1), RangeError);
});
test('pagination exposes the selected device and both reachable ends', () => {
  assert.deepEqual(deviceOptions(1), [1, 2, 3, 4, 5]);
  assert.deepEqual(deviceOptions(10), [6, 7, 8, 9, 10]);
  for (let count = 1; count <= 10; count++) {
    const options = deviceOptions(count);
    assert.ok(options.includes(count));
    assert.equal(new Set(options).size, 5);
    assert.ok(options.every((n) => n >= 1 && n <= 10));
  }
});
test('promo preview handles empty, unknown and normalized demo codes', () => {
  assert.equal(validateDemoPromo('  ').status, 'empty');
  assert.deepEqual(validateDemoPromo('  portal10 '), { status: 'applied', discount: 10 });
  assert.deepEqual(validateDemoPromo('NOT-A-CODE'), { status: 'invalid', discount: 0 });
});
test('device counts are readable in both languages', () => {
  assert.equal(deviceText(1, 'ru'), '1 устройство');
  assert.equal(deviceText(3, 'ru'), '3 устройства');
  assert.equal(deviceText(10, 'ru'), '10 устройств');
  assert.equal(deviceText(1, 'en'), '1 device');
  assert.equal(deviceText(10, 'en'), '10 devices');
});
