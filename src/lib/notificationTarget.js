export function notificationTarget(raw) {
  try {
    const url = new URL(raw || '/cabinet/support', window.location.origin);
    if (url.pathname.startsWith('//') || url.origin !== window.location.origin) return '/cabinet/support';
    const ticket = url.searchParams.get('ticket') || url.searchParams.get('ticket_id');
    if (ticket && !url.pathname.startsWith('/admin')) return `/cabinet/support/${encodeURIComponent(ticket)}`;
    if (url.pathname.startsWith('/support')) url.pathname = `/cabinet${url.pathname}`;
    if (url.pathname.startsWith('/dashboard')) url.pathname = '/cabinet/support';
    return url.pathname + url.search + url.hash;
  } catch { return '/cabinet/support'; }
}
