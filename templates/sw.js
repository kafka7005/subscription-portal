/* Service worker Service Portal: только push-уведомления от бота (без офлайн-кэша,
   чтобы после выкладки всегда открывалась свежая версия сайта).
   Бот шлёт JSON { title, body, url, tag } (services/web_push.py). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Service Portal';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'portal',
    renotify: Boolean(data.tag),
    data: { url: data.url || '/cabinet' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let url = (event.notification.data && event.notification.data.url) || '/cabinet';
  // Старые адреса кабинета бота → разделы этого сайта.
  try {
    const target = new URL(url, self.location.origin);
    if (target.pathname.startsWith('//') || target.origin !== self.location.origin) throw new Error('External notification');
    const ticket = target.searchParams.get('ticket') || target.searchParams.get('ticket_id');
    if (ticket && !target.pathname.startsWith('/admin')) target.pathname = `/cabinet/support/${encodeURIComponent(ticket)}`;
    else if (target.pathname.startsWith('/support')) target.pathname = `/cabinet${target.pathname}`;
    else if (target.pathname.startsWith('/dashboard')) target.pathname = '/cabinet/support';
    url = target.pathname + target.search;
  } catch { url = '/cabinet/support'; }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
