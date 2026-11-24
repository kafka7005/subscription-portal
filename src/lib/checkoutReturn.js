const DAY = 86_400_000;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function checkoutReference(value) {
  return typeof value === 'string' && uuid.test(value) ? value : null;
}

export function checkoutReturnUrls(urls, reference) {
  return Object.fromEntries(Object.entries(urls).map(([name, raw]) => {
    const url = new URL(raw);
    url.searchParams.set('checkout', reference);
    return [name, url.href];
  }));
}

export function checkoutBaseline(keys, renewId) {
  if (!Array.isArray(keys)) return null;
  if (!renewId) return { before: keys.map(key => key.client_id) };
  const target = keys.find(key => key.client_id === renewId);
  return target ? { target: renewId, expiry: target.expiry_time, tariff: target.tariff_id } : null;
}

export function subscriptionChanged(baseline, keys) {
  if (!baseline || !Array.isArray(keys)) return false;
  if (Array.isArray(baseline.before)) return keys.some(key => !baseline.before.includes(key.client_id));
  const target = keys.find(key => key.client_id === baseline.target);
  return Boolean(target && (target.expiry_time !== baseline.expiry || target.tariff_id !== baseline.tariff));
}

export function saveCheckout(owner, reference, baseline) {
  if (!owner || !checkoutReference(reference)) return;
  try {
    sessionStorage.setItem('subscription-return:' + owner, JSON.stringify({ reference, baseline, time: Date.now() }));
  } catch { /* The provider return URL also carries the receipt reference. */ }
}

export function pendingCheckout(owner, fromUrl) {
  if (!owner) return null;
  const reference = checkoutReference(fromUrl);
  try {
    const saved = JSON.parse(sessionStorage.getItem('subscription-return:' + owner));
    if (saved && checkoutReference(saved.reference) && Date.now() - saved.time < DAY &&
        (!reference || reference === saved.reference)) return saved;
  } catch { /* Storage is optional. The API verifies the receipt owner. */ }
  return reference ? { reference, baseline: null } : null;
}

export function forgetCheckout(owner, reference) {
  try {
    const key = 'subscription-return:' + owner;
    if (JSON.parse(sessionStorage.getItem(key))?.reference === reference) sessionStorage.removeItem(key);
  } catch { /* Storage is optional. */ }
}
