import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime, relative } from '../lib/format.js';
import { Badge, Button, Card, Empty, ErrorBox, Icon, Loadable, useConfirm, useToast } from '../ui/index.jsx';

export default function SessionsCard() {
  const state = useLoad((signal) => api.get('/auth/sessions', null, { signal }), []);
  const [busy, setBusy] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();
  const revoke = async (session) => {
    if (busy || !await confirm({ title: session ? 'Завершить этот сеанс?' : 'Выйти на других устройствах?', text: session ? `Для «${session.device_label || 'Браузер или приложение'}» потребуется повторный вход. VPN-устройства подписки не отвязываются.` : 'Остальные сеансы сайта и приложения будут завершены. Текущий вход сохранится.', confirmText: 'Завершить', danger: true })) return;
    setBusy(session?.id || 'others');
    try {
      if (session) await api.del(`/auth/sessions/${encodeURIComponent(session.id)}`);
      else await api.post('/auth/sessions/revoke-others');
      toast('Сеансы обновлены'); await state.reload();
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  return <Card title="Входы на сайт и в приложение" actions={<div className="row">
    <Button size="sm" variant="ghost" icon="refresh" busy={state.loading} disabled={busy != null} onClick={() => state.reload()}>Обновить</Button>
    <Button size="sm" variant="ghost" disabled={busy != null || !state.data?.sessions?.some((s) => !s.is_current)} onClick={() => revoke(null)}>Завершить остальные</Button>
  </div>}>
    {state.error && state.data && <ErrorBox error={state.error} onRetry={state.reload} />}
    <Loadable state={state}>{(data) => data.sessions?.length ? <ul className="device-list">{data.sessions.map((s) => <li key={s.id}>
      <span className="device-icon"><Icon name="device" /></span>
      <div className="cell-main"><strong>{s.device_label || 'Браузер или приложение'} {s.is_current && <Badge tone="ok">Текущий вход</Badge>}</strong>
        <span>{s.ip || 'IP не указан'} · активность {relative(s.last_seen_at)}</span>
        <span>Вход: {dateTime(s.created_at)} · действует до {dateTime(s.expires_at)}</span>
      </div>
      {!s.is_current && <Button size="sm" variant="ghost" busy={busy === s.id} disabled={busy != null || state.loading} onClick={() => revoke(s)}>Завершить</Button>}
    </li>)}</ul> : <Empty icon="device" title="Сеансов нет" />}</Loadable>
    <p className="field-hint">Здесь входы в аккаунт. Подключённые к VPN устройства управляются отдельно в карточке подписки.</p>
  </Card>;
}
