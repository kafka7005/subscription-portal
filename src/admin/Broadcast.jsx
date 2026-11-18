import { BroadcastText, pastedBroadcast } from '../ui/BroadcastText.jsx';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { Button, Card, Input, Modal, PageHead, Segmented, Select, Textarea, useConfirm, useToast } from '../ui/index.jsx';

const AUDIENCE = [
  { value: 'all', label: 'Все пользователи' },
  { value: 'subscribed', label: 'С активной подпиской' },
  { value: 'unsubscribed', label: 'Без подписки' },
  { value: 'trial', label: 'Использовали пробный период' },
  { value: 'untrial', label: 'Не брали пробный период' },
  { value: 'hotleads', label: 'Горячие (подписка недавно истекла)' },
  { value: 'cluster', label: 'Клиенты одного кластера' },
];

const STATES = { scheduled:'В очереди', running:'Идёт отправка', sent:'Завершена', failed:'Ошибка отправки', cancelled:'Отменена' };
const terminal = new Set(['sent', 'failed', 'cancelled']);
function recent(job) {
  const date = Date.parse(job.finished_at || job.completed_at || job.updated_at || job.scheduled_for || job.created_at);
  return !Number.isFinite(date) || Date.now() - date < 86400000;
}

function Job({job}) {
  const c=job.counts || {}, stats=job.stats?.stats || job.stats || {};
  const time=value=>new Date(value).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  function channel(name,processed,total,details) {
    return <section className="broadcast-channel"><div className="row-between"><strong>{name}</strong><span>{total>0 && processed!=null ? Math.round(100*processed/total)+'%' : ''}</span></div>
      {total>0 && processed!=null && <progress aria-label={name} value={processed} max={total}/>}
      <small>{processed!=null && total!=null ? `Обработано ${processed} из ${total}. ` : ''}{details}</small></section>;
  }
  return <article className="broadcast-job"><header className="row"><strong className="badge">{STATES[job.status] || job.status}</strong><small>{new Date(job.created_at).toLocaleString('ru-RU')}</small></header>
    <p>{job.text?.replace(/<[^>]+>/g,'').split('\n')[0].slice(0,100)}</p>
    {job.status==='scheduled' && <small>Ожидает запуска{job.scheduled_for && ' с '+time(job.scheduled_for)}.</small>}
    {job.status==='running' && !Object.keys(c).length && <small>Бот начал обработку. Ожидаем первые счётчики.</small>}
    {job.channel!=='site' && (c.tg_total!=null || stats.success_count!=null) && channel('Telegram',c.tg_processed,c.tg_total,`Успешно: ${c.tg_sent ?? stats.success_count ?? 0}. Ошибок: ${c.tg_failed ?? stats.failed_count ?? 0}.`)}
    {job.channel!=='bot' && c.audience!=null && channel('Сайт',c.site_processed,c.audience,`Создано уведомлений: ${c.site_created ?? 0}.`)}
    {job.error_text && <p role="alert">{job.error_text}</p>}
  </article>;
}

export default function Broadcast() {
  useDocumentTitle('Рассылка');
  const toast = useToast();
  const confirm = useConfirm();
  const [link,setLink]=useState(null);
  const clusters = useLoad((signal) => api.get('/management/broadcast/clusters', null, { signal }).catch(() => null), []);
  const [form, setForm] = useState({ send_to: 'subscribed', channel: 'both', text: '', photo: '', cluster_name: '' });
  const [busy, setBusy] = useState(false);
  const editor = useRef(null);
  const sending = useRef(false);
  const [jobs, setJobs] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = jobs.filter(job => !terminal.has(job.status));
  const completed = jobs.filter(job => terminal.has(job.status) && recent(job));
  const [refresh, setRefresh] = useState(0);
  const [statusError, setStatusError] = useState('');
  useEffect(() => {
    if (!historyOpen) return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const options = {signal:controller.signal};
        const {items: rows} = await api.get('/portal/broadcast/recent',null,options);
        if (!controller.signal.aborted) { setJobs(rows); setLoaded(true); setStatusError(''); }
      } catch (error) { if (!controller.signal.aborted) setStatusError(error.message); }
      finally { if (!controller.signal.aborted) timer=setTimeout(poll,4000); }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  },[refresh, historyOpen]);
  function insert(field, before, after='', selected) {
    const start=field.selectionStart, end=field.selectionEnd;
    const value=selected ?? field.value.slice(start,end);
    field.setRangeText(before+value+after,start,end,'end');
    setForm(f=>({...f,text:field.value}));
    field.focus();
    field.setSelectionRange(start+before.length,start+before.length+value.length);
  }
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const clusterOptions = (Array.isArray(clusters.data) ? clusters.data : clusters.data?.clusters || []).map((c) => (typeof c === 'string' ? c : c.name || c.cluster_name)).filter(Boolean);

  const send = async () => {
    const audience = AUDIENCE.find((a) => a.value === form.send_to)?.label;
    if (!await confirm({ title: 'Запустить рассылку?', text: `Аудитория: ${audience}. Отменить отправку после запуска нельзя.`, confirmText: 'Отправить' })) return;
    if (sending.current) return;
    sending.current=true;
    setBusy(true);
    try {
      const {item} = await api.post('/management/broadcast/scheduled', {
        scheduled_for: new Date(Date.now()+30000).toISOString(),
        send_to: form.send_to, channel: form.channel, text: form.text,
        photo: form.photo.trim() || undefined,
        cluster_name: form.send_to === 'cluster' ? form.cluster_name : undefined,
        workers: 5, messages_per_second: 25,
      });
      setJobs(rows=>[item,...rows.filter(row=>row.id!==item.id)]);
      setHistoryOpen(true);
      setRefresh(value=>value+1);
      toast('Рассылка принята в очередь');
      setForm((f) => ({ ...f, text: '', photo: '' }));
    } catch (err) { toast.error(err); } finally { sending.current=false; setBusy(false); }
  };

  return <>
    <PageHead title="Рассылка" subtitle="Сообщение в Telegram-бот и/или в уведомления на сайте."
      actions={<Button variant="secondary" onClick={() => setHistoryOpen(true)}>Ход рассылки</Button>} />
    <Modal size="broadcast-history" open={historyOpen} onClose={() => setHistoryOpen(false)} title="Ход рассылки">
      {statusError && <p role="alert">Не удалось обновить статус: {statusError}</p>}
      {busy && <p role="status">Ставим рассылку в очередь…</p>}
        {active.length > 0 && <section><h3>Активные</h3>{active.map(job => <Job key={job.id} job={job}/>)}</section>}
        {completed.length > 0 && <section><h3>Результаты за сутки</h3>{completed.map(job => <Job key={job.id} job={job}/>)}</section>}
      {!active.length && !completed.length && !statusError && <p className="muted">{loaded ? 'Активных рассылок и результатов за последние сутки нет.' : 'Загружаем историю…'}</p>}
    </Modal>
    <div className="grid grid-main">
      <Card>
        <div className="stack">
          <Select label="Кому" value={form.send_to} onChange={set('send_to')} options={AUDIENCE} />
          {form.send_to === 'cluster' && <Select label="Кластер" value={form.cluster_name} onChange={set('cluster_name')}
            options={[{ value: '', label: 'Выберите кластер' }, ...clusterOptions.map((c) => ({ value: c, label: c }))]} />}
          <div className="field"><span className="field-label">Куда</span>
            <Segmented label="Канал" value={form.channel} onChange={set('channel')} options={[{ value: 'both', label: 'Бот и сайт' }, { value: 'bot', label: 'Только бот' }, { value: 'site', label: 'Только сайт' }]} />
          </div>
          <div className="row">{[['Жирный','b'],['Курсив','i'],['Подчёркнутый','u'],['Код','code'],['Цитата','blockquote'],['Зачёркнутый','s'],['Блок кода','pre']].map(([label,tag])=><Button key={tag} size="sm" variant="ghost" onClick={()=>insert(editor.current.querySelector('textarea'),'<'+tag+'>','</'+tag+'>')}>{label}</Button>)}</div>
          <Button size="sm" variant="secondary" onClick={()=>setLink('')}>Вставить ссылку</Button>
          {link!==null && <div className="inline-form"><Input label="Адрес ссылки" placeholder="https://…" value={link} onChange={e=>setLink(e.target.value)}/><Button disabled={!/^https?:\/\/[^\s<>"]+$/i.test(link)} onClick={()=>{
            const field=editor.current.querySelector('textarea');
            insert(field,'<a href="'+link.replaceAll('&','&amp;')+'">','</a>',field.value.slice(field.selectionStart,field.selectionEnd)||'Открыть');
            setLink(null);
          }}>Вставить</Button><Button variant="ghost" onClick={()=>setLink(null)}>Отмена</Button></div>}
          <div ref={editor}><Textarea label="Текст" onPaste={event=>{
            const html=event.clipboardData.getData('text/html');
            if (!html) return;
            const value=pastedBroadcast(html);
            if (value) { event.preventDefault(); insert(event.target,'','',value); }
          }} value={form.text} onChange={set('text')} rows={8} hint="В боте поддерживается HTML-разметка Telegram. Можно вставить форматированный текст или выделить фрагмент и нажать кнопку выше." /></div>
          <Input label="Картинка (необязательно)" value={form.photo} onChange={set('photo')} placeholder="https://… или file_id" />
          <Button busy={busy} disabled={busy || !form.text.trim() || (form.send_to === 'cluster' && !form.cluster_name)} onClick={send} icon="send" className="self-start">Запустить рассылку</Button>
        </div>
      </Card>
      <Card title="Предпросмотр">
        <div className="chat">
          <div className="msg"><div className="msg-bubble">{form.text ? <BroadcastText html={form.text}/> : <span className="muted">Здесь появится текст сообщения</span>}</div></div>
        </div>
        <p className="help-text" style={{ marginTop: 14 }}>Отправка идёт порциями (~25 сообщений в секунду), чтобы Telegram не ограничил бота. Большая рассылка может занять несколько минут.</p>
      </Card>
    </div>
  </>;
}
