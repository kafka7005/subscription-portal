import Disclosure from '../ui/Disclosure.jsx';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { relative, ticketStatusLabel, ticketTone } from '../lib/format.js';
import { links } from '../lib/site.js';
import { Badge, Button, Card, Empty, Icon, Input, Loadable, Modal, PageHead, Select, Textarea, useToast } from '../ui/index.jsx';

const CATEGORIES = [
  { value: 'connection', label: 'Не подключается или медленно' },
  { value: 'payment', label: 'Оплата и продление' },
  { value: 'devices', label: 'Устройства и доступ' },
  { value: 'other', label: 'Другое' },
];

const FAQ = [
  ['VPN не подключается', 'Обновите подписку в приложении (кнопка «Обновить» или потяните список вниз). Не помогло — выберите другую локацию или заново добавьте подписку из кабинета.'],
  ['Оплатил, а подписки нет', 'Обычно она появляется в течение минуты — обновите главную кабинета. Прошло больше 10 минут — напишите нам с датой и суммой платежа.'],
  ['Закончились места для устройств', 'Откройте подписку → «Устройства» и отвяжите лишнее или добавьте устройства к подписке.'],
];

function NewTicket({ open, onClose, refId }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [category, setCategory] = useState('connection');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(refId || '');
  const [device, setDevice] = useState('');
  const [app, setApp] = useState('');
  const [diagnostics, setDiagnostics] = useState(false);
  const keys = useLoad((signal) => open ? api.get('/keys', null, { signal }) : null, [open]);
  const ownedKey = keys.data?.find((key) => key.client_id === clientId);
  const devices = useLoad((signal) => open && ownedKey ? api.get(`/keys/${encodeURIComponent(clientId)}/devices`, null, { signal }) : null, [open, ownedKey?.client_id]);
  useEffect(() => { setDevice(''); }, [clientId]);
  const deviceLabel = (row) => [row.device_model || row.model || row.device_name || row.platform || 'Устройство', row.os_version].filter(Boolean).join(' · ');
  const details = [
    ownedKey ? `Подписка: ${ownedKey.client_id}` : null,
    device ? `Устройство: ${device}` : null,
    app.trim() ? `Приложение: ${app.trim()}` : null,
    diagnostics ? `Браузер: ${navigator.userAgent.slice(0, 300)}` : null,
    diagnostics ? `Время: ${new Date().toISOString()}` : null,
  ].filter(Boolean).join('\n');
  const message = [body.trim(), details].filter(Boolean).join('\n\n');
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !body.trim() || message.length > 4000) return;
    setBusy(true);
    try {
      const t = await api.post('/tickets', {
        body: message, category, subject: subject.trim() || CATEGORIES.find((c) => c.value === category)?.label,
        ref_type: ownedKey ? 'key' : undefined, ref_id: ownedKey?.client_id,
      });
      onClose();
      navigate(`/cabinet/support/${t.id}`);
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Новое обращение">
    <form className="stack" onSubmit={submit}>
      <Select label="Тема" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES} />
      <Select label="Подписка" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={keys.loading} options={[{value:'',label:'Не относится к подписке'},...(keys.data || []).map((key)=>({value:key.client_id,label:key.alias || key.tariff_name || key.client_id}))]} />
      {keys.error && <p className="field-hint">Не удалось загрузить подписки. Обращение можно отправить без выбора подписки.</p>}
      {ownedKey && <Select label="Устройство" value={device} onChange={(e) => setDevice(e.target.value)} disabled={devices.loading} options={[{value:'',label:'Не выбрано'},...(devices.data?.devices || []).map((row,i)=>({value:`${deviceLabel(row)} (#${i+1})`,label:deviceLabel(row)}))]} />}
      {devices.error && <p className="field-hint">Список устройств недоступен. Можно описать устройство в сообщении.</p>}
      <Input label="Приложение и версия" value={app} maxLength={120} onChange={(e) => setApp(e.target.value)} placeholder="Например: Service Portal, версия 1.0" />
      <Input label="Коротко" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Например: не подключается на iPhone" />
      <Textarea label="Подробности" required value={body} onChange={(e) => setBody(e.target.value)} rows={5}
        placeholder="Что происходит, на каком устройстве и в каком приложении. Скриншот можно прикрепить в чате." />
      <label className="payment-consent"><input type="checkbox" checked={diagnostics} onChange={(e)=>setDiagnostics(e.target.checked)} /><span>Дополнительно приложить версию браузера и время. Без паролей и ссылок подключения.</span></label>
      {diagnostics && <Disclosure label="Какие сведения отправятся"><pre className="admin-event-data">{details}</pre></Disclosure>}
      <Button type="submit" busy={busy} className="btn-block" disabled={!body.trim() || message.length > 4000}>Отправить</Button>
      {message.length > 4000 && <p className="field-hint">Сократите сообщение: вместе с диагностикой допускается 4000 символов.</p>}
    </form>
  </Modal>;
}

export default function Support() {
  useDocumentTitle('Поддержка');
  const { config } = useAuth();
  const [params, setParams] = useSearchParams();
  const refId = params.get('ref');
  const [open, setOpen] = useState(Boolean(refId));
  const tickets = useLoad((signal) => api.get('/tickets', null, { signal }), []);
  useEffect(() => { if (!open && refId) setParams({}, { replace: true }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (config?.features?.support_tickets_enabled === false) {
    return <Card><Empty icon="chat" title="Поддержка работает в Telegram" text="Напишите нам — ответим там."
      action={<Button href={links.support} target="_blank" rel="noopener noreferrer" iconRight="external">Открыть Telegram</Button>} /></Card>;
  }

  return <>
    <PageHead title="Поддержка" subtitle="Ответим здесь же — уведомление придёт в колокольчик и в бот."
      actions={<Button icon="plus" onClick={() => setOpen(true)}>Новое обращение</Button>} />
    <div className="grid grid-main support-layout">
      <Card title="Обращения" className="support-inbox" padded>
        <Loadable state={tickets}>{(data) => {
          const items = data?.items || [];
          if (!items.length) return <Empty icon="chat" title="Обращений нет" text="Если что-то не работает — напишите, разберёмся." action={<Button size="sm" onClick={() => setOpen(true)}>Написать</Button>} />;
          return <ul className="ticket-list stagger">
            {items.map((t) => <li key={t.id}><Link to={`/cabinet/support/${t.id}`} className="ticket-item">
              <span className={`ticket-icon tone-${ticketTone(t.status)}`}><Icon name="chat" size={18} /></span>
              <div className="cell-main">
                <strong>{t.subject || 'Обращение'}</strong>
                <span>{ticketStatusLabel[t.status] || t.status} · {relative(t.last_message_at || t.updated_at || t.created_at)}</span>
              </div>
              {t.unread_count > 0 ? <span className="unread">{t.unread_count}</span> : <Badge tone={ticketTone(t.status)}>{ticketStatusLabel[t.status] || t.status}</Badge>}
            </Link></li>)}
          </ul>;
        }}</Loadable>
      </Card>
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Частые вопросы">
          <div className="faq-mini">
            {FAQ.map(([q, a]) => <Disclosure key={q} label={q}><p className="muted">{a}</p></Disclosure>)}
          </div>
        </Card>
        <Card>
          <div className="row-between">
            <div className="cell-main"><strong>Удобнее в Telegram?</strong><span className="muted">Пишите в бот поддержки</span></div>
            <Button size="sm" variant="secondary" href={links.support} target="_blank" rel="noopener noreferrer" iconRight="external">Открыть</Button>
          </div>
        </Card>
      </div>
    </div>
    <NewTicket open={open} onClose={() => setOpen(false)} refId={refId} />
  </>;
}
