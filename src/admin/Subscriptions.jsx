import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, subscriptionStatus } from '../lib/format.js';
import { Badge, Card, Loadable, PageHead, Pagination, SearchInput, Table } from '../ui/index.jsx';

const LIMIT = 40;

export default function Subscriptions() {
  useDocumentTitle('Подписки');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const offset = Number(params.get('offset')) || 0;
  const query = useDebounced(q.trim(), 300);
  const state = useLoad((signal) => api.get('/admin/subscriptions/search', { q: query, limit: LIMIT, offset }, { signal }), [query, offset]);
  const setOffset = (o) => setParams((p) => { const n = new URLSearchParams(p); if (o) n.set('offset', o); else n.delete('offset'); return n; });

  return <>
    <PageHead title="Подписки" subtitle="Поиск по client_id, email подписки, названию, Telegram ID или имени владельца." />
    <Card>
      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setOffset(0); }} placeholder="client_id, email, @username, TG ID" autoFocus />
        {state.data && <span className="muted">Найдено: {state.data.total}</span>}
      </div>
      <Loadable state={state}>{(data) => <>
        <Table rows={data?.items || []} rowKey={(k) => k.client_id} onRowClick={(k) => navigate(`/admin/subscriptions/${encodeURIComponent(k.client_id)}`)}
          columns={[
            { key: 'name', title: 'Подписка', className: 'cell-primary', render: (k) => <div className="cell-main"><strong>{k.alias || k.email}</strong><span className="mono">{k.client_id}</span></div> },
            { key: 'owner', title: 'Владелец', render: (k) => k.owner_title || (k.owner_tg_id ? `TG ${k.owner_tg_id}` : '—') },
            { key: 'server', title: 'Кластер', render: (k) => k.server_id || '—' },
            { key: 'status', title: 'Статус', render: (k) => { const s = subscriptionStatus(k); return <Badge tone={s.tone}>{s.label}</Badge>; } },
            { key: 'expiry', title: 'До', className: 'nowrap', render: (k) => date(k.expiry_time) },
          ]} />
        <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={setOffset} />
      </>}</Loadable>
    </Card>
  </>;
}
