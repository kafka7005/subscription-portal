import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime, rub } from '../lib/format.js';
import { Badge, Button, Empty, ErrorBox, Loadable, Modal, useConfirm, useToast } from '../ui/index.jsx';
import AutopayHistory from './AutopayHistory.jsx';

export default function AutopayManagement({ onClose }) {
  const state = useLoad((signal) => api.get('/yookassa-autopay', null, { signal }), []);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const remove = async (kind, row) => {
    if (busy) return;
    const card = kind === 'cards';
    if (!await confirm({
      title: card ? 'Удалить сохранённую карту?' : 'Отключить автоплатёж?',
      text: card
        ? 'Автоплатежи с этой карты будут отключены. Уже оплаченный срок подписок сохранится.'
        : 'Будущие автоматические списания для этой подписки будут отключены. Уже оплаченный срок сохранится.',
      confirmText: card ? 'Удалить карту' : 'Отключить', danger: true,
    })) return;
    setBusy(`${kind}:${row.id}`);
    try {
      await api.del(`/yookassa-autopay/${kind}/${encodeURIComponent(row.id)}`);
      toast(card ? 'Карта удалена' : 'Автоплатёж отключён');
      await state.reload();
    } catch (err) { toast.error(err); }
    finally { setBusy(null); }
  };

  return <Modal open title="Автоплатежи · ЮKassa" size="lg" onClose={() => { if (busy == null) onClose(); }}>
    <div className="stack">
    <div className="row"><Button size="sm" variant="ghost" icon="refresh" busy={state.loading} disabled={busy != null} onClick={() => { state.reload(); setHistoryVersion((v) => v + 1); }}>Обновить</Button></div>
    <Loadable state={state}>{(data) => <div className="stack">
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} />}
      <p className="field-hint">{data.enabled
        ? 'Подключить автоплатёж можно при покупке или продлении подписки: выберите соответствующий способ оплаты и подтвердите регулярные списания.'
        : 'Подключение автоплатежей отключено настройками кассы. Уже подключёнными автоплатежами можно управлять здесь.'}</p>
      {data.subscriptions?.length ? <div className="autopay-list">{data.subscriptions.map((sub) => <div className="autopay-item" key={sub.id}>
        <div className="autopay-details">
          <strong className="autopay-client">Подписка {sub.client_id}</strong>
          <span>{rub(sub.gross_amount ?? sub.amount)} каждые {sub.period_days} дней</span>
          {sub.active && <span className="muted">Следующее списание: {sub.next_payment_date ? dateTime(sub.next_payment_date) : 'дата уточняется'}</span>}
          <Badge tone={sub.active ? 'ok' : 'muted'}>{sub.processing ? 'Платёж обрабатывается' : sub.active ? 'Включён' : 'Отключён'}</Badge>
        </div>
        {sub.active && <Button size="sm" variant="ghost" busy={busy === `subscriptions:${sub.id}`} disabled={busy != null || state.loading || Boolean(state.error) || sub.processing} onClick={() => remove('subscriptions', sub)}>Отключить</Button>}
      </div>)}</div> : <Empty icon="card" title="Автоплатежей пока нет" text="Регулярные списания появятся здесь после подключения при оплате подписки." />}
      {data.cards?.length > 0 && <section className="stack" aria-label="Сохранённые карты">
        <h3>Сохранённые карты</h3>
        <div className="autopay-list">{data.cards.map((card) => <div className="autopay-item" key={card.id}>
          <div className="autopay-details"><strong>{card.bank_name || card.type || 'Карта'}</strong><span>{card.mask || 'Номер скрыт'}</span></div>
          <Button size="sm" variant="ghost" busy={busy === `cards:${card.id}`} disabled={busy != null || state.loading || Boolean(state.error) || data.subscriptions?.some((sub) => sub.processing)} onClick={() => remove('cards', card)}>Удалить карту</Button>
        </div>)}</div>
      </section>}
    </div>}</Loadable>
    <AutopayHistory key={historyVersion} />
    </div>
  </Modal>;
}
