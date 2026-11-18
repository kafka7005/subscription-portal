import { useEffect, useState } from 'react';
import { api } from './api.js';

// Публичные тарифы бота. На сайте показываем группу, указанную при сборке
// (VITE_TARIFF_GROUP, по умолчанию basic): это ровно 30/90/180/360 дней из макета.
export const TARIFF_GROUP = import.meta.env.VITE_TARIFF_GROUP || 'basic';

let cache = null;
export function loadPublicTariffs({ refresh = false } = {}) {
  if (refresh) cache = null;
  if (!cache) cache = api.get('/tariffs/public').catch((err) => { cache = null; throw err; });
  return cache;
}

export function cleanName(name) {
  // Убираем эмодзи-маркеры из названий тарифов бота («🟡 30 дней» → «30 дней»).
  return String(name || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
}

export function siteTariffs(all) {
  return (all || [])
    .filter((t) => t.group_code === TARIFF_GROUP && t.price_rub > 0)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.duration_days - b.duration_days);
}

export function usePublicTariffs() {
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    loadPublicTariffs().then((data) => alive && setState({ data, error: null }))
      .catch((error) => alive && setState({ data: null, error }));
    return () => { alive = false; };
  }, []);
  return state;
}

export function tariffName(all, id) {
  const t = (all || []).find((x) => x.id === id);
  return t ? cleanName(t.name) : null;
}

// Цена с учётом устройств — считает бот, сайт только показывает.
const priceCache = new Map();
export function configPrice(tariffId, devices) {
  const key = `${tariffId}:${devices}`;
  if (!priceCache.has(key)) {
    priceCache.set(key, api.get('/tariffs/config-price', { tariff_id: tariffId, selected_device_limit: devices })
      .then((r) => r.price_rub)
      .catch((err) => { priceCache.delete(key); throw err; }));
  }
  return priceCache.get(key);
}
