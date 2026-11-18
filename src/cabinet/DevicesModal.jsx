import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/hooks.js';
import { dateTime, devices as devicesText } from '../lib/format.js';
import { useState } from 'react';
import { Button, Empty, Icon, IconButton, Modal, Spinner, useConfirm, useToast } from '../ui/index.jsx';
import AddonsModal from './AddonsModal.jsx';
import { useDeviceActions } from './deviceActions.js';

const enc = encodeURIComponent;
const deviceName = (d) => d.device_model || d.platform || 'Устройство';

// Устройства подписки: список, отвязка по одному и всех сразу (если включено в боте).
export default function DevicesModal({ sub, onClose, actions }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { config } = useAuth();
  const [addons, setAddons] = useState(false);
  const open = Boolean(sub) && !addons;
  const state = useLoad((signal) => (sub ? api.get(`/keys/${enc(sub.client_id)}/devices`, { force_web: true }, { signal }) : null), [sub?.client_id]);
  const details = useLoad((signal) => (sub ? api.get(`/keys/${enc(sub.client_id)}/details`, null, { signal }).catch(() => null) : null), [sub?.client_id]);
  const canUnbind = config?.features?.hwid_reset_enabled !== false && actions?.hwid_reset_enabled !== false;
  const list = state.data?.devices || [];
  const limit = details.data?.device_limit;

  const { removeOne, blocked } = useDeviceActions(sub?.client_id, {
    toast, confirm, onChanged: () => { state.reload(true); details.reload(true); },
  });
  const unbind = canUnbind && !blocked;

  if (addons && sub) return <AddonsModal open sub={{ ...sub, device_limit: limit }} onClose={(changed) => { setAddons(false); if (changed) { state.reload(true); details.reload(true); } }} />;
  return <Modal open={open} onClose={onClose} title={limit ? `Устройства · ${list.length} из ${limit}` : 'Устройства'}
    footer={<>
      {sub && details.data?.addons_devices_enabled && actions?.addons_enabled !== false && <Button variant="secondary" icon="plus" onClick={() => setAddons(true)}>Добавить места</Button>}
    </>}>
    {state.loading && !state.data ? <Spinner /> : list.length === 0
      ? <Empty icon="device" title="Устройств пока нет" text="Устройство появится здесь после первого подключения в приложении." />
      : <ul className="device-list">
        {list.map((d) => <li key={d.hwid}>
          <span className="device-icon"><Icon name="device" /></span>
          <div className="cell-main">
            <strong>{deviceName(d)}</strong>
            <span>{[d.platform, d.os_version].filter(Boolean).join(' ')}{d.created_at ? ` · с ${dateTime(d.created_at)}` : ''}</span>
          </div>
          {unbind && <IconButton icon="trash" label="Отвязать" onClick={() => removeOne(d, deviceName(d))} />}
        </li>)}
      </ul>}
    {blocked && <div className="hint-box"><Icon name="clock" /><p>{blocked}</p></div>}
    {limit ? <p className="field-hint">По подписке можно подключить {devicesText(limit)} одновременно.</p> : null}
  </Modal>;
}
