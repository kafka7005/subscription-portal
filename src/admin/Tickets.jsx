import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import CannedReplies from './CannedReplies.jsx';
import SupportReminders from './SupportReminders.jsx';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { relative, ticketStatusLabel, ticketTone } from '../lib/format.js';
import { Badge, Button, Card, Loadable, PageHead, Pagination, SearchInput, Segmented, Table } from '../ui/index.jsx';

const LIMIT = 40;
const FILTERS = [
  { value: 'active', label: 'Нужен ответ', countTone: 'warn' },
  { value: 'answered', label: 'Отвечены', countTone: 'ok' },
  { value: 'closed', label: 'Закрыты' },
  { value: 'all', label: 'Все' },
];

export default function Tickets() {
  useDocumentTitle('Поддержка');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get('f') || 'active';
  const offset = Number(params.get('offset')) || 0;
  const [q, setQ] = useState('');
  const { isAdmin } = useAuth();
  const [editReplies,setEditReplies]=useState(false);
  const [editReminders,setEditReminders]=useState(false);
  const search = useDebounced(q.trim(), 300);
  const counts = useLoad((signal) => api.get('/admin/tickets-metrics', null, { signal }), []);
  const byStatus = counts.data?.by_status;
  const filters = FILTERS.map((item) => ({ ...item, count: counts.data
    ? item.value === 'all' ? counts.data.total
      : item.value === 'active' ? (byStatus?.open || 0) + (byStatus?.pending || 0)
        : byStatus?.[item.value] || 0
    : undefined }));
  // «Нужен ответ» = новые (open) и те, где клиент ответил последним (pending).
  const state = useLoad(async (signal) => {
    if (filter === 'active') {
      const [open, pending] = await Promise.all([
        api.get('/admin/tickets', { status: 'open', search, limit: LIMIT }, { signal }),
        api.get('/admin/tickets', { status: 'pending', search, limit: LIMIT }, { signal }),
      ]);
      const items = [...(open.items || []), ...(pending.items || [])]
        .sort((a, b) => new Date(a.last_message_at || a.created_at) - new Date(b.last_message_at || b.created_at));
      return { items, total: (open.total || 0) + (pending.total || 0), merged: true };
    }
    return api.get('/admin/tickets', { status: filter === 'all' ? undefined : filter, search, limit: LIMIT, offset }, { signal });
  }, [filter, search, offset]);

  useEffect(() => {
    const refresh = () => { if (!document.hidden) { state.reload(true); counts.reload(true); } };
    const id = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(id); window.removeEventListener('focus', refresh); };
  }, [state.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <PageHead title="Поддержка" subtitle="Обращения с сайта и из бота. В «Нужен ответ» самые старые — сверху."
      actions={isAdmin&&<><Button icon="bell" variant="secondary" onClick={()=>setEditReminders(true)}>Напоминания</Button><Button icon="file" variant="secondary" onClick={()=>setEditReplies(true)}>Быстрые ответы</Button></>}/>
    {editReplies&&<CannedReplies onClose={()=>setEditReplies(false)}/>}
    {editReminders&&<SupportReminders onClose={()=>setEditReminders(false)}/>}
    <Card>
      <div className="toolbar ticket-filters">
        <Segmented label="Фильтр" value={filter} onChange={(v) => setParams({ f: v })} options={filters} />
        <SearchInput value={q} onChange={setQ} placeholder="Поиск по теме и тексту" />
      </div>
      <Loadable state={state}>{(data) => <>
        <Table rows={data?.items || []} rowKey={(t) => t.id} onRowClick={(t) => navigate(`/admin/tickets/${t.id}`)}
          columns={[
            { key: 'subject', title: 'Тема', className: 'cell-primary', render: (t) => <div className="cell-main"><strong>{t.subject || 'Без темы'}</strong><span>{t.category || t.source}{t.tags?.length ? ` · ${t.tags.join(', ')}` : ''}</span></div> },
            { key: 'status', title: 'Статус', render: (t) => <Badge tone={ticketTone(t.status)}>{ticketStatusLabel[t.status] || t.status}</Badge> },
            { key: 'priority', title: 'Приоритет', render: (t) => (t.priority === 'high' ? <Badge tone="danger">Высокий</Badge> : '—') },
            { key: 'agent', title: 'Ответственный', render: (t) => (t.assigned_agent_tg_id ? `TG ${t.assigned_agent_tg_id}` : '—') },
            { key: 'last', title: 'Обновлено', className: 'nowrap', render: (t) => relative(t.last_message_at || t.updated_at) },
          ]} />
        {!data?.merged && <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={(o) => setParams({ f: filter, offset: o })} />}
      </>}</Loadable>
    </Card>
  </>;
}
