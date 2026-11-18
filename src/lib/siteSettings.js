import { useEffect, useState } from 'react';
import { ApiError, api } from './api.js';

// Настройки сайта хранятся в боте как служебные «страницы» его конструктора
// (GET /api/web/pages/{slug} — публично, PUT — только админ/дизайнер).
// Префикс kz- отделяет их от страниц старого сайта бота.
//
//   kz-site         { maintenance, banner, docs: [{slug, title}], nav: [{key, label, side, mobile}], downloads }
//   kz-faq          { sections: [{ title, items: [{ q, a }] }], updated_at }
//   kz-doc-<slug>   { title, body, updated_at }  — оферта, правила и любые другие документы

export const SITE_SLUG = 'kz-site';
export const docSlug = (slug) => `kz-doc-${slug}`;
const BLOCK_TYPE = 'kz-data';

export const DEFAULT_SITE = {
  maintenance: { enabled: false, title: 'Ведём технические работы', text: 'Сайт скоро снова заработает. Подписки и VPN работают как обычно.' },
  banner: { enabled: false, text: '', tone: 'info', link_text: '', link_url: '' },
  service_notice: { enabled: false, title: '', text: '', page_enabled: true },
  // Меню кабинета: порядок, показ в боковом и нижнем меню, свои названия. Пусто — порядок по умолчанию.
  nav: [],
  // Страница загрузки приложений: тумблер и ссылки по платформам (пустая ссылка — «скоро»).
  downloads: { enabled: false, links: {}, mirrors: {}, notes: {} },
  docs: [
    { slug: 'offer', title: 'Публичная оферта' },
    { slug: 'rules', title: 'Правила сервиса' },
    { slug: 'privacy', title: 'Политика конфиденциальности' },
  ],
};

export async function readKzPage(slug, signal) {
  try {
    const page = await api.get(`/web/pages/${slug}`, null, { signal });
    const block = (page?.blocks || []).find((b) => b.type === BLOCK_TYPE);
    return block?.data || null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

export async function writeKzPage(slug, data, title) {
  const body = { blocks: [{ type: BLOCK_TYPE, order: 0, data }] };
  try {
    await api.put(`/web/pages/${slug}`, body);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
    // Страницы ещё нет — создаём и сохраняем.
    await api.post('/web/pages', { slug, title: title || slug });
    await api.put(`/web/pages/${slug}`, body);
  }
  siteCache = null;
}

export function mergeSite(data) {
  return {
    maintenance: { ...DEFAULT_SITE.maintenance, ...(data?.maintenance || {}) },
    banner: { ...DEFAULT_SITE.banner, ...(data?.banner || {}) },
    service_notice: { ...DEFAULT_SITE.service_notice, ...(data?.service_notice || {}) },
    docs: Array.isArray(data?.docs) && data.docs.length ? data.docs : DEFAULT_SITE.docs,
    nav: Array.isArray(data?.nav) ? data.nav : [],
    downloads: {
      enabled: Boolean(data?.downloads?.enabled),
      links: { ...(data?.downloads?.links || {}) },
      mirrors: { ...(data?.downloads?.mirrors || {}) },
      notes: { ...(data?.downloads?.notes || {}) },
    },
  };
}

// FAQ: kz-faq { sections: [{ title, items: [{ q, a }] }], updated_at }.
// Пока в админке ничего не опубликовано — показываем текст, перенесённый из Teletype.
export const FAQ_SLUG = 'kz-faq';
export async function loadFaq(signal) {
  const data = await readKzPage(FAQ_SLUG, signal).catch(() => null);
  if (data && Array.isArray(data.sections)) return { ...data, published: true };
  const { default: fallback } = await import('./faqDefault.json');
  return { ...fallback, published: false };
}

let siteCache = null;
export function loadSite() {
  if (!siteCache) siteCache = readKzPage(SITE_SLUG).then(mergeSite).catch(() => mergeSite(null));
  return siteCache;
}

export function useSiteSettings() {
  const [site, setSite] = useState(null);
  useEffect(() => {
    let alive = true;
    loadSite().then((s) => alive && setSite(s));
    return () => { alive = false; };
  }, []);
  return site;
}
