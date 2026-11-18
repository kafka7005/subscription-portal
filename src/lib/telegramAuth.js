import { api } from './api.js';

// Вход через Telegram по OAuth 2.0 / OpenID Connect (oauth.telegram.org) с PKCE.
// Бот меняет code на id_token сам (TELEGRAM_CLIENT_ID / TELEGRAM_CLIENT_SECRET в config.py).
// Адрес возврата https://<домен>/auth/telegram нужно добавить в @BotFather → Bot Settings → Web Login.

const STORE = 'portal-tg-oauth';
export const callbackUrl = () => `${window.location.origin}/auth/telegram`;

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len = 48) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

let clientIdPromise = null;
function clientId() {
  if (!clientIdPromise) clientIdPromise = api.get('/telegram-widget-bot').then((r) => r.telegram_client_id).catch((e) => { clientIdPromise = null; throw e; });
  return clientIdPromise;
}

// mode: 'login' — войти; 'link' — привязать Telegram к текущему аккаунту.
export async function startTelegramAuth({ mode = 'login', next = '/cabinet' } = {}) {
  const id = await clientId();
  if (!id) throw new Error('Вход через Telegram не настроен в боте');
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(STORE, JSON.stringify({ verifier, state, mode, next }));
  const url = new URL('https://oauth.telegram.org/auth');
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: 'openid profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url.toString());
}

// Вызывается на /auth/telegram. Возвращает { mode, next, identity }.
export async function finishTelegramAuth(params) {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORE) || 'null'); } catch { /* ignore */ }
  sessionStorage.removeItem(STORE);
  if (params.get('error')) throw new Error('Вход через Telegram отменён');
  const code = params.get('code');
  if (!code || !saved || saved.state !== params.get('state')) throw new Error('Сессия входа устарела — попробуйте ещё раз');
  const body = { code, redirect_uri: callbackUrl(), code_verifier: saved.verifier };
  if (saved.mode === 'link') {
    const identity = await api.post('/auth/link-telegram-oidc', body);
    return { mode: 'link', next: saved.next || '/cabinet/profile', identity };
  }
  const res = await api.post('/auth/login-telegram-oidc', body);
  return { mode: 'login', next: saved.next || '/cabinet', identity: res.identity };
}
