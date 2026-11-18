import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import { dateTime, ticketStatusLabel, ticketTone } from '../lib/format.js';
import { Badge, ErrorBox, Icon, Spinner, useToast } from '../ui/index.jsx';
import { Composer, MessageList, RefreshButton, useChatThread } from '../ui/chat.jsx';

export default function Ticket() {
  const { ticketId } = useParams();
  const { me } = useAuth();
  const toast = useToast();
  const { thread, messages, send, refresh, refreshing } = useChatThread(`/tickets/${ticketId}`, `/tickets/${ticketId}/messages`, 'client');
  const t = thread.data?.ticket?.id===ticketId?thread.data.ticket:null;
  useDocumentTitle(t?.subject || 'Обращение');

  const rate = async (rating) => {
    try { await api.post(`/tickets/${ticketId}/rate`, { rating }); toast('Спасибо за оценку!'); thread.reload(true); } catch (err) { toast.error(err); }
  };

  return <div className="chat-screen">
    <section className="chat-window card">
      <header className="chat-head">
        <Link to="/cabinet/support" className="icon-btn" aria-label="К обращениям"><Icon name="back" /></Link>
        <div className="chat-title">
          <strong>{t?.subject || 'Обращение'}</strong>
          <span>{t ? `создано ${dateTime(t.created_at)}` : ''}</span>
        </div>
        {t && <Badge tone={ticketTone(t.status)}>{ticketStatusLabel[t.status] || t.status}</Badge>}
        <RefreshButton onClick={refresh} busy={refreshing} />
      </header>
      {!t&&!thread.error ? <div className="chat-fill"><Spinner /></div>
        : thread.error && !t ? <div className="chat-fill"><ErrorBox error={thread.error} onRetry={thread.reload} /></div>
          : <>
            <MessageList key={ticketId} messages={messages} viewer="client" />
            {t.status === 'closed' && !t.rating && <div className="chat-rate">
              <span>Как мы помогли?</span>
              <span className="stars">{[5, 4, 3, 2, 1].map((n) => <button key={n} type="button" onClick={() => rate(n)} aria-label={`Оценка ${n} из 5`}>★</button>)}</span>
            </div>}
            <Composer key={`${me?.id}:${ticketId}`} draftKey={me?.id?`${me.id}:client:${ticketId}`:undefined} onSend={send} placeholder={t.status === 'closed' ? 'Напишите, если вопрос остался — обращение откроется снова' : 'Сообщение…'} />
          </>}
    </section>
  </div>;
}
