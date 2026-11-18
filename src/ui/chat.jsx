import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Icon, IconButton, Modal, useToast } from './index.jsx';
import { insertChatTemplate, readChatDraft, saveChatDraft } from '../lib/chatDrafts.js';

function toDate(v) {
  if (!v) return null;
  const s = String(v);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}
const time = (v) => toDate(v)?.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) || '';
function dayLabel(d) {
  const today = new Date(); const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Переписка обращения: загрузка, опрос раз в 10 секунд, ручное обновление и отправка.
// Отправленное сообщение показываем сразу («отправляется…»), а когда сервер его вернул —
// подменяем настоящим под тем же ключом, чтобы оно не мигало и не анимировалось второй раз.
export function useChatThread(loadUrl, postUrl, author) {
  const thread = useLoad((signal) => api.get(loadUrl, null, { signal }), [loadUrl]);
  const [pending, setPending] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const keyMap = useRef(new Map());
  useEffect(()=>{setPending([]);keyMap.current.clear();},[loadUrl]);

  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) thread.reload(true); }, 10000);
    const onFocus = () => thread.reload(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [thread.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const started = Date.now();
    await thread.reload(true);
    // Даже быстрый ответ показываем оборотом иконки — видно, что переписка обновилась.
    setTimeout(() => setRefreshing(false), Math.max(0, 500 - (Date.now() - started)));
  }, [thread.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async ({ body, attachments, internal, expected_agent_message_id }) => {
    const tmp = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author: internal ? 'note' : author, body, attachments: attachments || [],
      created_at: new Date().toISOString(), pending: true,
    };
    setPending((p) => [...p, tmp]);
    try {
      await api.post(postUrl, { body, attachments, internal: Boolean(internal), ...(expected_agent_message_id!==undefined?{expected_agent_message_id}:{}) });
      await thread.reload(true);
    } catch (err) {
      setPending((p) => p.filter((x) => x.id !== tmp.id));
      throw err;
    }
    setPending((p) => p.filter((x) => x.id !== tmp.id));
  }, [postUrl, author, thread.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const messages = useMemo(() => {
    const real = thread.data?.messages || [];
    const used = new Set(keyMap.current.values());
    const list = real.map((m) => {
      if (!keyMap.current.has(m.id)) {
        const p = pending.find((x) => !used.has(x.id) && x.author === m.author && (x.body || '') === (m.body || ''));
        if (p) { keyMap.current.set(m.id, p.id); used.add(p.id); }
      }
      return { ...m, _key: keyMap.current.get(m.id) || m.id };
    });
    return [...list, ...pending.filter((p) => !used.has(p.id)).map((p) => ({ ...p, _key: p.id }))];
  }, [thread.data, pending]);

  return { thread, messages, send, refresh, refreshing };
}

// Кнопка «Обновить» в шапке чата.
export function RefreshButton({ onClick, busy }) {
  return <button type="button" className={`icon-btn chat-refresh ${busy ? 'is-busy' : ''}`} onClick={onClick} disabled={busy}
    aria-label="Обновить переписку" title="Обновить переписку">
    <Icon name="refresh" size={18} />
  </button>;
}

const FAILED_HINT = 'Копия ответа не дошла клиенту в Telegram (обычно клиент заблокировал бота). В кабинете на сайте сообщение есть.';

// Лента сообщений. viewer: 'client' | 'agent' — чьи сообщения справа.
// При открытии сообщения проявляются каскадом, новые плавно въезжают; лента сама
// прокручивается вниз, если пользователь и так был внизу.
export function MessageList({ messages, viewer, onSaveTemplate, focusedId }) {
  const [photo, setPhoto] = useState(null);
  const ref = useRef(null);
  const atBottom = useRef(true);
  const firstPaint = useRef(true);
  const [intro, setIntro] = useState(true);
  const count = messages?.length || 0;
  useEffect(()=>{
    const el=ref.current;
    const target=focusedId&&el?.querySelector(`[data-message-id="${CSS.escape(focusedId)}"]`);
    if(!target)return;
    atBottom.current=false;
    el.scrollTo({top:el.scrollTop+target.getBoundingClientRect().top-el.getBoundingClientRect().top-el.clientHeight/2+target.clientHeight/2,behavior:'smooth'});
  },[focusedId]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !atBottom.current) return;
    if (firstPaint.current) { el.scrollTop = el.scrollHeight; if (count) firstPaint.current = false; return; }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [count]);
  useEffect(() => { const id = setTimeout(() => setIntro(false), 1000); return () => clearTimeout(id); }, []);
  const onScroll = () => {
    const el = ref.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  let lastDay = '';
  return <><div className={`chat ${intro ? 'is-intro' : ''}`} ref={ref} onScroll={onScroll}>
    {!count && <div className="chat-empty">Сообщений пока нет</div>}
    {(messages || []).map((m, idx) => {
      const d = toDate(m.created_at);
      const day = d ? d.toDateString() : '';
      const sep = day && day !== lastDay ? (lastDay = day, <div className="chat-day" key={`d-${day}`}><span>{dayLabel(d)}</span></div>) : null;
      const mine = viewer === 'agent' ? m.author === 'agent' || m.author === 'note' : m.author === 'client';
      const failed = viewer === 'agent' && m.author === 'agent' && m.delivery_status === 'failed';
      const order = Math.max(0, Math.min(12, count - 1 - idx));
      return [sep, <div key={m._key || m.id} data-message-id={m.id} style={{ '--i': order }}
        className={`msg ${mine ? 'msg-mine' : ''} ${m.author === 'note' ? 'msg-note' : ''} ${m.pending ? 'is-pending' : ''} ${m.id===focusedId?'is-focused':''}`}>
        {!mine && viewer === 'client' && m.author === 'agent' && <span className="msg-from">Поддержка Service Portal</span>}
        <div className="msg-bubble">
          {m.author === 'note' && <span className="msg-label">Заметка · видна только сотрудникам</span>}
          {m.deleted ? <em className="muted">Сообщение удалено</em> : m.body && <p>{m.body}</p>}
          {m.attachments?.length > 0 && <div className="msg-attachments">
            {m.attachments.map((url) => <button type="button" key={url} onClick={() => setPhoto(url)} aria-label="Открыть фото"><img src={url} alt="Вложение" loading="lazy" /></button>)}
          </div>}
          <span className="msg-time">
            {m.pending ? 'отправляется…' : time(m.created_at)}{m.edited_at ? ' · изм.' : ''}
            {failed && <span className="msg-tg-failed" title={FAILED_HINT}> · в Telegram не дошло</span>}
          </span>
        </div>
        {onSaveTemplate&&m.author==='agent'&&!m.pending&&!m.deleted&&m.body&&<button type="button" className="message-save-template" onClick={()=>onSaveTemplate(m.body)}>Сохранить как шаблон</button>}
      </div>];
    })}
  </div><Modal open={Boolean(photo)} onClose={() => setPhoto(null)} title="Фото из переписки" size="lg">{photo && <img className="support-photo-preview" src={photo} alt="Фото из переписки" />}</Modal></>;
}

// Поле ответа: растёт по мере ввода, Enter — отправить, Ctrl+Enter — новая строка, картинки — через /tickets/upload.
export function Composer({ onSend, placeholder = 'Сообщение…', allowNote = false, renderTemplates, draftKey, onTyping }) {
  const toast = useToast();
  const [initial]=useState(()=>{try{return readChatDraft(draftKey,window.localStorage);}catch{return {text:'',files:[],note:false};}});
  const [text, setText] = useState(initial.text);
  const [files, setFiles] = useState(initial.files);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(allowNote&&initial.note);
  const [draftStatus,setDraftStatus]=useState('');
  const selection=useRef(null);
  const draftRef=useRef(null);
  draftRef.current={text,files,note};
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const fileRef = useRef(null);
  const areaRef = useRef(null);
  const writeDraft=useCallback(()=>{
    try{return saveChatDraft(draftKey,draftRef.current,window.localStorage);}catch{return false;}
  },[draftKey]);
  useEffect(()=>{
    if(!draftKey)return;
    setDraftStatus('saving');
    const id=setTimeout(()=>setDraftStatus(writeDraft()?'saved':'error'),300);
    return()=>clearTimeout(id);
  },[text,files,note,draftKey,writeDraft]);
  useEffect(()=>{
    if(!draftKey)return;
    const flush=()=>writeDraft();
    window.addEventListener('pagehide',flush);
    return()=>{window.removeEventListener('pagehide',flush);flush();};
  },[draftKey,writeDraft]);
  const changeText=value=>{setText(value);onTyping?.();};
  const rememberSelection=e=>{selection.current={start:e.currentTarget.selectionStart,end:e.currentTarget.selectionEnd};};

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [text]);

  const upload = async (list) => {
    setUploading(true);
    try {
      for (const file of list) {
        const form = new FormData();
        form.append('file', file);
        const res = await api.post('/tickets/upload', form);
        setFiles((f) => [...f, res.url]);
      }
    } catch (err) { toast.error(err); } finally { setUploading(false); }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if ((!text.trim() && !files.length) || sending || uploading) return;
    setSending(true);
    try {
      await onSend({ body: text.trim(), attachments: files.length ? files : undefined, internal: note });
      draftRef.current={text:'',files:[],note:false};writeDraft();selection.current=null;
      setText(''); setFiles([]); setNote(false);
      areaRef.current?.focus();
    } catch (err) { toast.error(err); } finally { setSending(false); }
  };

  const canSend = (text.trim() || files.length) && !uploading;
  // Enter — отправить; Ctrl/Shift+Enter — перенос строки (как в мессенджерах).
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget; const { selectionStart: a, selectionEnd: b } = el;
      const next = `${text.slice(0, a)}\n${text.slice(b)}`;
      if(next.length>4000)return;
      changeText(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 1; });
      return;
    }
    if (e.shiftKey) return;
    e.preventDefault();
    submit(e);
  };
  const insertTemplate = (reply) => {
    const inserted=insertChatTemplate(text,reply.body,selection.current);
    if(!inserted)return false;
    changeText(inserted.text);setTemplatesOpen(false);
    selection.current={start:inserted.caret,end:inserted.caret};
    requestAnimationFrame(()=>{areaRef.current?.focus();areaRef.current?.setSelectionRange(inserted.caret,inserted.caret);});
    return true;
  };
  return <><form className={`composer ${note ? 'is-note' : ''}`} onSubmit={submit}
    onPaste={(e) => { const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/')); if (imgs.length) upload(imgs); }}>
    {(allowNote || renderTemplates) && <div className="composer-tools">
      {allowNote && <button type="button" disabled={sending} className={`tool-chip ${note ? 'is-on' : ''}`} onClick={() => setNote((v) => !v)}><Icon name="file" size={14} />Заметка</button>}
      {renderTemplates&&<button type="button" className="tool-chip" disabled={sending} aria-haspopup="dialog" onClick={()=>setTemplatesOpen(true)}><Icon name="file" size={14}/>Шаблоны</button>}
    </div>}
    {files.length > 0 && <div className="composer-files">
      {files.map((url) => <span key={url} className="composer-file"><img src={url} alt="" />
        <button type="button" aria-label="Убрать" disabled={sending} onClick={() => setFiles((f) => f.filter((x) => x !== url))}><Icon name="x" size={12} /></button></span>)}
    </div>}
    <div className="composer-row">
      <div className="composer-field">
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
        <IconButton icon="paperclip" label="Прикрепить картинку" onClick={() => fileRef.current?.click()} disabled={uploading||sending} />
        <textarea ref={areaRef} rows={1} disabled={sending} maxLength={4000} value={text} onChange={(e) => changeText(e.target.value)} onSelect={rememberSelection} onBlur={rememberSelection}
          placeholder={note ? 'Заметка для сотрудников…' : placeholder}
          onKeyDown={onKeyDown} />
      </div>
      <button type="submit" className="send-btn" disabled={!canSend || sending} aria-label="Отправить" title="Отправить (Enter)">
        {sending || uploading ? <span className="spinner spinner-sm" /> : <Icon name="send" size={19} />}
      </button>
    </div>
    <p className="composer-hint">Enter — отправить · Ctrl+Enter — новая строка</p>
    {draftKey&&(text||files.length>0)&&<p className="composer-hint composer-draft-status" role="status">{draftStatus==='error'?'Не удалось сохранить черновик на устройстве':draftStatus==='saved'?'Черновик сохранён на этом устройстве':'Сохраняем черновик…'}</p>}
  </form>{templatesOpen&&renderTemplates?.({onPick:insertTemplate,onClose:()=>setTemplatesOpen(false)})}</>;
}
