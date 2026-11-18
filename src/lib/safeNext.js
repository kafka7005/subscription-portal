export function safeNext(value) {
  const base = 'https://portal.invalid';
  if (typeof value !== 'string' || !value.startsWith('/')) return '/cabinet';
  try {
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith('//')) return '/cabinet';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/cabinet';
  }
}
