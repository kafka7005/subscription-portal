export function rub(value, { sign = false } = {}) {
  const n = Number(value || 0);
  const text = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.abs(n));
  const prefix = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${prefix}${text} ₽`;
}

export function money(value, currency = 'RUB') {
  if (!currency || currency.toUpperCase() === 'RUB') return rub(value);
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;
}

function toDate(value, naiveOffset = 'Z') {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  const text = String(value).trim().replace(/^(\d{4}-\d\d-\d\d) (\d\d:)/, '$1T$2').replace(/(\.\d{3})\d+/, '$1');
  if (/^\d{4}-\d\d-\d\d$/.test(text)) return new Date(`${text}T00:00:00${naiveOffset}`);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}${naiveOffset}`);
}

export function date(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function shortDate(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function dateTime(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function paymentTimeMs(value) {
  // The payments API returns Moscow wall time without an offset.
  return toDate(value, '+03:00')?.getTime() ?? NaN;
}

// The account history merges payment rows (Moscow) with gift and spend events (UTC).
export function paymentHistoryRows(items) {
  return items.map(item => {
    const event = item.provider === 'gift' || item.provider === 'spend';
    const ms = event ? toDate(item.created_at)?.getTime() : paymentTimeMs(item.created_at);
    return { ...item, createdAt: Number.isFinite(ms) ? new Date(ms) : null };
  }).sort((a, b) => (b.createdAt?.getTime() ?? -Infinity) - (a.createdAt?.getTime() ?? -Infinity));
}

const moscowClock = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function displayMoscow(ms) {
  return Number.isFinite(ms) ? `${moscowClock.format(ms)} МСК` : '—';
}

export function paymentDateTime(value) {
  return displayMoscow(paymentTimeMs(value));
}

export function refundDateTime(value) {
  // Refund records use UTC for timestamps without an offset.
  return displayMoscow(toDate(value)?.getTime());
}

export function relative(value) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} дн назад`;
  return shortDate(d);
}

export function plural(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = Math.abs(n) % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export function days(n) { return `${n} ${plural(n, 'день', 'дня', 'дней')}`; }
export function devices(n) { return `${n} ${plural(n, 'устройство', 'устройства', 'устройств')}`; }

// Сколько осталось до expiry_time (мс).
export function remaining(expiryMs) {
  const ms = Number(expiryMs || 0) - Date.now();
  if (ms <= 0) return { expired: true, days: 0, text: 'истекла' };
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return { expired: false, days: d, text: `ещё ${days(d)}` };
  const h = Math.max(1, Math.floor(ms / 3600000));
  return { expired: false, days: 0, text: `ещё ${h} ч` };
}

export function subscriptionStatus(key) {
  if (key.is_frozen) return { tone: 'muted', label: 'Заморожена' };
  const left = remaining(key.expiry_time);
  if (left.expired) return { tone: 'danger', label: 'Истекла' };
  if (left.days < 3) return { tone: 'warn', label: 'Скоро истечёт' };
  return { tone: 'ok', label: 'Активна' };
}

export function userName(u) {
  if (!u) return '—';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ');
  return full || (u.username ? `@${u.username}` : u.tg_id ? `ID ${u.tg_id}` : `#${u.id}`);
}

export const paymentStatusLabel = {
  success: 'Оплачен', succeeded: 'Оплачен', paid: 'Оплачен', pending: 'Ожидает', canceled: 'Отменён',
  cancelled: 'Отменён', failed: 'Ошибка', refunded: 'Возврат', expired: 'Истёк',
};

export function paymentTone(status) {
  const s = String(status || '').toLowerCase();
  if (['success', 'succeeded', 'paid'].includes(s)) return 'ok';
  if (['pending', 'waiting', 'created'].includes(s)) return 'warn';
  if (['refunded'].includes(s)) return 'muted';
  return 'danger';
}

export const ticketStatusLabel = {
  open: 'Новый', pending: 'Ждёт ответа', answered: 'Отвечен', closed: 'Закрыт',
};

export function ticketTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'open' || s === 'pending') return 'warn';
  if (s === 'closed' || s === 'resolved') return 'muted';
  return 'ok';
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
