import { useEffect, useState } from 'react';
import { dateTime } from '../lib/format.js';
import { Button, Card } from '../ui/index.jsx';

const labels = {
  current: 'Установлена актуальная версия', available: 'Доступно обновление',
  queued: 'Обновление в очереди', installing: 'Сборка и установка…',
  failed: 'Не удалось установить обновление', check_failed: 'Не удалось проверить источник обновлений',
};

export function UpdateNotice() {
  const [available,setAvailable]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    async function check() {
      if (document.hidden) return;
      try {
        const r=await fetch('/_site-update/status',{cache:'no-store',signal:controller.signal});
        const data=r.ok && r.headers.get('content-type')?.includes('application/json') ? await r.json() : null;
        setAvailable(data?.phase==='available' || data?.phase==='failed');
      } catch { if (!controller.signal.aborted) setAvailable(false); }
    }
    check();
    const timer=setInterval(check,180000);
    window.addEventListener('focus',check);
    return ()=>{ clearInterval(timer); controller.abort(); window.removeEventListener('focus',check); };
  },[]);
  return available ? <Button size="sm" variant="secondary" icon="refresh" to="/admin/site?tab=updates">Обновление сайта</Button> : null;
}

export default function SiteUpdates() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function read() {
      try {
        const r = await fetch('/_site-update/status', { cache:'no-store', signal:controller.signal });
        if ([401,403].includes(r.status)) throw Error('Требуется действующая сессия администратора.');
        if (!r.ok || !r.headers.get('content-type')?.includes('application/json')) throw Error('Служба обновлений недоступна. Проверьте подключение службы на сервере сайта.');
        const data = await r.json();
        if (!labels[data.phase]) throw Error('Неизвестный ответ службы обновлений.');
        setState(data); setError('');
        timer = setTimeout(read, ['queued','installing','available'].includes(data.phase) ? 4000 : 15000);
      } catch (e) {
        if (!controller.signal.aborted) { setError(e.message); timer=setTimeout(read,15000); }
      }
    }
    read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  async function apply() {
    setSending(true);
    try {
      const r=await fetch('/_site-update/apply',{method:'POST',headers:{'X-Portal-Update':'1'}});
      if (!r.ok && r.status!==409) throw Error('Сервер не подтвердил запуск. Проверьте состояние службы.');
      setState(await r.json()); setError('');
    } catch(e) { setError(e.message); }
    finally { setSending(false); }
  }
  const canUpdate = ['available','failed'].includes(state?.phase);
  return <Card title="Обновления сайта"><div className="stack">
    <p role="status">{error || labels[state?.phase] || 'Проверяем версию…'}</p>
    {state && <dl className="kv-list">
      <div className="kv-row"><dt>Установлена</dt><dd>{state.current?.slice(0,8) || 'Версия не записана'}</dd></div>
      <div className="kv-row"><dt>В репозитории</dt><dd>{state.latest?.slice(0,8) || '—'}</dd></div>
      <div className="kv-row"><dt>Последняя проверка</dt><dd>{dateTime(state.checked)}</dd></div>
    </dl>}
    {state?.latest && <section className="stack" aria-label="Что нового">
      <h3>Что нового</h3>
      {!state.notes ? <p className="muted">Чтобы получать описания версий, обновите службу проверки на сервере по инструкции в репозитории.</p>
        : state.notes.scope === 'unavailable' ? <p className="muted">Не удалось прочитать описание этой версии.</p>
        : <>
          {state.notes.scope === 'latest' && <p className="muted">Установленную версию определить не удалось. Показано последнее описание.</p>}
          {state.notes.scope === 'installed' && <small className="muted">В установленной версии</small>}
          {state.notes.items.length === 0 && <p className="muted">Отдельного описания изменений для этой версии пока нет.</p>}
          {state.notes.items.map((note, i) => <details key={note.id} open={i === 0}>
            <summary><strong>{note.title}</strong></summary>
            <ul>{note.changes.map(s => <li key={s}>{s}</li>)}</ul>
            <strong>Как проверить</strong>
            <ol>{note.verify.map(s => <li key={s}>{s}</li>)}</ol>
          </details>)}
        </>}
    </section>}
    {canUpdate && <Button className="self-start" busy={sending} disabled={sending || Boolean(error)} onClick={apply}>
      {state.phase === 'failed' ? 'Повторить обновление' : 'Обновить сайт'}
    </Button>}
    {state?.phase==='current' && <Button className="self-start" variant="secondary" onClick={()=>window.location.reload()}>Перезагрузить страницу</Button>}
  </div></Card>;
}
