import { useEffect, useState } from 'react';
import { rub } from '../lib/format.js';
import { autopayConsent, canCheckout } from '../lib/paymentPolicy.js';

export function usePaymentConsents(choice, scope) {
  const [autoKey, setAutoKey] = useState(null);
  const autoScope = JSON.stringify([scope, choice.provider, choice.renewal?.amount, choice.renewal?.gross, choice.renewal?.period]);
  useEffect(() => { setAutoKey(null); }, [autoScope]);
  const auto = autoKey === autoScope;
  return {
    auto, choice, ready: canCheckout(choice, auto),
    setAuto: (value) => setAutoKey(value ? autoScope : null),
    payload: autopayConsent(choice, auto),
  };
}

export function PaymentNotice() {
  return <p className="payment-notice">Оплачивая, вы принимаете <a href="/docs" target="_blank" rel="noopener noreferrer">правовые документы сервиса</a>.</p>;
}

export default function PaymentConsents({ consent }) {
  const renewal = consent.choice.renewal;
  return <div className="payment-consents">
    <PaymentNotice />
    {consent.choice.recurring && <label className="payment-consent"><input type="checkbox" required checked={consent.auto} disabled={!renewal} onChange={(e) => consent.setAuto(e.target.checked)} /><span>{renewal ? <>Согласен на регулярное списание <strong>{rub(renewal.gross)}</strong> каждые <strong>{renewal.period} дней</strong> для автоматического продления подписки.</> : 'Рассчитываем сумму регулярного списания…'}</span></label>}
  </div>;
}
