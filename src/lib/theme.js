import { useEffect, useState } from 'react';

// Общая тема кабинета, админки и сервисных страниц: 'system' | 'light' | 'dark'.
// Класс html.cabinet-light ставит текущая оболочка — так светлыми
// становятся и окна, которые рисуются поверх страницы (подтверждения, уведомления).
const KEY = 'portal-cabinet-theme';

export function readThemePref() {
  try { return localStorage.getItem(KEY) || 'dark'; } catch { return 'dark'; }
}

export function useCabinetTheme() {
  const [pref, setPref] = useState(readThemePref);
  const [systemLight, setSystemLight] = useState(() => window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return undefined;
    const on = (e) => setSystemLight(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Все копии хука (шапка, профиль) синхронизируются через событие.
  useEffect(() => {
    const sync = () => setPref(readThemePref());
    window.addEventListener('portal-theme', sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener('portal-theme', sync); window.removeEventListener('storage', sync); };
  }, []);
  const light = pref === 'light' || (pref === 'system' && systemLight);
  const choose = (next) => {
    setPref(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    window.dispatchEvent(new Event('portal-theme'));
  };
  const toggle = () => choose(light ? 'dark' : 'light');
  return { pref, light, choose, toggle };
}

// Применяет тему к документу, пока смонтирован кабинет.
export function useApplyCabinetTheme(light) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('cabinet-graphite');
    root.classList.toggle('cabinet-light', light);
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevColor = meta?.getAttribute('content');
    meta?.setAttribute('content', light ? '#f3f3ef' : '#191b18');
    return () => { root.classList.remove('cabinet-light', 'cabinet-graphite'); if (meta && prevColor) meta.setAttribute('content', prevColor); };
  }, [light]);
}
