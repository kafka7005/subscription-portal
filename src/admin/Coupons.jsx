import { useState } from 'react';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { rub } from '../lib/format.js';
import { Badge, Button, Card, IconButton, Input, Loadable, Modal, PageHead, Pagination, Segmented, Table, Toggle, useConfirm, useToast } from '../ui/index.jsx';

const LIMIT = 50;
const TYPES = [
  { value: 'percent', label: 'Скидка %' },
  { value: 'amount', label: 'На баланс ₽' },
  { value: 'days', label: 'Дни' },
];

function couponValue(c) {
  if (c.percent) return `−${c.percent}%${c.max_discount_amount ? ` (до ${rub(c.max_discount_amount)})` : ''}`;
  if (c.amount) return `+${rub(c.amount)} на баланс`;
  if (c.days) return `+${c.days} дн`;
  return '—';
}

function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `PORTAL${Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')}`;
}

function CreateModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const [type, setType] = useState('percent');
  const [form, setForm] = useState({ code: randomCode(), value: '10', usage_limit: '100', max_discount_amount: '', min_order_amount: '', new_users_only: false });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { code: form.code.trim().toUpperCase(), usage_limit: Number(form.usage_limit) || 1, new_users_only: form.new_users_only, [type]: Number(form.value) };
      if (type === 'percent') {
        if (form.max_discount_amount) body.max_discount_amount = Number(form.max_discount_amount);
        if (form.min_order_amount) body.min_order_amount = Number(form.min_order_amount);
      }
      await api.post('/coupons', body);
      toast(`Промокод ${body.code} создан`); onSaved(); onClose();
      setForm((f) => ({ ...f, code: randomCode() }));
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Новый промокод"
    footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button busy={busy} onClick={save}>Создать</Button></>}>
    <Segmented label="Тип" value={type} onChange={setType} options={TYPES} />
    <p className="help-text">{type === 'percent' ? 'Скидка на покупку и продление на сайте и в боте.' : type === 'amount' ? 'Клиент активирует код в боте — сумма зачисляется на баланс.' : 'Клиент активирует код в боте — к подписке добавляются дни.'}</p>
    <div className="form-grid">
      <Input label="Код" value={form.code} onChange={set('code')} className="span-2" />
      <Input label={type === 'percent' ? 'Скидка, %' : type === 'amount' ? 'Сумма, ₽' : 'Дней'} type="number" min="1" value={form.value} onChange={set('value')} />
      <Input label="Сколько раз можно использовать" type="number" min="1" value={form.usage_limit} onChange={set('usage_limit')} />
      {type === 'percent' && <>
        <Input label="Скидка не больше, ₽" type="number" min="0" value={form.max_discount_amount} onChange={set('max_discount_amount')} hint="Необязательно" />
        <Input label="Минимальная сумма заказа, ₽" type="number" min="0" value={form.min_order_amount} onChange={set('min_order_amount')} hint="Необязательно" />
      </>}
      <div className="span-2"><Toggle checked={form.new_users_only} onChange={set('new_users_only')} label="Только для новых клиентов" /></div>
    </div>
  </Modal>;
}

export default function Coupons() {
  useDocumentTitle('Промокоды');
  const toast = useToast();
  const confirm = useConfirm();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('active');
  const state = useLoad((signal) => api.get('/coupons', { limit: LIMIT, offset }, { signal }), [offset]);
  const stats = useLoad((signal) => api.get('/coupons/stats', null, { signal }).catch(() => null), []);
  const all = state.data?.items || (Array.isArray(state.data) ? state.data : []);
  const rows = all.filter((c) => (filter === 'all' ? true : filter === 'active' ? !c.is_used && c.usage_count < c.usage_limit : c.is_used || c.usage_count >= c.usage_limit));

  const remove = async (c) => {
    if (!await confirm({ title: `Удалить ${c.code}?`, text: 'Код перестанет работать. История использований сохранится.', confirmText: 'Удалить', danger: true })) return;
    try { await api.del(`/coupons/${encodeURIComponent(c.code)}`); toast('Промокод удалён'); state.reload(true); } catch (err) { toast.error(err); }
  };

  return <>
    <PageHead title="Промокоды" subtitle="Скидки на покупку, бонусы на баланс и дополнительные дни." actions={<Button icon="plus" onClick={() => setOpen(true)}>Создать промокод</Button>} />
    <Card>
      <div className="toolbar">
        <Segmented label="Фильтр" value={filter} onChange={setFilter} options={[{ value: 'active', label: 'Действуют' }, { value: 'used', label: 'Исчерпаны' }, { value: 'all', label: 'Все' }]} />
        {stats.data?.total_coupons !== undefined && <span className="muted">Всего: {stats.data.total_coupons} · активаций: {stats.data.total_redemptions ?? '—'}</span>}
      </div>
      <Loadable state={state}>{() => <>
        <Table rows={rows} rowKey={(c) => c.id}
          columns={[
            { key: 'code', title: 'Код', className: 'cell-primary', render: (c) => <div className="cell-main"><strong className="mono">{c.code}</strong><span>{c.new_users_only ? 'только новые клиенты' : ''}</span></div> },
            { key: 'value', title: 'Что даёт', render: couponValue },
            { key: 'usage', title: 'Использовано', render: (c) => `${c.usage_count} / ${c.usage_limit}` },
            { key: 'status', title: 'Статус', render: (c) => (c.is_used || c.usage_count >= c.usage_limit ? <Badge tone="muted">Исчерпан</Badge> : <Badge tone="ok">Действует</Badge>) },
            { key: 'actions', title: '', className: 'num', render: (c) => <IconButton icon="trash" label="Удалить" onClick={(e) => { e.stopPropagation(); remove(c); }} /> },
          ]} />
        <Pagination total={state.data?.total ?? all.length} limit={LIMIT} offset={offset} onChange={setOffset} />
      </>}</Loadable>
    </Card>
    <CreateModal open={open} onClose={() => setOpen(false)} onSaved={() => state.reload(true)} />
  </>;
}
