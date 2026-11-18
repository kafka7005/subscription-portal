import Disclosure from '../ui/Disclosure.jsx';
import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loadable, PageHead, Pagination, Select, Table } from '../ui/index.jsx';

const LIMIT = 40;
const RESULTS = { success: 'Успешно', error: 'Ошибка', failed: 'Не выполнено', denied: 'Отказано', requested: 'Запрошено' };

function AuditHistory() {
  const [actor, setActor] = useState('');
  const [client, setClient] = useState('');
  const [channel, setChannel] = useState('');
  const [result, setResult] = useState('');
  const [offset, setOffset] = useState(0);
  const query = useMemo(() => ({ actor: actor.trim(), user_id: client, channel, result }), [actor, client, channel, result]);
  const filters = useDebounced(query, 300);
  const state = useLoad((signal) => api.get('/portal/admin-audit', { ...filters, limit: LIMIT, offset }, { signal }), [filters, offset]);
  const change = (setter) => (e) => { setter(e.target.value); setOffset(0); };

  return <>
    <PageHead title="Журнал администраторов" subtitle="Записанные ботом действия сотрудников над клиентами и страницами сайта. События появляются после сохранения в журнал бота; действия, которые бот не записывает, здесь не отображаются."
      actions={<Button variant="secondary" icon="refresh" busy={state.loading} onClick={() => state.reload()}>Обновить</Button>} />
    <Card>
      <div className="toolbar audit-filters">
        <Input label="Администратор" placeholder="Telegram ID или ID аккаунта" value={actor} onChange={change(setActor)} />
        <Input label="ID клиента" type="number" min="1" step="1" placeholder="Все клиенты" value={client} onChange={change(setClient)} />
        <Select label="Источник" value={channel} onChange={change(setChannel)} options={[{value:'',label:'Все'},{value:'api',label:'Сайт / API'},{value:'telegram',label:'Telegram'}]} />
        <Select label="Результат" value={result} onChange={change(setResult)} options={[{value:'',label:'Все'},...Object.entries(RESULTS).map(([value,label])=>({value,label}))]} />
      </div>
      {state.error && state.data !== undefined && <ErrorBox error={state.error} onRetry={state.reload} />}
      <Loadable state={state}>{(data) => <>
        <Table rows={data.items || []} rowKey={(row) => row.id}
          empty={<Empty icon="file" title="Событий пока нет" text="Измените фильтры или обновите журнал позже." />}
          columns={[
            {key:'created_at',title:'Дата',className:'nowrap',render:(r)=>dateTime(r.created_at)},
            {key:'actor',title:'Кто',render:(r)=><div className="cell-main"><strong>{r.actor_tg_id ? `TG ${r.actor_tg_id}` : 'Аккаунт сотрудника'}</strong><span className="audit-identity">{r.actor_identity_id || (!r.actor_tg_id ? 'Не указан в событии' : '')}</span></div>},
            {key:'action',title:'Действие',className:'cell-primary',render:(r)=><div className="cell-main"><strong>{r.label}</strong><span>{r.channel === 'api' ? 'Сайт / API' : r.channel === 'telegram' ? 'Telegram' : r.channel}</span></div>},
            {key:'target',title:'Объект',render:(r)=>r.entity_type === 'user' && /^\d+$/.test(r.entity_id || '') ? <Button variant="ghost" size="sm" to={`/admin/users/${r.entity_id}`}>Клиент #{r.entity_id}</Button> : <span className="audit-identity">{[r.entity_type,r.entity_id].filter(Boolean).join(' · ') || '—'}</span>},
            {key:'result',title:'Результат',render:(r)=><Badge tone={r.result==='success'?'ok':'warn'}>{RESULTS[r.result] || r.result}</Badge>},
            {key:'details',title:'Подробности',render:(r)=>r.metadata && Object.keys(r.metadata).length ? <Disclosure label="Открыть"><pre className="admin-event-data">{JSON.stringify(r.metadata,null,2)}</pre></Disclosure> : '—'},
          ]} />
        <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
      </>}</Loadable>
    </Card>
  </>;
}

export default function Audit() {
  useDocumentTitle('Журнал администраторов');
  const { isAdmin } = useAuth();
  return isAdmin ? <AuditHistory /> : <Empty icon="lock" title="Доступ только администратору" />;
}
