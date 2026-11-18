import Disclosure from '../ui/Disclosure.jsx';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { date, dateTime, money } from '../lib/format.js';
import { Badge, Button, Card, KeyValue, Loadable, Modal, Select, Table, Tabs, useConfirm, useToast } from '../ui/index.jsx';
import ManualAutopay from './ManualAutopay.jsx';

function PageButtons({ page, setPage, hasNext }) {
  return <div className="pagination"><span className="muted">Страница {page + 1}</span><div className="row">
    <Button size="sm" variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Назад</Button>
    <Button size="sm" variant="ghost" disabled={!hasNext} onClick={() => setPage(page + 1)}>Далее</Button>
  </div></div>;
}

function History({ userId, events = false }) {
  const [page, setPage] = useState(0);
  const state = useLoad((signal) => api.get(`/users/${userId}/${events ? 'subscription-events' : 'subscription-history'}`, { page, limit: 20 }, { signal }), [userId, page, events]);
  return <Loadable state={state}>{(data) => <>
    <Table rows={data.items || []} rowKey={(r) => events ? r.id : r.client_id} columns={[
      { key: 'name', title: 'Подписка', className: 'cell-primary', render: (r) => <div className="cell-main"><strong>{r.tariff_name || 'Подписка'}</strong><span className="mono">{r.client_id}</span></div> },
      { key: 'event', title: events ? 'Событие' : 'Состояние', render: (r) => events ? ({ created: 'Создана', renewed: 'Продление', deleted: 'Удалена', expired: 'Истекла', frozen: 'Заморожена', unfrozen: 'Разморожена' }[r.event_type] || r.event_type) : r.is_current ? (r.is_frozen ? 'Заморожена' : 'Есть у клиента') : ({ deleted: 'Удалена', expired: 'Истекла', completed: 'Завершена' }[r.status] || r.status) },
      { key: 'time', title: events ? 'Дата' : 'Последнее событие', render: (r) => dateTime(events ? r.created_at : r.last_at) },
      { key: 'expiry', title: 'Срок до', render: (r) => r.expiry_time ? date(r.expiry_time) : '—' },
      events ? { key: 'price', title: 'Сумма', render: (r) => r.price_rub == null ? '—' : money(r.price_rub) } : { key: 'renewals', title: 'Продлений', render: (r) => r.renewals ?? 0 },
    ]} />
    <PageButtons page={page} setPage={setPage} hasNext={data.has_next} />
  </>}</Loadable>;
}

function Actions({ userId }) {
  const [page, setPage] = useState(0);
  const [category, setCategory] = useState('all');
  const [channel, setChannel] = useState('all');
  const state = useLoad((signal) => api.get(`/users/${userId}/actions`, { page, limit: 20, category, channel }, { signal }), [userId, page, category, channel]);
  return <><div className="toolbar">
    <Select label="Тип событий" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} options={[['all','Все'],['balance','Баланс'],['auth','Авторизация'],['payments','Платежи'],['subscriptions','Подписки'],['marketing','Маркетинг']].map(([value,label]) => ({ value,label }))} />
    <Select label="Источник" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(0); }} options={[{value:'all',label:'Все'},{value:'api',label:'Сайт / API'},{value:'telegram',label:'Telegram'}]} />
  </div><Loadable state={state}>{(data) => <>
    <Table rows={data.items || []} rowKey={(r) => r.id || `${r.request_id}:${r.event_type}:${r.created_at}`} columns={[
      {key:'event',title:'Действие',className:'cell-primary',render:(r)=><div className="cell-main"><strong>{r.label || r.event_type}</strong><span>{dateTime(r.created_at)}</span></div>},
      {key:'actor',title:'Кто',render:(r)=><span>{r.kind === 'administration' ? 'Сотрудник' : 'Клиент'}{r.actor_tg_id ? ` · TG ${r.actor_tg_id}` : r.actor_identity_id ? ` · ${r.actor_identity_id}` : ''}</span>},
      {key:'channel',title:'Источник',render:(r)=>r.channel},
      {key:'result',title:'Результат',render:(r)=>r.result === 'success' ? 'Успешно' : r.result},
      {key:'meta',title:'Подробности',render:(r)=>r.metadata && Object.keys(r.metadata).length ? <Disclosure label="Открыть"><pre className="admin-event-data">{JSON.stringify(r.metadata,null,2)}</pre></Disclosure> : '—'},
    ]}/><PageButtons page={page} setPage={setPage} hasNext={data.has_next}/>
  </>}</Loadable></>;
}

function Autorenew({ userId, canCancel, onChanged }) {
  const state = useLoad((signal) => api.get(`/users/${userId}/autorenew`, null, { signal }), [userId]);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [manual,setManual]=useState(null);
  const cancel = async (row) => {
    if (!await confirm({ title:'Отключить автопродление?', text:'Будущие автоматические списания для этой подписки будут отменены. Оплаченный срок останется.',confirmText:'Отключить',danger:true })) return;
    setBusy(row.id);
    try { await api.del(`/users/${userId}/autorenew/${row.id}`); toast('Автопродление отключено'); state.reload(true); }
    catch(err){toast.error(err);}finally{setBusy(null);}
  };
  return <><Loadable state={state}>{(data)=><div className="stack">
    <p className="notice">ЮKassa: {data.enabled ? 'автопродление разрешено настройками кассы.' : 'автопродление отключено настройками кассы.'} Подключение требует личного согласия клиента.</p>
    <Table rows={data.subscriptions || []} rowKey={(r)=>r.id} columns={[
      {key:'sub',title:'Подписка',className:'cell-primary',render:(r)=><span className="mono">{r.client_id}</span>},
      {key:'active',title:'Статус',render:(r)=><Badge tone={r.active?'ok':'muted'}>{r.active?'Включено':'Отключено'}</Badge>},
      {key:'amount',title:'Списание',render:(r)=>money(r.gross_amount ?? r.amount)},
      {key:'next',title:'Следующее списание',render:(r)=>r.active?dateTime(r.next_payment_date):'—'},
      {key:'action',title:'',render:(r)=>canCancel && r.active ? <div className="row"><Button size="sm" icon="card" disabled={!data.enabled || busy!=null || r.processing} onClick={()=>setManual(r)}>Списать сейчас</Button><Button size="sm" variant="ghost" busy={busy===r.id} disabled={busy!=null || r.processing} onClick={()=>cancel(r)}>{r.processing?'Обрабатывается':'Отключить'}</Button></div>:null},
    ]}/>
    {data.cards?.length > 0 && <KeyValue items={data.cards.map((card)=>[`${card.bank_name || card.type || 'Карта'} · ${card.id}`,`${card.mask || '—'} · ${card.active?'активна':'неактивна'}`])}/>}
  </div>}</Loadable>{manual && <ManualAutopay userId={userId} subscription={manual} onClose={()=>setManual(null)} onChanged={()=>{state.reload(true);onChanged?.();}}/>}</>;
}

export function SendCabinet({ user, config, onClose }) {
  const [tab,setTab]=useState('keys');
  const [busy,setBusy]=useState(false);
  const toast=useToast();
  const submit=async(e)=>{e.preventDefault();if(busy)return;setBusy(true);try{await api.post(`/users/${user.id}/cabinet`,{tab});toast('Кнопка отправлена в Telegram');onClose();}catch(err){toast.error(err);}finally{setBusy(false);}};
  const options=[{value:'keys',label:'Подписки'},{value:'profile',label:'Профиль'},config?.features?.partner_enabled&&{value:'partners',label:'Партнёрка'},config?.features?.gifts_enabled&&{value:'gifts',label:'Подарки'},{value:'notifications',label:'Поддержка'}].filter(Boolean);
  return <Modal open onClose={()=>{if(!busy)onClose();}} title="Отправить кнопку кабинета" size="sm"><form className="stack" onSubmit={submit}>
    <p className="muted">Клиент получит сообщение в Telegram с кнопкой выбранного раздела. Вход от его имени не выполняется.</p>
    <Select label="Раздел" value={tab} onChange={(e)=>setTab(e.target.value)} options={options} disabled={busy}/>
    <Button type="submit" busy={busy}>Отправить клиенту</Button>
  </form></Modal>;
}

export default function UserTools({ user, capabilities, onChanged }) {
  const options=[{value:'history',label:'История подписок',cap:'view_subscription_history'},{value:'events',label:'События подписок',cap:'view_subscription_history'},{value:'actions',label:'Журнал действий',cap:'view_audit'},{value:'autorenew',label:'Автопродление',cap:'autorenew'}].filter((x)=>capabilities[x.cap]!==false);
  const [selected,setSelected]=useState('history');
  const tab=options.some((x)=>x.value===selected)?selected:options[0]?.value;
  if(!tab)return null;
  return <Card title="История и управление"><Tabs value={tab} onChange={setSelected} tabs={options}/><div className="admin-user-tools">
    {tab==='history'&&<History key={`history:${user.id}`} userId={user.id}/>}
    {tab==='events'&&<History key={`events:${user.id}`} userId={user.id} events/>}
    {tab==='actions'&&<Actions key={user.id} userId={user.id}/>}
    {tab==='autorenew'&&<Autorenew key={user.id} userId={user.id} canCancel={capabilities.manage_autorenew!==false} onChanged={onChanged}/>}
  </div></Card>;
}
