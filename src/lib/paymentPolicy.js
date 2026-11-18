const AUTOPAY_FIELDS = {
  YOOKASSA_AUTOPAY: ['autopay_price_rub', 'autopay_period_days'],
  YOOKASSA_AUTOPAY_WEB: ['autopay_price_rub', 'autopay_period_days'],
  KASSAI_AUTOPAY: ['kassai_autopay_price_rub', 'kassai_autopay_period_days'],
  OVERPAY_AUTOPAY: ['overpay_autopay_price_rub', 'overpay_autopay_period_days'],
};
export function recurringTerms(provider, preview) {
  const fields = AUTOPAY_FIELDS[provider];
  if (!fields) return null;
  const amount = Number(preview?.[fields[0]]);
  const period = Number(preview?.[fields[1]]);
  return amount > 0 && Number.isFinite(amount) && Number.isInteger(period) && period > 0 ? { amount, period } : null;
}
export function availableProviders(ids, preview) {
  return ids.filter((id) => !/AUTOPAY/i.test(id) || recurringTerms(id, preview));
}

export function canCheckout(choice, auto) {
  return Boolean(choice.ready && (!choice.recurring || (auto && choice.renewal)));
}

export function autopayConsent(choice, agreed) {
  return choice.recurring && agreed && choice.renewal ? {
    autopay_consent: true, autopay_accepted_amount: choice.renewal.amount,
    autopay_accepted_gross_amount: choice.renewal.gross, autopay_accepted_period_days: choice.renewal.period,
  } : { autopay_consent: false };
}
