import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, rub } from '../lib/format.js';
import { Badge, Button, Card, Empty, Loadable, PageHead, Pagination, Segmented, Table, useConfirm, useToast } from '../ui/index.jsx';

const LIMIT = 50;
const STATUS = { pending: ['Ожидает', 'warn'], approved: ['Выплачено', 'ok'], paid: ['Выплачено', 'ok'], rejected: ['Отклонено', 'danger'] };

export default function Partners() {
  useDocumentTitle('Партнёры');
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('pending');
  const [offset, setOffset] = useState(0);
  const path = tab === 'pending' ? '/partners/payouts/pending' : tab === 'history' ? '/partners/payouts/history' : '/partners/all';
  const state = useLoad((signal) => api.get(path, { limit: LIMIT, offset }, { signal }), [path, offset]);

  const decide = async (p, approve) => {
    if (!await confirm({
      title: approve ? `Подтвердить вывод ${rub(p.amount)}?` : 'Отклонить заявку?',
      text: approve ? `Переведите ${rub(p.amount)} на ${p.method || 'реквизиты'} ${p.destination || ''} и подтвердите — партнёр получит уведомление.` : 'Сумма вернётся на партнёрский баланс.',
      confirmText: approve ? 'Выплачено' : 'Отклонить', danger: !approve,
    })) return;
    try { const r = await api.post(`/partners/payouts/${p.id}/${approve ? 'approve' : 'reject'}`); toast(r?.message || 'Готово'); state.reload(true); } catch (err) { toast.error(err); }
  };

  const payoutColumns = [
    { key: 'date', title: 'Дата', className: 'nowrap', render: (p) => dateTime(p.created_at) },
    { key: 'who', title: 'Партнёр', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{p.tg_id ? `TG ${p.tg_id}` : `#${p.user_id}`}</strong><span>{p.method} {p.destination ? `· ${p.destination}` : ''}</span></div> },
    { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong>{rub(p.amount)}</strong> },
    { key: 'status', title: 'Статус', render: (p) => { const [l, t] = STATUS[p.status] || [p.status, 'muted']; return <Badge tone={t}>{l}</Badge>; } },
    tab === 'pending' && { key: 'act', title: '', className: 'num', render: (p) => <div className="row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="ghost" onClick={() => decide(p, false)}>Отклонить</Button>
      <Button size="sm" onClick={() => decide(p, true)}>Выплачено</Button>
    </div> },
  ].filter(Boolean);

  return <>
    <PageHead title="Партнёры" subtitle="Заявки на вывод партнёрских денег и список партнёров. Процент и код партнёра меняются в боте." />
    <Card>
      <div className="toolbar">
        <Segmented label="Раздел" value={tab} onChange={(v) => { setTab(v); setOffset(0); }}
          options={[{ value: 'pending', label: 'Заявки на вывод' }, { value: 'history', label: 'История выплат' }, { value: 'all', label: 'Партнёры' }]} />
      </div>
      <Loadable state={state}>{(data) => <>
        {tab === 'all'
          ? <Table rows={data?.items || []} rowKey={(p) => p.user_id} onRowClick={(p) => navigate(`/admin/users/${p.user_id}`)}
            empty={<Empty icon="handshake" title="Партнёров пока нет" />}
            columns={[
              { key: 'who', title: 'Партнёр', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{p.tg_id ? `TG ${p.tg_id}` : `#${p.user_id}`}</strong><span className="mono">{p.code || '—'}</span></div> },
              { key: 'ref', title: 'Пригласил', className: 'num', render: (p) => p.referred_count },
              { key: 'pct', title: 'Процент', className: 'num', render: (p) => `${p.percent}%` },
              { key: 'bal', title: 'Баланс', className: 'num', render: (p) => <strong>{rub(p.balance)}</strong> },
              { key: 'method', title: 'Вывод', render: (p) => p.method || '—' },
            ]} />
          : <Table rows={data?.items || []} rowKey={(p) => p.id} columns={payoutColumns}
            onRowClick={(p) => p.user_id && navigate(`/admin/users/${p.user_id}`)}
            empty={<Empty icon="wallet" title={tab === 'pending' ? 'Новых заявок нет' : 'Выплат пока не было'} />} />}
        <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={setOffset} />
      </>}</Loadable>
    </Card>
  </>;
}
