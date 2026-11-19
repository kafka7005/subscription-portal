import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import TemplatePicker from './TemplatePicker.jsx';
import CannedReplies from './CannedReplies.jsx';
import SupportSearch from './SupportSearch.jsx';
import { useSupportPresence } from './useSupportPresence.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, ticketStatusLabel, ticketTone } from '../lib/format.js';
import { Badge, Button, Card, ErrorBox, Icon, Modal, Select, Spinner, useConfirm, useToast } from '../ui/index.jsx';
import { Composer, MessageList, RefreshButton, useChatThread } from '../ui/chat.jsx';
import TicketCustomer from './TicketCustomer.jsx';

export default function TicketAdmin() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const [panelView, setPanelView] = useState('client');
  const [customerOpen, setCustomerOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1100px)');
    const change = () => { setCompact(query.matches); if (!query.matches) setCustomerOpen(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const [clientVersion, setClientVersion] = useState(0);
  const { isAdmin, me } = useAuth();
  const [templateBody,setTemplateBody]=useState(null);
  const [searchOpen,setSearchOpen]=useState(false);
  const [focusedId,setFocusedId]=useState(null);
  const { thread, messages, send, refresh, refreshing } = useChatThread(`/admin/tickets/${ticketId}`, `/portal/support/tickets/${ticketId}/reply`, 'agent');
  const agents = useLoad((signal) => api.get('/admin/agents', null, { signal }).catch(() => ({ items: [] })), []);
  const canned = useLoad((signal) => api.get('/portal/canned-replies', null, { signal }), []);
  useEffect(()=>{
    const refresh=()=>canned.reload(true);
    window.addEventListener('focus',refresh);
    return()=>window.removeEventListener('focus',refresh);
  },[canned.reload]);
  const t = thread.data?.ticket?.id===ticketId?thread.data.ticket:null;
  const presence=useSupportPresence(ticketId,Boolean(t));
  useEffect(()=>{setCustomerOpen(false);setPanelView('client');setFocusedId(null);setSearchOpen(false);setTemplateBody(null);},[ticketId]);
  const client = thread.data?.client;
  useDocumentTitle(t?.subject || 'Обращение');

  const patch = async (body, msg) => {
    try { await api.patch(`/admin/tickets/${ticketId}`, body); if (msg) toast(msg); thread.reload(true); } catch (err) { toast.error(err); }
  };
  const remove = async () => {
    if (!await confirm({ title: 'Удалить обращение?', text: 'Переписка удалится без возможности восстановления.', confirmText: 'Удалить', danger: true })) return;
    try { await api.del(`/admin/tickets/${ticketId}`); toast('Обращение удалено'); navigate('/admin/tickets'); } catch (err) { toast.error(err); }
  };

  if (thread.error && !t) return <ErrorBox error={thread.error} onRetry={thread.reload} />;
  const refreshAll = async () => { await refresh(); setClientVersion((v) => v + 1); };
  const guardedSend=async payload=>{
    if(!payload.internal&&presence.available===true&&presence.others.some(person=>person.typing)&&!await confirm({title:'Коллега тоже готовит ответ',text:'Проверьте переписку, чтобы не отправить два ответа. Отправить ваш черновик?',confirmText:'Отправить мой ответ'}))throw new Error('Отправка отменена. Черновик сохранён');
    const latest=messages.filter(m=>m.author==='agent'&&!m.pending&&!m.deleted).slice().sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)||a.id.localeCompare(b.id)).at(-1)?.id||null;
    try{await send({...payload,expected_agent_message_id:latest});presence.stopTyping();}
    catch(err){if(err.status===409)thread.reload(true);throw err;}
  };

  const selfAgent = (agents.data?.items || []).find(agent => me?.tg_id != null && String(agent.tg_id) === String(me.tg_id));
  const panel = <div className="customer-panel">
    <div className="customer-panel-nav" role="group" aria-label="Панель обращения">
      <button type="button" aria-pressed={panelView === 'client'} onClick={() => setPanelView('client')}><Icon name="user" size={16} />Клиент</button>
      <button type="button" aria-pressed={panelView === 'ticket'} onClick={() => setPanelView('ticket')}><Icon name="settings" size={16} />Обработка</button>
    </div>
    <div className="customer-panel-page" key={panelView}>
    {panelView === 'client' && t && <TicketCustomer key={`${ticketId}:${client?.admin_ref != null ? `user:${client.admin_ref}` : `tg:${client?.tg_id ?? 'none'}`}`} client={client} context={thread.data?.context} ticket={t} version={clientVersion} />}
    {panelView === 'ticket' && t && <Card title="Назначение" actions={
      selfAgent && String(t.assigned_agent_tg_id) !== String(selfAgent.tg_id) &&
        <Button variant="secondary" size="sm" onClick={() => patch({ assigned_agent_tg_id: Number(selfAgent.tg_id) }, 'Обращение назначено вам')}>Взять себе</Button>
    }>
          <div className="customer-ops">
            <Select label="Ответственный" value={t.assigned_agent_tg_id ? String(t.assigned_agent_tg_id) : ''}
              onChange={(e) => (e.target.value ? patch({ assigned_agent_tg_id: Number(e.target.value) }, 'Назначено') : patch({ unassign: true }, 'Снято'))}
              options={[{ value: '', label: 'Не назначен' }, ...(agents.data?.items || []).map((a) => ({ value: String(a.tg_id), label: a.name }))]} />
            <Select label="Приоритет" value={t.priority || 'normal'} onChange={(e) => patch({ priority: e.target.value })}
              options={[{ value: 'low', label: 'Низкий' }, { value: 'normal', label: 'Обычный' }, { value: 'high', label: 'Высокий' }]} />
          </div>
          {t.rating > 0 && <p className="customer-rating"><span>Оценка клиента</span><strong>{t.rating} / 5</strong></p>}
          <details className="ticket-more">
            <summary>Другие действия</summary>
            <Button variant="ghost" size="sm" icon="trash" onClick={remove}>Удалить обращение</Button>
          </details>
        </Card>}
    </div>
  </div>;
  return <div className="chat-screen">
    <div className="thread-layout">
      <section className="chat-window card">
        <header className="chat-head">
          <Link to="/admin/tickets" className="icon-btn" aria-label="К списку"><Icon name="back" /></Link>
          <div className="chat-title">
            <strong>{t?.subject || 'Обращение'}</strong>
            <span>{t ? `${dateTime(t.created_at)} · ${t.source}${t.category ? ` · ${t.category}` : ''}` : ''}</span>
          </div>
          {t && <Badge tone={ticketTone(t.status)}>{ticketStatusLabel[t.status] || t.status}</Badge>}
          <div className="ticket-head-actions">
          <RefreshButton onClick={refreshAll} busy={refreshing} />
          {t&&<button type="button" className="icon-btn" aria-label="Поиск в переписке" title="Поиск в переписке" onClick={()=>setSearchOpen(true)}><Icon name="search" size={18}/></button>}
          {t && (t.status === 'closed'
            ? <Button size="sm" variant="secondary" onClick={() => patch({ status: 'open' }, 'Обращение открыто')}>Открыть</Button>
            : <Button size="sm" icon="check" onClick={() => patch({ status: 'closed' }, 'Обращение закрыто')}>Закрыть</Button>)}
          {compact && t && <Button size="sm" variant="secondary" icon="user" aria-haspopup="dialog" onClick={() => { setPanelView('client'); setCustomerOpen(true); }}>О клиенте</Button>}
          </div>
        </header>
        {!t ? <div className="chat-fill"><Spinner /></div> : <>
          {presence.available===false?<p className="support-presence muted">Присутствие сотрудников временно недоступно</p>:presence.others.length>0&&<p className="support-presence" role="status">{presence.others.map(person=>`${person.name}: ${person.typing?'печатает':'смотрит обращение'}`).join(' · ')}</p>}
          <MessageList key={ticketId} messages={messages} viewer="agent" focusedId={focusedId} onSaveTemplate={isAdmin?body=>setTemplateBody(body):undefined}/>
          <Composer key={`${me?.id}:${ticketId}`} draftKey={me?.id?`${me.id}:agent:${ticketId}`:undefined} onTyping={presence.onTyping} onSend={guardedSend} allowNote placeholder="Ответ клиенту…"
            renderTemplates={({onPick,onClose})=><TemplatePicker state={canned} canManage={isAdmin} onPick={onPick} onClose={onClose}/>}/>
        </>}
      </section>
      {compact ? <Modal open={customerOpen} onClose={() => setCustomerOpen(false)} title="О клиенте" size="customer">
        {panel}
      </Modal> : <aside className="thread-side">{panel}</aside>}
    </div>
    {templateBody!==null&&<CannedReplies startNew initialBody={templateBody} onClose={()=>setTemplateBody(null)} onSaved={result=>{canned.setData(result);setTemplateBody(null);}}/>}
    {searchOpen&&<SupportSearch ticketId={ticketId} messages={messages} onClose={()=>setSearchOpen(false)} onJump={id=>{setFocusedId(null);requestAnimationFrame(()=>setFocusedId(id));}}/>}
  </div>;
}
