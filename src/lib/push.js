import { api } from './api.js';

// Web push: браузер подписывается публичным VAPID-ключом бота, подписку храним в боте
// (POST /api/push/subscribe) — дальше бот сам шлёт уведомления (ответы поддержки,
// продления, оплаты). Публичный ключ = VAPID_PUBLIC_KEY из config.py бота.
const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(VAPID);
}

// iPhone: push работает только в установленном на экран «Домой» приложении (iOS 16.4+).
export function isIos() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerSw() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Этот браузер не поддерживает уведомления');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления запрещены в настройках браузера');
  const reg = await registerSw();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) });
  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return 'on';
}

// Восстанавливаем связь браузерной подписки с текущим аккаунтом после входа.
// Разрешение повторно не запрашиваем и новую подписку автоматически не создаём.
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe(); // бот удалит подписку при следующей отправке (410)
  return 'off';
}
