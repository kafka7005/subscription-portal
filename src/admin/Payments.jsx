import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import PaymentHistory from './PaymentHistory.jsx';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { paymentDateTime, money, paymentStatusLabel, paymentTone, userName } from '../lib/format.js';
import { Badge, Button, Card, Loadable, PageHead, Pagination, SearchInput, Segmented, Table } from '../ui/index.jsx';

const LIMIT = 50;

export default function Payments() {
  useDocumentTitle('Платежи');
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [history, setHistory] = useState(null);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const status = params.get('status') || 'all';
  const offset = Number(params.get('offset')) || 0;
  const query = useDebounced(q.trim(), 300);
  const state = useLoad((signal) => api.get('/admin/payments', { q: query, status, limit: LIMIT, offset }, { signal }), [query, status, offset]);
  const update = (patch) => setParams((p) => {
    const n = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    return n;
  });

  return <>
    <PageHead title="Платежи" subtitle="Все оплаты через кассы и ручные начисления. Нажмите на строку, чтобы открыть клиента." />
    <Card>
      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); update({ offset: '' }); }} placeholder="Касса, сумма, TG ID, имя" />
        <Segmented label="Статус" value={status} onChange={(v) => update({ status: v === 'all' ? '' : v, offset: '' })}
          options={[{ value: 'all', label: 'Все' }, { value: 'success', label: 'Оплаченные' }, { value: 'pending', label: 'Неоплаченные' }]} />
      </div>
      <Loadable state={state}>{(data) => <>
        <Table rows={data?.items || []} rowKey={(p) => p.id} onRowClick={(p) => p.user_id && navigate(`/admin/users/${p.user_id}`)}
          columns={[
            { key: 'date', title: 'Дата', className: 'nowrap', render: (p) => paymentDateTime(p.created_at) },
            { key: 'who', title: 'Клиент', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{userName(p)}</strong><span>{p.tg_id ? `TG ${p.tg_id}` : `#${p.user_id ?? '—'}`}</span></div> },
            { key: 'system', title: 'Касса', render: (p) => p.payment_system },
            { key: 'status', title: 'Статус', render: (p) => <Badge tone={paymentTone(p.status)}>{paymentStatusLabel[p.status] || p.status}</Badge> },
            { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong className={p.amount < 0 ? 'tone-danger' : ''}>{money(p.amount, p.currency)}</strong> },
            { key: 'history', title: '', render: (p) => isAdmin && /yookassa/i.test(p.payment_system || '') ? <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setHistory(p); }}>История</Button> : null },
          ]} />
        <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={(o) => update({ offset: o ? String(o) : '' })} />
      </>}</Loadable>
    </Card>
    {history && <PaymentHistory payment={history} onClose={() => setHistory(null)} />}
  </>;
}
