import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, money, paymentStatusLabel, paymentTone, rub } from '../lib/format.js';
import { Badge, Button, Card, Empty, Input, Loadable, PageHead, Table, useToast } from '../ui/index.jsx';
import { FeeLine, PaymentPicker, returnUrls, usePaymentChoice } from './PaymentPicker.jsx';
import PaymentConsents, { usePaymentConsents } from './PaymentConsents.jsx';
import AutopayManagement from './AutopayManagement.jsx';

const PURPOSE = {
  tariff_purchase: 'Покупка подписки', key_renew: 'Продление', renew: 'Продление', addons: 'Дополнительные устройства',
  balance_topup: 'Пополнение баланса', gift: 'Подарок', gift_create: 'Подарок',
};
const QUICK = [100, 300, 500, 1000, 2000];
const MIN_TOPUP = 10;
const MAX_TOPUP = 100000;

// Пополнение на произвольную сумму — появляется, когда в боте включена кнопка «Баланс».
function TopUp({ balance }) {
  const toast = useToast();
  const [value, setValue] = useState('300');
  const [busy, setBusy] = useState(false);
  const amount = Math.floor(Number(String(value).replace(',', '.')) || 0);
  const valid = amount >= MIN_TOPUP && amount <= MAX_TOPUP;
  const choice = usePaymentChoice(valid ? amount : 0);
  const consent = usePaymentConsents(choice, amount);

  const pay = async (e) => {
    e.preventDefault();
    if (!valid || !consent.ready || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/payment-links', {
        amount, currency: 'RUB', provider_id: choice.provider, accepted_gross_amount: choice.acceptedGross, ...returnUrls(),
      });
      if (!res?.payment_url) throw new Error(res?.error || 'Не удалось создать платёж');
      window.location.assign(res.payment_url);
    } catch (err) { toast.error(err); setBusy(false); }
  };

  return <Card title="Пополнить баланс" className="topup-card">
    <form className="stack" onSubmit={pay}>
      <div className="topup-balance"><span className="muted">Сейчас на балансе</span><strong>{rub(balance)}</strong></div>
      <Input label="Сумма, ₽" type="number" inputMode="numeric" min={MIN_TOPUP} max={MAX_TOPUP} value={value}
        onChange={(e) => setValue(e.target.value)} error={value && !valid ? `От ${MIN_TOPUP} до ${rub(MAX_TOPUP)}` : null} />
      <div className="chips">{QUICK.map((q) => <button type="button" key={q} className={`chip chip-btn ${amount === q ? 'is-on' : ''}`} onClick={() => setValue(String(q))}>{rub(q)}</button>)}</div>
      <div className="field"><span className="field-label">Способ оплаты</span><PaymentPicker choice={choice} /></div>
      {valid && <dl className="kv">
        <div className="kv-row"><dt>Зачислим</dt><dd>{rub(amount)}</dd></div>
        <FeeLine choice={choice} />
        <div className="kv-row"><dt><strong>К оплате</strong></dt><dd><strong>{rub(choice.gross)}</strong></dd></div>
      </dl>}
      <PaymentConsents consent={consent} />
      <Button type="submit" size="lg" className="btn-block" busy={busy} disabled={!consent.ready || !valid || !choice.provider} iconRight="arrow">Перейти к оплате</Button>
      <p className="field-hint">С баланса оплачиваются подписки, продления, устройства и подарки.</p>
    </form>
  </Card>;
}

export default function Payments() {
  useDocumentTitle('Платежи');
  const { config } = useAuth();
  const { summary } = useOutletContext();
  const [autopayOpen, setAutopayOpen] = useState(false);
  const state = useLoad((signal) => api.get('/auth/me/payments', { limit: 100 }, { signal }), []);
  const topUp = Boolean(config?.features?.balance_enabled);
  return <>
    <PageHead title="Платежи" subtitle="Баланс и история оплат. Если оплата прошла, а подписка не появилась — напишите в поддержку с датой и суммой."
      actions={<Button icon="card" onClick={() => setAutopayOpen(true)}>Автоплатежи</Button>} />
    <div className={`payments-layout ${topUp ? 'grid grid-main' : ''}`}>
      <Card title="История" className="payments-history">
        <Loadable state={state}>{(data) => <Table
          rows={data?.payments || []}
          rowKey={(p) => p.id}
          empty={<Empty icon="card" title="Платежей пока нет" text="Здесь появятся ваши оплаты." />}
          columns={[
            { key: 'created_at', title: 'Дата', className: 'nowrap', render: (p) => dateTime(p.created_at) },
            { key: 'purpose', title: 'Назначение', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{PURPOSE[p.purpose] || p.purpose || 'Оплата'}</strong><span>{p.provider || ''}</span></div> },
            { key: 'status', title: 'Статус', render: (p) => <Badge tone={paymentTone(p.status)}>{paymentStatusLabel[String(p.status).toLowerCase()] || p.status}</Badge> },
            { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong>{money(p.amount, p.currency)}</strong> },
          ]} />}</Loadable>
      </Card>
      {topUp && <TopUp balance={summary.data?.balance || 0} />}
    </div>
    {autopayOpen && <AutopayManagement onClose={() => setAutopayOpen(false)} />}
  </>;
}
