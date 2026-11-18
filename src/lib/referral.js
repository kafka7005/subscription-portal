import { api } from './api.js';

// Партнёрская программа: ссылка вида /partner/<код> (так её формирует бот) или ?ref=<код>.
// Код запоминаем до входа. После входа закрепляем за партнёром ТОЛЬКО нового клиента:
// аккаунт создан меньше суток назад и у него ещё нет подписок. Старые клиенты бота,
// впервые зашедшие на сайт, и уже вошедшие пользователи не засчитываются.
// Реферальная программа бота не используется, только партнёрка.
const KEY = 'portal-partner';
const NEW_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function rememberReferral(code) {
  if (!code) return;
  try { localStorage.setItem(KEY, String(code).slice(0, 64)); } catch { /* приватный режим */ }
}

export function hasStoredReferral() {
  try { return Boolean(localStorage.getItem(KEY)); } catch { return false; }
}

export function forgetReferral() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function isFresh(identity) {
  const raw = identity?.created_at;
  if (!raw) return false;
  const created = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`).getTime();
  return Number.isFinite(created) && Date.now() - created < NEW_USER_WINDOW_MS;
}

// Вызывается сразу после входа или регистрации.
export async function applyStoredReferral(identity) {
  let code = null;
  try { code = localStorage.getItem(KEY); } catch { return; }
  if (!code) return;
  forgetReferral();
  try {
    if (!isFresh(identity)) return;
    const summary = await api.get('/auth/summary');
    if (Number(summary?.keys_total) > 0) return;
    const body = /^\d+$/.test(code) ? { partner_tg_id: Number(code) } : { partner_code: code };
    await api.post('/partners/apply', body);
  } catch { /* уже закреплён или код неверный — входу не мешаем */ }
}
