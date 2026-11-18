import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Card, ErrorBox, Loadable, Toggle, useToast } from '../ui/index.jsx';

const CATEGORIES = [
  ['portal_push_support', 'Ответы поддержки', 'Сообщения по вашим обращениям.'],
  ['portal_push_subscriptions', 'Подписки', 'Окончание срока, создание и продление подписки.'],
  ['portal_push_payments', 'Платежи', 'Оплаты и уведомления об автосписаниях.'],
];
export default function NotificationPreferences() {
  const state = useLoad((signal) => api.get('/auth/me/notification-prefs', null, { signal }), []);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const save = async (channel, enabled) => {
    if (busy) return;
    setBusy(channel);
    try { state.setData(await api.put('/auth/me/notification-prefs', { channels: [{channel, enabled}] })); toast('Настройки уведомлений сохранены'); }
    catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  return <Card title="Какие push-уведомления получать" className="notification-preferences">
    <p className="field-hint">Настройки действуют для сайта и PWA на устройствах аккаунта. Все события остаются в колокольчике. Telegram и системные сообщения сохраняют текущую логику.</p>
    {state.error && state.data && <ErrorBox error={state.error} onRetry={state.reload} />}
    <Loadable state={state}>{(data) => <div className="setting-list">{CATEGORIES.map(([key,title,hint]) => <div className="setting-row" key={key}>
      <div className="setting-text"><strong>{title}</strong><span className="setting-hint">{hint}</span></div>
      <Toggle label={<span className="sr-only">{title}</span>} checked={data.channels?.find((p) => p.channel === key)?.enabled !== false} disabled={busy != null || Boolean(state.error)} onChange={(value) => save(key,value)} />
    </div>)}</div>}</Loadable>
  </Card>;
}
