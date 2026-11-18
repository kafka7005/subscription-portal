import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { rub, shortDate, userName } from '../lib/format.js';
import { Card, Loadable, PageHead, Pagination, SearchInput, Table } from '../ui/index.jsx';

const LIMIT = 30;

export default function Users() {
  useDocumentTitle('Пользователи');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const offset = Number(params.get('offset')) || 0;
  const query = useDebounced(q.trim(), 300);
  const state = useLoad((signal) => {
    setParams((p) => { const n = new URLSearchParams(p); if (query) n.set('q', query); else n.delete('q'); return n; }, { replace: true });
    return api.get('/users/search', { q: query, limit: LIMIT, offset }, { signal });
  }, [query, offset]);

  return <>
    <PageHead title="Пользователи" subtitle="Поиск по имени, @username, Telegram ID, почте или email подписки." />
    <Card>
      <div className="toolbar">
        <SearchInput value={q} onChange={(v) => { setQ(v); setParams((p) => { const n = new URLSearchParams(p); n.delete('offset'); return n; }); }}
          placeholder="Имя, @username, ID или почта" autoFocus />
        {state.data && <span className="muted">Найдено: {state.data.total}</span>}
      </div>
      <Loadable state={state}>{(data) => <>
        <Table rows={data?.items || []} rowKey={(u) => u.id} onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
          columns={[
            { key: 'name', title: 'Клиент', className: 'cell-primary', render: (u) => <div className="cell-main"><strong>{userName(u)}</strong><span>{u.username ? `@${u.username}` : ''}{u.tg_id ? ` · TG ${u.tg_id}` : ''}</span></div> },
            { key: 'id', title: 'ID', render: (u) => `#${u.id}` },
            { key: 'balance', title: 'Баланс', className: 'num', render: (u) => rub(u.balance) },
            { key: 'trial', title: 'Пробный', render: (u) => (u.trial ? 'использован' : '—') },
            { key: 'created_at', title: 'Регистрация', className: 'nowrap', render: (u) => shortDate(u.created_at) },
          ]} />
        <Pagination total={data?.total} limit={LIMIT} offset={offset}
          onChange={(o) => setParams((p) => { const n = new URLSearchParams(p); n.set('offset', o); return n; })} />
      </>}</Loadable>
    </Card>
  </>;
}
