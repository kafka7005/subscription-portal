// Платформы для окна загрузки. Ссылки и подписи задаются в админке → Сайт → Загрузка;
// у платформы без ссылки плитка неактивна («Скоро»).
export const PLATFORMS = [
  { key: 'windows', group: 'desktop', label: 'Windows', icon: 'windows', note: 'Windows 10 и 11, x64' },
  { key: 'linux', group: 'desktop', label: 'Linux', icon: 'linux', note: 'deb, rpm, AppImage' },
  { key: 'macos', group: 'desktop', label: 'macOS', icon: 'apple', note: 'Apple Silicon и Intel' },
  { key: 'android', group: 'mobile', label: 'Android', icon: 'android', note: 'Google Play, APK' },
  { key: 'ios', group: 'mobile', label: 'iOS', icon: 'apple', note: 'iPhone и iPad' },
  { key: 'androidtv', group: 'mobile', label: 'Android TV', icon: 'tv', note: 'Телевизоры и приставки' },
];

export const PLATFORM_GROUPS = [
  { key: 'desktop', title: 'Для компьютера' },
  { key: 'mobile', title: 'Для телефона и ТВ' },
];

// Платформа посетителя — её плитку подсвечиваем.
export function detectPlatform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const touchMac = /macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/.test(ua) || touchMac) return 'ios';
  if (/android/.test(ua)) return /tv|aft|bravia|smart-tv/.test(ua) ? 'androidtv' : 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os/.test(ua)) return 'macos';
  if (/linux|x11/.test(ua)) return 'linux';
  return null;
}

// Короткое имя источника для кнопки выбора: GitHub или домен зеркала.
export function sourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return /(^|\.)github(usercontent)?\.com$/.test(host) ? 'GitHub' : host;
  } catch { return 'Ссылка'; }
}

export function safeLink(url) {
  const v = String(url || '').trim();
  return /^https:\/\//i.test(v) ? v : '';
}
