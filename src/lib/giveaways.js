import { useEffect, useState } from 'react';
import { api } from './api.js';

export const giveaways = '/portal/giveaways';
export const states = { draft:'Черновик', publishing:'Публикация', active:'Идёт приём заявок', checking:'Проверка участников', insufficient:'Недостаточно участников', finished:'Завершён', cancelled:'Отменён' };

export function useGiveawayConfig() {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let controller;
    const read = (event) => {
      if (event?.type==='giveaway-config' && typeof event.detail?.enabled==='boolean') {
        setValue(v=>v ? {...v,enabled:event.detail.enabled} : v);
      }
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      api.get(giveaways+'/config', null, {signal}).then(data => { if (!signal.aborted) setValue(data); })
        .catch(() => { if (!signal.aborted) setValue(null); });
    };
    read();
    const timer = setInterval(() => { if (!document.hidden) read(); }, 60000);
    window.addEventListener('focus',read);
    window.addEventListener('giveaway-config',read);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus',read); window.removeEventListener('giveaway-config',read); };
  }, []);
  return value;
}
