import ConfirmedOperation from './ConfirmedOperation.jsx';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, dateTime, remaining, subscriptionStatus } from '../lib/format.js';
import { cleanName } from '../lib/tariffs.js';
import { Badge, Button, Card, CopyField, Empty, ErrorBox, IconButton, Input, KeyValue, Modal, PageHead, Segmented, Select, Spinner, useConfirm, useToast } from '../ui/index.jsx';

const enc = encodeURIComponent;

function ExpiryModal({ open, onClose, sub, onDone }) {
  const toast = useToast();
  const [op, setOp] = useState('add');
  const [daysValue, setDaysValue] = useState('30');
  const [dateValue, setDateValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDateValue(new Date(Math.max(Date.now(), sub.expiry_time)).toISOString().slice(0, 10));
  }, [open, sub]);
  const submit = async () => {
    setBusy(true);
    try {
      const body = op === 'set' ? { op, date_ms: new Date(`${dateValue}T23:59:00`).getTime() } : { op, days: Number(daysValue) };
      await api.post(`/admin/subscriptions/${enc(sub.client_id)}/expiry`, body);
      toast('Срок изменён'); onDone(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Изменить срок" size="sm" footer={<Button busy={busy} onClick={submit}>Применить</Button>}>
    <p className="muted">Сейчас до {date(sub.expiry_time)}. Трафик при этом не сбрасывается.</p>
    <Segmented label="Действие" value={op} onChange={setOp} options={[{ value: 'add', label: 'Добавить' }, { value: 'take', label: 'Убавить' }, { value: 'set', label: 'Точная дата' }]} />
    {op === 'set'
      ? <Input label="Действует до" type="date" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
      : <>
        <Input label="Дней" type="number" min="1" value={daysValue} onChange={(e) => setDaysValue(e.target.value)} />
        <div className="chips">{[1, 3, 7, 30, 90].map((n) => <button key={n} type="button" className="chip" onClick={() => setDaysValue(String(n))}>{n} дн</button>)}</div>
      </>}
  </Modal>;
}

function LimitsModal({ open, onClose, sub, onDone }) {
  const toast = useToast();
  const [devices, setDevices] = useState('');
  const [traffic, setTraffic] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDevices(sub.device_limit ?? ''); setTraffic(sub.traffic_limit ?? ''); } }, [open, sub]);
  const submit = async () => {
    setBusy(true);
    try {
      const body = {};
      if (String(devices) !== String(sub.device_limit ?? '')) body.device_limit = devices === '' ? 0 : Number(devices);
      if (String(traffic) !== String(sub.traffic_limit ?? '')) body.traffic_limit = traffic === '' ? 0 : Number(traffic);
      if (!Object.keys(body).length) { onClose(); return; }
      await api.post(`/admin/subscriptions/${enc(sub.client_id)}/set-limits`, body);
      toast('Лимиты обновлены'); onDone(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Лимиты" size="sm" footer={<Button busy={busy} onClick={submit}>Сохранить</Button>}>
    <Input label="Устройств" type="number" min="0" value={devices} onChange={(e) => setDevices(e.target.value)} hint="0 — без ограничения" />
    <Input label="Трафик, ГБ" type="number" min="0" value={traffic} onChange={(e) => setTraffic(e.target.value)} hint="0 — без ограничения" />
  </Modal>;
}

function TariffModal({ open, onClose, sub, onDone }) {
  const [tariffId, setTariffId] = useState('');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (open) { setTariffId(String(sub.tariff_id || sub.tariffs?.[0]?.id || '')); setConfirming(false); } }, [open, sub]);
  if (confirming) return <ConfirmedOperation kind="tariff" target={sub.client_id} payload={{tariff_id:Number(tariffId)}}
    onClose={() => setConfirming(false)} onDone={() => { onDone(); onClose(); }} />;
  return <Modal open={open} onClose={onClose} title="Сменить тариф" size="sm" footer={<Button disabled={!tariffId || Number(tariffId)===Number(sub.tariff_id)} onClick={() => setConfirming(true)}>Проверить изменения</Button>}>
    <p className="muted">Меняются лимиты тарифа; срок подписки остаётся прежним.</p>
    <Select label="Тариф" value={tariffId} onChange={(e) => setTariffId(e.target.value)}
      options={(sub.tariffs || []).map((t) => ({ value:String(t.id), label:`${cleanName(t.name)} · ${t.group_code} · ${t.duration_days} дн` }))} />
  </Modal>;
}

function LocationModal({ open, onClose, sub, onDone }) {
  const toast = useToast();
  const [cluster, setCluster] = useState('');
  const [busy, setBusy] = useState(false);
  const clusters = (sub.clusters || []).map((c) => (typeof c === 'string' ? c : c.id || c.name));
  useEffect(() => { if (open) setCluster(clusters.find((c) => c !== sub.server_id) || clusters[0] || ''); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/admin/subscriptions/${enc(sub.client_id)}/change-location`, { cluster }); toast('Локация изменена'); onDone(); onClose(); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Сменить кластер" size="sm" footer={<Button busy={busy} onClick={submit} disabled={!cluster}>Перенести</Button>}>
    <p className="muted">Сейчас: {sub.server_id}. Клиенту нужно будет обновить подписку в приложении.</p>
    <Select label="Кластер" value={cluster} onChange={(e) => setCluster(e.target.value)} options={clusters.map((c) => ({ value: c, label: c }))} />
  </Modal>;
}

function Devices({ clientId }) {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useLoad((signal) => api.get(`/admin/subscriptions/${enc(clientId)}/hwid`, null, { signal }), [clientId]);
  const unbind = async (hwid) => {
    try { await api.post(`/admin/subscriptions/${enc(clientId)}/hwid/unbind`, { hwid }); toast('Устройство отвязано'); state.reload(true); } catch (err) { toast.error(err); }
  };
  const resetAll = async () => {
    if (!await confirm({ title: 'Отвязать все устройства?', confirmText: 'Отвязать', danger: true })) return;
    try { const r = await api.post(`/admin/subscriptions/${enc(clientId)}/hwid/reset`); toast(r.message || 'Готово'); state.reload(true); } catch (err) { toast.error(err); }
  };
  const devices = state.data?.devices || [];
  return <Card title={`Устройства${devices.length ? ` · ${devices.length}` : ''}`} actions={devices.length > 0 && <Button size="sm" variant="ghost" onClick={resetAll}>Отвязать все</Button>}>
    {state.loading ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : state.data?.supported === false
      ? <p className="muted">Для этой панели список устройств недоступен.</p>
      : devices.length === 0 ? <Empty icon="device" title="Устройств нет" />
        : <ul className="device-list">{devices.map((d) => <li key={d.hwid}>
          <div className="cell-main"><strong>{d.deviceModel || d.device_model || d.platform || 'Устройство'}</strong>
            <span>{[d.platform, d.osVersion || d.os_version].filter(Boolean).join(' ')} · {dateTime(d.createdAt || d.created_at)}</span>
            <span className="mono">{d.hwid}</span></div>
          <IconButton icon="x" label="Отвязать" onClick={() => unbind(d.hwid)} />
        </li>)}</ul>}
  </Card>;
}

export default function SubscriptionAdmin() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const state = useLoad((signal) => api.get(`/admin/subscriptions/${enc(clientId)}`, null, { signal }), [clientId]);
  const [modal, setModal] = useState(null);
  const s = state.data;
  useDocumentTitle(s ? s.alias || s.email : 'Подписка');

  if (state.loading && !s) return <Spinner />;
  if (state.error && !s) return <><PageHead back="/admin/subscriptions" title="Подписка" /><ErrorBox error={state.error} onRetry={state.reload} /></>;

  const status = subscriptionStatus(s);
  const reload = () => state.reload(true);
  const act = async (path, { title, text, danger, confirmText, done } = {}) => {
    if (title && !await confirm({ title, text, danger, confirmText })) return;
    try { const r = await api.post(`/admin/subscriptions/${enc(clientId)}/${path}`); toast(r?.message || done || 'Готово'); reload(); } catch (err) { toast.error(err); }
  };
  const remove = async () => {
    if (!await confirm({ title: 'Удалить подписку?', text: 'Подписка удалится из бота и с серверов. Восстановить её будет нельзя.', confirmText: 'Удалить', danger: true })) return;
    try { await api.del(`/admin/subscriptions/${enc(clientId)}`); toast('Подписка удалена'); navigate(-1); } catch (err) { toast.error(err); }
  };

  return <>
    <PageHead back="/admin/subscriptions" title={s.alias || s.email}
      subtitle={<span className="row"><Badge tone={status.tone}>{status.label}</Badge><span className="mono">{s.client_id}</span></span>}
      actions={<>
        <Button icon="clock" onClick={() => setModal('expiry')}>Изменить срок</Button>
        {s.owner_tg_id && <Button variant="secondary" icon="user" to={`/admin/users/${s.owner_tg_id}?by_tg=true`}>Владелец</Button>}
      </>} />

    <div className="grid grid-main">
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Параметры">
          <KeyValue items={[
            ['Владелец', s.owner_title || (s.owner_tg_id ? `TG ${s.owner_tg_id}` : '—')],
            ['Тариф', cleanName(s.tariff_name) || '—'],
            ['Действует до', `${date(s.expiry_time)} (${remaining(s.expiry_time).text})`],
            ['Создана', date(s.created_at)],
            ['Кластер', s.server_id],
            ['Устройств', s.device_limit ?? 'без ограничения'],
            ['Трафик', s.traffic_limit ? `${s.traffic_limit} ГБ` : 'без ограничения'],
            ['Email в панели', <span className="mono" key="e">{s.email}</span>],
          ]} />
        </Card>
        {s.remnawave_link && <Card title="Ссылка подписки"><CopyField value={s.remnawave_link} /></Card>}
        <Devices clientId={clientId} />
      </div>
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Управление">
          <div className="action-list">
            <button type="button" onClick={() => setModal('expiry')}><span>Продлить или сократить срок</span></button>
            <button type="button" onClick={() => setModal('limits')}><span>Лимиты устройств и трафика</span></button>
            <button type="button" onClick={() => setModal('tariff')}><span>Сменить тариф</span></button>
            {(s.clusters || []).length > 1 && <button type="button" onClick={() => setModal('location')}><span>Перенести на другой кластер</span></button>}
            <button type="button" onClick={() => act('reset-traffic', { title: 'Сбросить трафик?', confirmText: 'Сбросить' })}><span>Сбросить трафик</span></button>
            {s.is_frozen
              ? <button type="button" onClick={() => act('unfreeze')}><span>Разморозить</span></button>
              : <button type="button" onClick={() => act('freeze', { title: 'Заморозить подписку?', text: 'Клиент не сможет подключаться, пока подписка заморожена.', confirmText: 'Заморозить' })}><span>Заморозить</span></button>}
            <button type="button" onClick={() => act('reissue', { title: 'Перевыпустить подписку?', text: 'Будет создана новая ссылка, старая перестанет работать. Клиенту нужно будет добавить её заново.', confirmText: 'Перевыпустить' })}><span>Перевыпустить ссылку</span></button>
          </div>
        </Card>
        <Card title="Опасная зона" className="danger-zone">
          <div className="stack">
            <p className="help-text">Удаление необратимо: подписка пропадёт у клиента и на серверах.</p>
            <Button variant="danger" icon="trash" onClick={remove}>Удалить подписку</Button>
          </div>
        </Card>
      </div>
    </div>

    <ExpiryModal open={modal === 'expiry'} onClose={() => setModal(null)} sub={s} onDone={reload} />
    <LimitsModal open={modal === 'limits'} onClose={() => setModal(null)} sub={s} onDone={reload} />
    <TariffModal open={modal === 'tariff'} onClose={() => setModal(null)} sub={s} onDone={reload} />
    {modal === 'location' && <LocationModal open onClose={() => setModal(null)} sub={s} onDone={reload} />}
  </>;
}
