import { useState } from 'react';
import { ApiError, api } from '../lib/api.js';

const enc = encodeURIComponent;

// Отвязка устройств — только по одному и строго по правилам бота:
//  • без force_web, чтобы бот сам проверял тумблер «Сброс HWID»;
//  • бот ограничивает частоту (HWID_DELETE_COOLDOWN: штраф за каждое удаление,
//    восстановление по дням). На 429 показываем его сообщение и прячем кнопки.
export function useDeviceActions(clientId, { toast, confirm, onChanged }) {
  const [blocked, setBlocked] = useState('');

  const handle = (err) => {
    if (err instanceof ApiError && (err.status === 429 || err.status === 403)) setBlocked(err.message);
    else toast.error(err);
  };

  const removeOne = async (device, name) => {
    if (!await confirm({
      title: 'Отвязать устройство?',
      text: `${name} потеряет доступ, место освободится для другого устройства. Отвязывать устройства часто нельзя — бот временно ограничивает частые удаления.`,
      confirmText: 'Отвязать', danger: true,
    })) return;
    try {
      await api.post(`/keys/${enc(clientId)}/devices/delete`, undefined, { query: { hwid: device.hwid } });
      toast('Устройство отвязано');
      onChanged?.();
    } catch (err) { handle(err); }
  };

  return { removeOne, blocked };
}
