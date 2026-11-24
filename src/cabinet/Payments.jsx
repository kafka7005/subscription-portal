import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, paymentHistoryRows, money, paymentStatusLabel, paymentTone, rub } from '../lib/format.js';
import { Badge, Button, Card, Empty, Input, Loadable, Modal, Spinner, ErrorBox, PageHead, Table, useToast } from '../ui/index.jsx';
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

const BALANCE_REASON = {
  bonus: 'Ежедневный бонус', adjustment: 'Корректировка администратором', topup: 'Пополнение баланса',
  renewal: 'Продление подписки', addons: 'Дополнительные опции', tariff_credit: 'Возврат при перерасчёте тарифа',
  issued: 'Оформление подписки',
};

function BalanceHistory({ onClose }) {
  const [offset, setOffset] = useState(0);
  const state = useLoad(signal => api.get('/portal/balance-history', { offset, limit: 20 }, { signal }), [offset]);
  const data = state.data;
  return <Modal open onClose={onClose} title="Почему изменился баланс?">
    <div className="stack">
      <p className="muted">Здесь собраны операции, для которых бот сохранил причину. Сумма со знаком плюс зачислена на баланс, со знаком минус — списана.</p>
      {state.loading ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
        : data?.items?.length ? <ul className="support-payments">{data.items.map(row => <li key={row.id}>
          <div><strong>{BALANCE_REASON[row.kind] || 'Изменение баланса'}</strong>
            {row.amount != null && <Badge tone={row.amount > 0 ? 'ok' : 'muted'}>{rub(row.amount, { sign: true })}</Badge>}</div>
          <small>{dateTime(row.created_at)}{row.amount == null && ' · Сумма списания не записана'}</small>
        </li>)}</ul> : <p>Записей пока нет.</p>}
      {(offset > 0 || data?.has_more) && <div className="row">
        <Button size="sm" variant="secondary" disabled={!offset || state.loading} onClick={() => setOffset(offset - 20)}>Назад</Button>
        <Button size="sm" variant="secondary" disabled={!data?.has_more || state.loading || Boolean(state.error)} onClick={() => setOffset(offset + 20)}>Дальше</Button>
      </div>}
    </div>
  </Modal>;
}

export default function Payments() {
  useDocumentTitle('Платежи');
  const { config } = useAuth();
  const { summary } = useOutletContext();
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [autopayOpen, setAutopayOpen] = useState(false);
  const state = useLoad(async signal => {
    const data = await api.get('/auth/me/payments', { limit: 100 }, { signal });
    return paymentHistoryRows(data?.payments || []);
  }, []);
  const topUp = Boolean(config?.features?.balance_enabled);
  return <>
    <PageHead title="Платежи" subtitle="Баланс и история оплат. Если оплата прошла, а подписка не появилась — напишите в поддержку с датой и суммой."
      actions={<Button icon="card" onClick={() => setAutopayOpen(true)}>Автоплатежи</Button>} />
    <div className={`payments-layout ${topUp ? 'grid grid-main' : ''}`}>
      <Card title="История" className="payments-history" actions={<Button size="sm" variant="secondary" icon="wallet" onClick={() => setBalanceOpen(true)}>Почему изменился баланс?</Button>}>
        <Loadable state={state}>{(data) => <Table
          rows={data || []}
          rowKey={(p) => p.id}
          empty={<Empty icon="card" title="Платежей пока нет" text="Здесь появятся ваши оплаты." />}
          columns={[
            { key: 'created_at', title: 'Дата (местное время)', className: 'nowrap', render: (p) => dateTime(p.createdAt) },
            { key: 'purpose', title: 'Назначение', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{PURPOSE[p.purpose] || p.purpose || 'Оплата'}</strong><span>{p.provider || ''}</span></div> },
            { key: 'status', title: 'Статус', render: (p) => <Badge tone={paymentTone(p.status)}>{paymentStatusLabel[String(p.status).toLowerCase()] || p.status}</Badge> },
            { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong>{money(p.amount, p.currency)}</strong> },
          ]} />}</Loadable>
      </Card>
      {topUp && <TopUp balance={summary.data?.balance || 0} />}
    </div>
    {balanceOpen && <BalanceHistory onClose={() => setBalanceOpen(false)} />}
    {autopayOpen && <AutopayManagement onClose={() => setAutopayOpen(false)} />}
  </>;
}
