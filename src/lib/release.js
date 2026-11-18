import { useEffect, useState } from 'react';

// Данные о последней версии приложения для Windows и проверка, открывается ли GitHub.

// /download/latest.json — тот же манифест, по которому обновляется само приложение
// (лежит на нашем сервере, рядом с установщиком-зеркалом).
const MANIFEST = '/download/latest.json';

let manifestPromise = null;
function loadManifest() {
  manifestPromise ||= fetch(MANIFEST, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((m) => (m && /^\d+\.\d+\.\d+$/.test(m.version || '') ? m : null))
    .catch(() => null);
  return manifestPromise;
}

// Пункты «Что нового» из заметок релиза (markdown-список): [{ title, text }].
// **Жирное начало:** становится заголовком пункта, остальное — текстом.
export function parseNotes(md) {
  return String(md || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => {
      const item = l.replace(/^[-*]\s+/, '');
      const m = item.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      return m ? { title: m[1].replace(/:$/, ''), text: m[2] } : { title: '', text: item.replace(/\*\*/g, '') };
    })
    .slice(0, 12);
}

// { version, date: Date | null, notes: [{ title, text }] } или null, пока не загрузилось / нет файла.
export function useLatestRelease(enabled = true) {
  const [release, setRelease] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    loadManifest().then((m) => {
      if (!alive || !m) return;
      const date = m.pub_date ? new Date(m.pub_date) : null;
      setRelease({ version: m.version, date: date && !Number.isNaN(date.getTime()) ? date : null, notes: parseNotes(m.notes) });
    });
    return () => { alive = false; };
  }, [enabled]);
  return release;
}

export function formatReleaseDate(date) {
  return date ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
}

// Открывается ли хост у клиента: запрос без CORS (ответ не читаем) с таймаутом.
// Сетевая ошибка или таймаут — значит, не открывается (блокировка, DNS, провайдер).
function probe(origin, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(`${origin}/favicon.ico?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    .then(() => true, () => false)
    .finally(() => clearTimeout(timer));
}

// Хосты, через которые GitHub отдаёт файлы релиза (страница релиза → хранилище файлов).
const GITHUB_HOSTS = ['https://github.com', 'https://release-assets.githubusercontent.com'];
const reachCache = new Map();

// 'checking' | 'ok' | 'blocked' для ссылки; null — проверка не нужна.
// Проверяется только GitHub: свои зеркала мы считаем доступными.
export function useReachable(url) {
  let host = null;
  try { host = url ? new URL(url).hostname : null; } catch { host = null; }
  const isGithub = !!host && /(^|\.)github(usercontent)?\.com$/.test(host);
  const [state, setState] = useState(isGithub ? 'checking' : null);
  useEffect(() => {
    if (!isGithub) { setState(null); return undefined; }
    let alive = true;
    const key = GITHUB_HOSTS.join(' ');
    if (!reachCache.has(key)) {
      reachCache.set(key, Promise.all(GITHUB_HOSTS.map((o) => probe(o, 4000))).then((r) => (r.every(Boolean) ? 'ok' : 'blocked')));
    }
    reachCache.get(key).then((s) => { if (alive) setState(s); });
    return () => { alive = false; };
  }, [isGithub]);
  return state;
}
