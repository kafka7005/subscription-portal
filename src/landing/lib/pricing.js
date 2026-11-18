// Original calculator snapshot: evidence/source-prices.json, 2026-11-02.
// Final Figma calls the last period 360 days; the captured legacy API used 365.
// Design preview only: no billing API or live promotion validation.
export const plans = [
  { id: '100', days: 30, prices: [149, 249, 349, 449, 549, 649, 749, 849, 949, 1049] },
  { id: '101', days: 90, prices: [379, 629, 879, 1129, 1379, 1629, 1879, 2129, 2379, 2629] },
  { id: '102', days: 180, prices: [629, 1129, 1629, 2129, 2629, 3129, 3629, 4129, 4629, 5129] },
  { id: '103', days: 360, prices: [1199, 2099, 2999, 3899, 4799, 5699, 6599, 7499, 8399, 9299] },
];
export function calculatePrice(planId, devices, discount = 0) {
  const plan = plans.find((item) => item.id === planId);
  if (!plan || !Number.isInteger(devices) || devices < 1 || devices > 10) throw new RangeError('Invalid plan selection');
  const base = plan.prices[devices - 1];
  return { base, total: Math.round(base * (100 - Math.min(100, Math.max(0, discount)))) / 100 };
}
export function deviceOptions(selected) {
  const start = Math.max(1, Math.min(6, selected - 2));
  return Array.from({ length: 5 }, (_, index) => start + index);
}
export function deviceText(count, locale) {
  if (locale === 'en') return `${count} ${count === 1 ? 'device' : 'devices'}`;
  const mod100 = count % 100;
  const word = mod100 >= 11 && mod100 <= 14 ? 'устройств' : count % 10 === 1 ? 'устройство' : count % 10 >= 2 && count % 10 <= 4 ? 'устройства' : 'устройств';
  return `${count} ${word}`;
}
export function money(value, locale = 'ru') {
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 2 }).format(value) + ' ₽';
}
export function validateDemoPromo(code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return { status: 'empty', discount: 0 };
  return normalized === 'PORTAL10' ? { status: 'applied', discount: 10 } : { status: 'invalid', discount: 0 };
}
