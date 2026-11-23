import { days, rub } from './format.js';

// The bot can fall back to a monetary credit when the remainder buys less than one day.
export function renewalSummary(quote, durationDays, expiryTime, now = Date.now()) {
  if (!quote) return null;
  const duration = Number(durationDays);
  const expiry = Number(expiryTime);
  const extra = Number(quote.credit_days || 0);
  const credit = Number(quote.credit_to_balance_rub || 0);
  const refund = Number(quote.refund_to_balance_rub || 0);
  const keeps = quote.is_switch && quote.keeps_period;
  const start = quote.is_switch ? now : Math.max(now, expiry);
  const end = keeps ? expiry : start + (duration + extra) * 86400000;
  let note = '';
  if (quote.is_switch) {
    if (extra > 0) {
      note = `Остаток пересчитан по стоимости дня нового тарифа. К сроку ${days(duration)} добавится ещё ${days(extra)}. Итого с момента смены — ${days(duration + extra)}.`;
    } else {
      const timing = keeps ? 'Дата окончания сохранится.' : 'Новый срок начнётся с момента смены тарифа.';
      note = credit > 0 ? `Стоимость остатка подписки — ${rub(credit)}. Она учтена при расчёте оплаты. ${timing}` : timing;
      if (refund > 0) note += ` На баланс вернётся ${rub(refund)}.`;
    }
  }
  return { note, end };
}
