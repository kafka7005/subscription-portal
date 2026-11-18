// Открытие сайта как Telegram Mini App (кнопка в боте): Telegram добавляет к адресу
// #tgWebAppData=<подписанные данные>. Бот проверяет подпись (POST /api/auth/login-telegram-webapp)
// и выдаёт обычную сессию — пользователь входит без кнопок и кодов.

export function readTelegramInitData() {
  try {
    const fromSdk = window.Telegram?.WebApp?.initData;
    if (fromSdk) return fromSdk;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const data = hash.get('tgWebAppData');
    if (data) {
      sessionStorage.setItem('portal-tg-initdata', data);
      return data;
    }
    return sessionStorage.getItem('portal-tg-initdata') || '';
  } catch {
    return '';
  }
}

export function isTelegramWebApp() {
  return Boolean(readTelegramInitData()) || /Telegram/i.test(navigator.userAgent) && Boolean(window.TelegramWebviewProxy);
}

// Подключаем SDK Telegram только внутри Telegram: тема, кнопка «назад», развернуть на весь экран.
export function setupTelegramSdk() {
  if (!readTelegramInitData() || window.Telegram?.WebApp) return;
  const s = document.createElement('script');
  s.src = 'https://telegram.org/js/telegram-web-app.js';
  s.async = true;
  s.onload = () => {
    try {
      const app = window.Telegram.WebApp;
      app.ready();
      app.expand();
      app.setHeaderColor?.('#070707');
      app.setBackgroundColor?.('#070707');
    } catch { /* старый клиент Telegram */ }
  };
  document.head.appendChild(s);
}
