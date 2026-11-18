import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { rub } from '../lib/format.js';
import { cleanName } from '../lib/tariffs.js';
import { availableProviders, recurringTerms } from '../lib/paymentPolicy.js';

// Only API-enabled providers. Recurring providers also require tariff terms.
export function usePaymentProviders(preview) {
  const { config } = useAuth();
  return useMemo(() => {
    const ids = availableProviders(config?.payments?.web_link_provider_ids || [], preview);
    const labels = config?.payments?.provider_labels || {};
    return ids.map((id) => ({ id, label: cleanName(labels[id] || id) }));
  }, [config, preview]);
}

// Выбор кассы + расчёт комиссии для суммы amount. onChange({ provider, quote }).
export function usePaymentChoice(amount, preview) {
  const providers = usePaymentProviders(preview);
  const [provider, setProvider] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  useEffect(() => { if (!providers.some((p) => p.id === provider)) setProvider(providers[0]?.id || null); }, [providers, provider]);
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!amount || amount <= 0 || !provider) return undefined;
    const controller = new AbortController();
    api.post('/payment-links/quote', { amount, currency: 'RUB', provider_id: provider }, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setQuote({ value, amount, provider }); }).catch((error) => { if (!controller.signal.aborted) { setQuote(null); setQuoteError(error); } });
    return () => controller.abort();
  }, [amount, provider, quoteRetry]);
  const currentQuote = quote?.amount === amount && quote?.provider === provider ? quote.value : null;
  const recurring = amount > 0 ? recurringTerms(provider, preview) : null;
  const [renewalQuote, setRenewalQuote] = useState(null);
  useEffect(() => {
    setRenewalQuote(null);
    if (!recurring) return undefined;
    const controller = new AbortController();
    api.post('/payment-links/quote', { amount: recurring.amount, currency: 'RUB', provider_id: provider }, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setRenewalQuote({ provider, amount: recurring.amount, period: recurring.period, gross: Number(value.gross_amount) }); })
      .catch((error) => { if (!controller.signal.aborted) { setRenewalQuote(null); setQuoteError(error); } });
    return () => controller.abort();
  }, [provider, recurring?.amount, recurring?.period, quoteRetry]);
  const renewal = recurring && renewalQuote?.provider === provider && renewalQuote.amount === recurring.amount && renewalQuote.period === recurring.period ? renewalQuote : null;
  const gross = currentQuote ? Number(currentQuote.gross_amount) : amount;
  const fee = currentQuote ? Number(currentQuote.fee_amount) : 0;
  const validProvider = providers.some((p) => p.id === provider);
  const ready = amount <= 0 || (validProvider && currentQuote && Number.isFinite(gross) && gross > 0 && (!recurring || (renewal && Number.isFinite(renewal.gross) && renewal.gross > 0)));
  return { providers, provider, setProvider, quote: currentQuote, gross, fee, recurring, renewal, ready, quoteError, retryQuote: () => setQuoteRetry((n) => n + 1), acceptedGross: currentQuote ? gross : undefined };
}

export function PaymentPicker({ choice, compact = false }) {
  const { providers, provider, setProvider } = choice;
  if (!providers.length) return <p className="notice notice-warn">Оплата на сайте сейчас недоступна — нет включённых касс.</p>;
  return <><div className={`provider-options ${compact ? 'is-compact' : ''}`} role="radiogroup" aria-label="Способ оплаты">
    {providers.map((p) => <button key={p.id} type="button" role="radio" aria-checked={provider === p.id} className="provider-option" onClick={() => setProvider(p.id)}>
      <span className="radio-dot" aria-hidden="true" />
      <span>{p.label}</span>
    </button>)}
  </div>{choice.quoteError && <p className="notice notice-warn" role="alert">Не удалось рассчитать комиссию. <button type="button" onClick={choice.retryQuote}>Повторить</button></p>}</>;
}

export function FeeLine({ choice }) {
  if (!choice.fee) return null;
  return <div className="kv-row"><dt>Комиссия кассы</dt><dd>{rub(choice.fee)}</dd></div>;
}

export const returnUrls = () => ({
  success_url: `${window.location.origin}/payment/success`,
  failure_url: `${window.location.origin}/payment/fail`,
});
