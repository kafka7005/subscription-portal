import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Card, useConfirm } from '../ui/index.jsx';

const messages = {
  current: 'Установлена актуальная версия.',
  available: 'Доступна новая версия.',
  queued: 'В очереди на установку.',
  installing: 'Идёт установка и проверка после перезапуска.',
  offline: 'Проверьте службу обновления на сервере бота.',
  check_failed: 'Службе не удалось проверить репозиторий.',
  failed: 'Установка не выполнена. Проверьте журнал службы.',
  rolled_back: 'Предыдущая версия восстановлена.',
  recovery_failed: 'Автоматический откат требует вмешательства администратора сервера.',
};
const endpoint = '/portal/module-update';

export default function ModuleUpdates() {
  const confirm = useConfirm();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    let timer;
    async function read() {
      let delay = 10000;
      try {
        const data = await api.get(endpoint+'/status', null, {signal:c.signal});
        if (c.signal.aborted) return;
        setState(data);
        setError('');
        if (['queued','installing'].includes(data.phase)) delay = 2500;
      } catch (err) {
        if (c.signal.aborted) return;
        setError(err.status === 404 ? 'Для первого подключения установите модуль версии 1.7.0 и службу на сервере бота.' : 'Связь с модулем недоступна. Повторяем проверку.');
      }
      timer = setTimeout(read, delay);
    }
    read();
    return () => { c.abort(); clearTimeout(timer); };
  }, [refresh]);

  async function apply() {
    if (!await confirm({title:'Обновить модуль и перезапустить бота?', text:`Версия ${state.current} → ${state.latest}. Бот ненадолго прервёт работу. Служба сохранит копию и проверит установленную версию.`, confirmText:'Обновить и перезапустить'})) return;
    setBusy(true);
    try {
      setState(await api.post(endpoint+'/apply', {revision:state.revision, restart_confirmed:true}));
      setRefresh(n => n+1);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Card title="Модуль бота"><div className="stack">
    <p role="status">{error || messages[state?.phase] || 'Проверяем версию…'}</p>
    {state && <dl className="kv-list">
      <div className="kv-row"><dt>Установлена</dt><dd>{state.current}</dd></div>
      {state.latest && <div className="kv-row"><dt>В репозитории</dt><dd>{state.latest}</dd></div>}
    </dl>}
    {state?.notes && <details><summary>Что нового в версии {state.latest}</summary><p style={{whiteSpace:'pre-line'}}>{state.notes}</p></details>}
    {['available','failed','rolled_back'].includes(state?.phase) && <Button className="self-start" busy={busy} disabled={busy || Boolean(error)} onClick={apply}>Обновить модуль</Button>}
  </div></Card>;
}
