import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { devices as devicesText, rub } from '../lib/format.js';
import { Button, ErrorBox, Modal, Spinner, useToast } from '../ui/index.jsx';
import { FeeLine, PaymentPicker, returnUrls, usePaymentChoice } from './PaymentPicker.jsx';
import PaymentConsents, { usePaymentConsents } from './PaymentConsents.jsx';

const enc = encodeURIComponent;

// Докупка устройств к действующей подписке: количество, расчёт ботом, способ оплаты.
export default function AddonsModal({ open, onClose, sub }) {
  const toast = useToast();
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Сколько не хватает после списания с баланса — эту сумму и платим через кассу.
  const toPay = preview ? Math.max(0, Math.ceil(Number(preview.final_price_rub || 0) - Number(preview.balance_rub || 0))) : 0;
  const choice = usePaymentChoice(toPay);
  const consent = usePaymentConsents(choice, `${open}:${sub.client_id}:${selected}:${preview?.final_price_rub}`);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    setError(null);
    api.get(`/keys/${enc(sub.client_id)}/addons-preview`, { force_web: true, include_device: true, selected_device_limit: selected || undefined }, { signal: controller.signal })
      .then((p) => { setPreview(p); if (!selected && p.device_options?.length) setSelected(p.device_options[0].value); })
      .catch((err) => { if (err.name !== 'AbortError') setError(err); });
    return () => controller.abort();
  }, [open, selected, sub]);

  const apply = async () => {
    if (!consent.ready || busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/keys/${enc(sub.client_id)}/apply-addons`, {
        selected_device_limit: selected, include_device: true, include_traffic: false, autopay_consent: false,
        provider_id: toPay > 0 ? choice.provider : undefined, accepted_gross_amount: toPay > 0 ? choice.acceptedGross : undefined, ...returnUrls(),
      }, { query: { force_web: true } });
      if (res.payment_url) { window.location.assign(res.payment_url); return; }
      toast(res.message || 'Устройства добавлены'); onClose(true);
    } catch (err) { toast.error(err); setBusy(false); }
  };

  const nothing = preview && preview.final_price_rub <= 0;
  return <Modal open={open} onClose={() => onClose(false)} title="Добавить устройства"
    footer={<Button busy={busy} disabled={!consent.ready || !preview || !selected || (toPay > 0 && !choice.provider)} onClick={apply} className="btn-block" iconRight="arrow">
      {toPay > 0 ? `Оплатить ${rub(choice.gross)}` : nothing ? 'Применить' : `Списать ${rub(preview?.final_price_rub || 0)} с баланса`}
    </Button>}>
    {error ? <ErrorBox error={error} /> : !preview ? <Spinner /> : !preview.device_options?.length
      ? <p className="muted">Для этой подписки докупка устройств недоступна.</p>
      : <>
        <p className="muted">Сейчас: {devicesText(preview.current_device_limit || sub.device_limit || 1)}. Выберите новое количество — доплата считается за оставшийся срок подписки.</p>
        <div className="device-options" role="radiogroup" aria-label="Устройств">
          {preview.device_options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={selected === o.value} onClick={() => setSelected(o.value)}>{o.value}</button>)}
        </div>
        <dl className="kv">
          <div className="kv-row"><dt>Доплата</dt><dd>{rub(preview.extra_price_rub)}</dd></div>
          {preview.discount_rub > 0 && <div className="kv-row"><dt>Скидка</dt><dd className="tone-ok">−{rub(preview.discount_rub)}</dd></div>}
          {preview.final_price_rub - toPay > 0 && <div className="kv-row"><dt>С баланса</dt><dd>−{rub(preview.final_price_rub - toPay)}</dd></div>}
          <FeeLine choice={choice} />
          <div className="kv-row"><dt><strong>К оплате</strong></dt><dd><strong>{rub(toPay > 0 ? choice.gross : 0)}</strong></dd></div>
        </dl>
        {toPay > 0 && <div className="field"><span className="field-label">Способ оплаты</span><PaymentPicker choice={choice} /></div>}
        <PaymentConsents consent={consent} />
      </>}
  </Modal>;
}
