import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, dateTime, devices as devicesText, remaining, rub, subscriptionStatus } from '../lib/format.js';
import { cleanName } from '../lib/tariffs.js';
import { Badge, Button, Card, CopyField, Empty, ErrorBox, Icon, IconButton, Input, KeyValue, Modal, PageHead, Spinner, useConfirm, useToast } from '../ui/index.jsx';
import { subscriptionUrl } from './Home.jsx';
import SubscriptionQr from './SubscriptionQr.jsx';
import AddonsModal from './AddonsModal.jsx';
import { useDeviceActions } from './deviceActions.js';

const enc = encodeURIComponent;

function deviceName(d) {
  return d.device_model || d.platform || 'Устройство';
}

function RenameModal({ open, onClose, sub, onSaved }) {
  const [alias, setAlias] = useState(sub?.alias || '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) setAlias(sub?.alias || ''); }, [open, sub]);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/keys/${enc(sub.client_id)}/alias`, { alias: alias.trim() });
      toast('Название сохранено'); onSaved(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Название подписки" size="sm">
    <form className="stack" onSubmit={save}>
      <Input label="Название" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} placeholder="Например, «Семья» или «Работа»" autoFocus />
      <Button type="submit" busy={busy} className="btn-block">Сохранить</Button>
    </form>
  </Modal>;
}

// Докупка устройств к действующей подписке (если включено в боте).
function LocationModal({ open, onClose, sub }) {
  const toast = useToast();
  const locations = useLoad((signal) => (open ? api.get(`/keys/${enc(sub.client_id)}/locations`, { force_web: true }, { signal }) : null), [open]);
  const [busy, setBusy] = useState(null);
  const change = async (server) => {
    setBusy(server);
    try {
      const res = await api.post(`/keys/${enc(sub.client_id)}/change-location`, { server_name: server }, { query: { force_web: true } });
      toast(res.message || 'Локация изменена'); onClose(true);
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  return <Modal open={open} onClose={() => onClose(false)} title="Сменить локацию" size="sm">
    {locations.loading ? <Spinner /> : locations.error ? <ErrorBox error={locations.error} /> : <div className="stack">
      <p className="muted">После смены обновите подписку в приложении (потяните список вниз или нажмите «Обновить»).</p>
      {(locations.data?.locations || []).map((l) => <button key={l.server_name} type="button" className="provider-option"
        aria-checked={l.server_name === locations.data.current_server} onClick={() => change(l.server_name)} disabled={busy}>
        <span className="radio-dot" aria-hidden="true" /><span>{l.server_name}</span>
        {busy === l.server_name && <span className="spinner spinner-sm" style={{ marginLeft: 'auto' }} />}
      </button>)}
    </div>}
  </Modal>;
}

export default function Subscription() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { config } = useAuth();
  const details = useLoad((signal) => api.get(`/keys/${enc(clientId)}/details`, null, { signal }), [clientId]);
  const keys = useLoad((signal) => api.get('/keys', null, { signal }), []);
  const connection = useLoad((signal) => api.get(`/keys/${enc(clientId)}/connection`, null, { signal }).catch(() => null), [clientId]);
  const devicesState = useLoad((signal) => api.get(`/keys/${enc(clientId)}/devices`, { force_web: true }, { signal }).catch(() => ({ devices: [], total: 0, unavailable: true })), [clientId]);
  const actionsCfg = useLoad((signal) => api.get('/keys/actions-config', null, { signal }).catch(() => ({})), []).data || {};
  const [modal, setModal] = useState(null);
  const sub = keys.data?.find((k) => k.client_id === clientId);
  const d = details.data;
  const actions = sub?.actions || {};
  useDocumentTitle(d?.alias || 'Подписка');
  const deviceActions = useDeviceActions(clientId, { toast, confirm, onChanged: () => devicesState.reload(true) });

  if (details.loading && !d) return <Spinner />;
  if (details.error && !d) return <><PageHead back="/cabinet" title="Подписка" /><ErrorBox error={details.error} onRetry={details.reload} /></>;

  const status = subscriptionStatus(d);
  const left = remaining(d.expiry_time);
  const devices = devicesState.data?.devices || [];
  const list = devicesState.data;
  const used = !list?.unavailable && Array.isArray(list?.devices) ? list.devices.length
    : connection.data?.connected_devices ?? null;
  const full = d.device_limit > 0 && used != null && used >= d.device_limit;
  const online = connection.data?.is_online;
  const showDevices = () => {
    setModal(null);
    requestAnimationFrame(() => document.getElementById('subscription-device-list')?.focus());
  };
  const reloadAll = () => { details.reload(true); keys.reload(true); devicesState.reload(true); connection.reload(true); };

  const canUnbind =!deviceActions.blocked && actions.can_reset_hwid !== false && actionsCfg.hwid_reset_enabled !== false && config?.features?.hwid_reset_enabled !== false;
  const removeDevice = (dev) => deviceActions.removeOne(dev, deviceName(dev));
  const deleteSub = async () => {
    if (!await confirm({ title: 'Удалить подписку?', text: 'Подписка будет удалена без возврата средств. Это действие нельзя отменить.', confirmText: 'Удалить навсегда', danger: true })) return;
    try { await api.del(`/keys/${enc(clientId)}`); toast('Подписка удалена'); navigate('/cabinet', { replace: true }); } catch (err) { toast.error(err); }
  };

  return <>
    <PageHead back="/cabinet" title={d.alias || cleanName(d.tariff_name) || 'Подписка'}
      subtitle={<span className="row"><Badge tone={status.tone}>{status.label}</Badge><span>{left.expired ? `закончилась ${date(d.expiry_time)}` : `до ${date(d.expiry_time)} · ${left.text}`}</span></span>}
      actions={<>
        <SubscriptionQr clientId={clientId} enabled={actionsCfg.qr_enabled === true} />
        {!left.expired && !d.is_frozen && subscriptionUrl(sub) && <Button icon="device" href={subscriptionUrl(sub)} target="_blank" rel="noopener noreferrer">Подключить</Button>}
        {d.can_renew !== false && actionsCfg.renew_enabled !== false && <Button variant="secondary" icon="refresh" to={`/cabinet/buy?renew=${enc(clientId)}`}>Продлить</Button>}
      </>} />

    {d.is_frozen && <div className="notice notice-warn">Подписка заморожена. Напишите в поддержку, если это неожиданно.</div>}

    <div className="grid grid-main">
      <Card id="subscription-device-list" tabIndex={-1} title={`Устройства${d.device_limit ? ` · ${used ?? '—'} из ${d.device_limit}` : ''}`}
        actions={<>
          {d.addons_devices_enabled && actionsCfg.addons_enabled !== false && <Button variant="secondary" size="sm" icon="plus" onClick={() => setModal('addons')}>Добавить</Button>}
        </>}>
        {deviceActions.blocked && <div className="hint-box" style={{ marginBottom: 12 }}><Icon name="clock" /><p>{deviceActions.blocked}</p></div>}
        {devicesState.loading && !devicesState.data ? <Spinner /> : devices.length === 0
          ? <Empty icon="device" title={devicesState.data?.unavailable ? 'Список устройств недоступен' : 'Устройств пока нет'}
            text={devicesState.data?.unavailable ? 'Попробуйте обновить страницу позже.' : 'Устройство появится здесь, когда вы подключитесь в приложении.'}
            action={!left.expired && subscriptionUrl(sub) && <Button size="sm" href={subscriptionUrl(sub)} target="_blank" rel="noopener noreferrer">Как подключить</Button>} />
          : <ul className="device-list">
            {devices.map((dev) => <li key={dev.hwid}>
              <span className="device-icon"><Icon name="device" /></span>
              <div className="cell-main">
                <strong>{deviceName(dev)}</strong>
                <span>{[dev.platform, dev.os_version].filter(Boolean).join(' ')}{dev.created_at ? ` · с ${dateTime(dev.created_at)}` : ''}</span>
              </div>
              {canUnbind && <IconButton icon="trash" label="Отвязать устройство" onClick={() => removeDevice(dev)} />}
            </li>)}
          </ul>}
      </Card>

      <div className="stack" style={{ gap: 18 }}>
        <Card title="Подробности" actions={<IconButton icon="refresh" label="Обновить" onClick={reloadAll} />}>
          <KeyValue items={[
            ['Тариф', cleanName(d.tariff_name) || '—'],
            ['Действует до', date(d.expiry_time)],
            ['Устройств', d.device_limit || '—'],
            ['Трафик', d.traffic_limit_gb ? `${d.used_traffic_gb ?? 0} из ${d.traffic_limit_gb} ГБ` : `${d.used_traffic_gb != null ? `${Number(d.used_traffic_gb).toFixed(1)} ГБ · ` : ''}без ограничений`],
            connection.data?.server_name && ['Локация', connection.data.server_name],
            connection.data && ['Статус', online == null ? 'Нет данных' : online ? <Badge tone="ok">В сети</Badge> : <Badge tone="muted">Не в сети</Badge>],
          ]} />
        </Card>
        {subscriptionUrl(sub) && <Card title="Ссылка подписки">
          <div className="stack">
            <CopyField value={subscriptionUrl(sub)} />
            <p className="field-hint">По ссылке — инструкция для вашего устройства и кнопки добавления в приложение. Ссылку можно вставить в приложение вручную.</p>
          </div>
        </Card>}
        <Card title="Настройки">
          <div className="action-list">
            <button type="button" onClick={() => setModal('rename')}><Icon name="tag" /><span>Переименовать</span><Icon name="arrow" size={16} /></button>
            {actions.can_change_location && actionsCfg.country_change_enabled !== false && config?.features?.country_selection_enabled && <button type="button" onClick={() => setModal('location')}><Icon name="globe" /><span>Сменить локацию</span><Icon name="arrow" size={16} /></button>}
            <button type="button" onClick={() => setModal('diagnostics')}><Icon name="help" /><span>Не удаётся подключиться?</span><Icon name="arrow" size={16} /></button>
            {actions.can_delete && actionsCfg.delete_enabled !== false && <button type="button" className="danger" onClick={deleteSub}><Icon name="trash" /><span>Удалить подписку</span><Icon name="arrow" size={16} /></button>}
          </div>
        </Card>
      </div>
    </div>

    <Modal open={modal === 'diagnostics'} onClose={() => setModal(null)} title="Проверка подключения">
      <div className="stack">
        <KeyValue items={[
          ['Подписка', status.label], ['Действует до', dateTime(d.expiry_time)],
          ['Сейчас в сети', online == null ? 'Нет данных' : online ? 'Да' : 'Нет'],
          connection.data?.online_at && ['Последняя активность', dateTime(connection.data.online_at)],
          ['Привязано устройств', used ?? 'Нет данных'],
          ['Мест в подписке', d.device_limit == null ? 'Нет данных' : d.device_limit || 'Без ограничения'],
        ]} />
        <p>{d.is_frozen ? 'Подписка заморожена. Уточните условия активации в поддержке.'
          : left.expired ? 'Срок подписки закончился. Для подключения её нужно продлить.'
          : full ? 'Все места заняты. Проверьте список устройств перед подключением нового.'
          : 'Откройте приложение, обновите подписку и попробуйте подключиться ещё раз.'}</p>
        {full && <Button variant="secondary" icon="device" onClick={showDevices}>Посмотреть устройства</Button>}
        {config?.features?.support_tickets_enabled !== false && <Button icon="chat" to={`/cabinet/support?ref=${enc(clientId)}`}>Написать в поддержку</Button>}
      </div>
    </Modal>
    <RenameModal open={modal === 'rename'} sub={d} onClose={() => setModal(null)} onSaved={reloadAll} />
    {modal === 'addons' && <AddonsModal open sub={d} onClose={(changed) => { setModal(null); if (changed) reloadAll(); }} />}
    {modal === 'location' && <LocationModal open sub={d} onClose={(changed) => { setModal(null); if (changed) reloadAll(); }} />}
  </>;
}
