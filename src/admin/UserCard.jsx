import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, paymentDateTime, money, paymentStatusLabel, paymentTone, rub, subscriptionStatus, userName } from '../lib/format.js';
import { cleanName } from '../lib/tariffs.js';
import { useAuth } from '../lib/auth.jsx';
import PartnerAdmin from './PartnerAdmin.jsx';
import UserTools, { SendCabinet } from './UserTools.jsx';
import PaymentHistory from './PaymentHistory.jsx';
import ConfirmedOperation from './ConfirmedOperation.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Input, KeyValue, Modal, PageHead, Select, Spinner, Table, Textarea, useConfirm, useToast } from '../ui/index.jsx';

function ProfileModal({ user, onClose, onDone }) {
  const [form, setForm] = useState({ first_name: user.first_name || '', last_name: user.last_name || '', username: user.username || '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.patch(`/users/${user.id}/profile`, form); toast('Профиль обновлён'); onDone(); onClose(); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title="Редактировать профиль" size="sm"><form className="stack" onSubmit={save}>
    <Input label="Имя" maxLength={128} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
    <Input label="Фамилия" maxLength={128} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
    <Input label="Имя пользователя в базе бота" maxLength={64} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} hint="Это запись профиля в боте; имя Telegram-аккаунта не меняется." />
    <Button type="submit" busy={busy}>Сохранить</Button>
  </form></Modal>;
}

function BalanceModal({ open, onClose, user, onDone }) {
  const [amount, setAmount] = useState('');
  const [operation, setOperation] = useState(null);
  useEffect(() => { if (open) { setAmount(''); setOperation(null); } }, [open]);
  const value = Math.abs(Number(amount.replace(',', '.')));
  const valid = Number.isFinite(value) && value > 0;
  if (operation) return <ConfirmedOperation kind="balance" target={user.id} payload={operation}
    onClose={() => setOperation(null)} onDone={() => { onDone(); onClose(); }} />;
  return <Modal open={open} onClose={onClose} title="Изменить баланс" size="sm"
    footer={<><Button variant="ghost" disabled={!valid} onClick={() => setOperation({amount:-value})}>Списать</Button><Button disabled={!valid} onClick={() => setOperation({amount:value})}>Начислить</Button></>}>
    <p className="muted">Сейчас: {rub(user.balance)}. На следующем шаге покажем актуальный баланс до и после изменения и запросим причину.</p>
    <Input label="Сумма, ₽" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="100" />
  </Modal>;
}

function MessageModal({ open, onClose, user }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/users/${user.id}/message`, { text });
      toast(r.delivered?.length ? `Доставлено: ${r.delivered.join(', ')}` : 'Отправлено');
      setText(''); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Сообщение клиенту"
    footer={<Button busy={busy} disabled={!text.trim()} onClick={send} icon="send">Отправить</Button>}>
    <p className="muted">Придёт в Telegram-бот и в уведомления на сайте.</p>
    <Textarea label="Текст" value={text} onChange={(e) => setText(e.target.value)} rows={5} autoFocus />
  </Modal>;
}

function CreateSubModal({ open, onClose, user, onDone }) {
  const toast = useToast();
  const opts = useLoad((signal) => (open ? api.get(`/users/${user.id}/creation-options`, null, { signal }) : null), [open]);
  const [cluster, setCluster] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [devices, setDevices] = useState('');
  const [busy, setBusy] = useState(false);
  const data = opts.data;
  const clusterTariffs = useMemo(() => {
    const c = data?.clusters?.find((x) => x.id === cluster);
    return (data?.tariffs || []).filter((t) => c?.tariff_ids.includes(t.id));
  }, [data, cluster]);
  const tariff = clusterTariffs.find((t) => String(t.id) === String(tariffId));
  useEffect(() => { if (data?.clusters?.length && !cluster) setCluster(data.clusters[0].id); }, [data, cluster]);
  useEffect(() => { if (clusterTariffs.length && !clusterTariffs.some((t) => String(t.id) === String(tariffId))) setTariffId(String(clusterTariffs[0].id)); }, [clusterTariffs, tariffId]);
  useEffect(() => { setDevices(tariff?.device_options?.[0] ? String(tariff.device_options[0]) : ''); }, [tariff]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/subscriptions`, {
        tariff_id: Number(tariffId), cluster_id: cluster, duration_days: tariff?.duration_days,
        selected_device_limit: tariff?.configurable && devices ? Number(devices) : undefined,
      });
      toast('Подписка выдана'); onDone(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return <Modal open={open} onClose={onClose} title="Выдать подписку"
    footer={<Button busy={busy} disabled={!tariff} onClick={create}>Выдать бесплатно</Button>}>
    {opts.loading ? <Spinner /> : opts.error ? <ErrorBox error={opts.error} /> : !data?.clusters?.length ? <p className="muted">Нет доступных кластеров.</p> : <>
      <p className="muted">Подписка создаётся без оплаты и без списания баланса — как выдача из бота.</p>
      <Select label="Кластер (локация)" value={cluster} onChange={(e) => setCluster(e.target.value)} options={data.clusters.map((c) => ({ value: c.id, label: c.name }))} />
      <Select label="Тариф" value={tariffId} onChange={(e) => setTariffId(e.target.value)}
        options={clusterTariffs.map((t) => ({ value: String(t.id), label: `${cleanName(t.name)} · ${t.duration_days} дн · ${t.group_code}` }))} />
      {tariff?.configurable && tariff.device_options?.length > 0 && <Select label="Устройств" value={devices} onChange={(e) => setDevices(e.target.value)}
        options={tariff.device_options.map((n) => ({ value: String(n), label: String(n) }))} />}
    </>}
  </Modal>;
}

export default function UserCard() {
  const { userId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const card = useLoad((signal) => api.get(`/users/${userId}/card`, { by_tg: params.get('by_tg') || undefined }, { signal }), [userId]);
  const [modal, setModal] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState(null);
  const { isAdmin, config } = useAuth();
  const d = card.data;
  useDocumentTitle(d ? userName(d.user) : 'Клиент');

  if (card.loading && !d) return <Spinner />;
  if (card.error && !d) return <><PageHead back="/admin/users" title="Клиент" /><ErrorBox error={card.error} onRetry={card.reload} /></>;

  const u = d.user;
  const caps = d.capabilities || {};
  const can = (key) => caps[key] !== false;
  const reload = () => card.reload(true);

  const toggleBan = async () => {
    const ban = !d.banned;
    if (!await confirm({ title: ban ? 'Заблокировать клиента?' : 'Снять блокировку?', text: ban ? 'Клиент потеряет доступ к боту и кабинету. Подписки не удаляются.' : 'Доступ к боту и кабинету вернётся.', confirmText: ban ? 'Заблокировать' : 'Разблокировать', danger: ban })) return;
    try { await api.post(`/users/${u.id}/${ban ? 'ban' : 'unban'}`); toast(ban ? 'Клиент заблокирован' : 'Блокировка снята'); reload(); } catch (err) { toast.error(err); }
  };
  const restoreTrial = async () => {
    try { await api.post(`/users/${u.id}/trial/restore`); toast('Пробный период снова доступен'); reload(); } catch (err) { toast.error(err); }
  };

  return <>
    <PageHead back="/admin/users" title={userName(u)}
      subtitle={<span className="row">
        <span>#{u.id}{u.tg_id ? ` · TG ${u.tg_id}` : ''}{u.username ? ` · @${u.username}` : ''}</span>
        {d.banned && <Badge tone="danger">Заблокирован</Badge>}
      </span>}
      actions={<>
        <Button icon="plus" onClick={() => setModal('sub')}>Выдать подписку</Button>
        <Button variant="secondary" icon="send" onClick={() => setModal('msg')}>Написать</Button>
        {isAdmin && can('cabinet') && u.tg_id && <Button variant="ghost" icon="send" onClick={() => setModal('cabinet')}>Отправить кабинет</Button>}
      </>} />

    <div className="grid grid-4">
      <div className="stat"><span className="stat-label">Баланс</span><strong className="stat-value">{rub(u.balance)}</strong>
        <button type="button" className="btn btn-link stat-hint" onClick={() => setModal('balance')}>Изменить</button></div>
      <div className="stat"><span className="stat-label">Подписок</span><strong className="stat-value">{d.keys.length}</strong></div>
      <div className="stat"><span className="stat-label">Пригласил</span><strong className="stat-value">{d.invited_count}</strong>
        {d.invited_by && <button type="button" className="btn btn-link stat-hint" onClick={() => navigate(`/admin/users/${d.invited_by}`)}>Его пригласил #{d.invited_by}</button>}</div>
      <div className="stat"><span className="stat-label">Подарков отправил</span><strong className="stat-value">{d.gifts_count}</strong></div>
    </div>

    <div className="grid grid-main">
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Подписки">
          <Table rows={d.keys} rowKey={(k) => k.client_id} onRowClick={(k) => navigate(`/admin/subscriptions/${encodeURIComponent(k.client_id)}`)}
            empty={<Empty icon="shield" title="Подписок нет" action={<Button size="sm" onClick={() => setModal('sub')}>Выдать подписку</Button>} />}
            columns={[
              { key: 'name', title: 'Подписка', className: 'cell-primary', render: (k) => <div className="cell-main"><strong>{k.alias || cleanName(k.tariff_name) || k.email}</strong><span>{k.server_id}</span></div> },
              { key: 'status', title: 'Статус', render: (k) => { const s = subscriptionStatus(k); return <Badge tone={s.tone}>{s.label}</Badge>; } },
              { key: 'expiry', title: 'До', className: 'nowrap', render: (k) => date(k.expiry_time) },
            ]} />
        </Card>
        <Card title="Платежи" actions={<Button size="sm" variant="ghost" to={`/admin/payments?q=${u.tg_id || u.username || ''}`}>Все</Button>}>
          <Table rows={d.payments} rowKey={(p) => p.id} empty={<Empty icon="card" title="Платежей нет" />}
            columns={[
              { key: 'date', title: 'Дата', className: 'nowrap', render: (p) => paymentDateTime(p.created_at) },
              { key: 'system', title: 'Касса', render: (p) => p.payment_system },
              { key: 'status', title: 'Статус', render: (p) => <Badge tone={paymentTone(p.status)}>{paymentStatusLabel[p.status] || p.status}</Badge> },
              { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong>{money(p.amount, p.currency)}</strong> },
              { key: 'history', title: '', render: (p) => isAdmin && /yookassa/i.test(p.payment_system || '') ? <Button variant="ghost" size="sm" onClick={() => setPaymentHistory(p)}>История</Button> : null },
            ]} />
        </Card>
      </div>
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Профиль" actions={isAdmin && can('edit_profile') && <Button size="sm" variant="ghost" onClick={() => setModal('profile')}>Изменить</Button>}>
          <KeyValue items={[
            ['Имя', [u.first_name, u.last_name].filter(Boolean).join(' ') || '—'],
            ['Почта', d.identity?.email ? <span className="admin-email-binding"><span>{d.identity.email} {d.identity.email_verified ? '✓' : ''}</span>{isAdmin && can('unlink_email') && d.identity.can_unlink_email && <Button variant="ghost" size="sm" onClick={async () => {
              if (!await confirm({ title: 'Отвязать почту клиента?', text: 'Почта и пароль будут удалены из привязок. Вход через Telegram сохранится.', confirmText: 'Отвязать почту', danger: true })) return;
              try { await api.del(`/users/${u.id}/identity/email`); toast('Почта отвязана'); reload(); } catch (err) { toast.error(err); }
            }}>Отвязать</Button>}</span> : '—'],
            ['Telegram', d.identity?.tg_id || u.tg_id || '—'],
            ['Google / Яндекс', [d.identity?.google_linked && 'Google', d.identity?.yandex_linked && 'Яндекс'].filter(Boolean).join(', ') || '—'],
            ['Пробный период', u.trial ? 'использован' : 'доступен'],
            ['Регистрация', date(u.created_at)],
          ]} />
        </Card>
        {isAdmin && config?.features?.partner_enabled && <PartnerAdmin user={u} />}
        <Card title="Действия">
          <div className="action-list">
            {can('balance') && <button type="button" onClick={() => setModal('balance')}><span>Начислить или списать баланс</span></button>}
            {u.trial ? <button type="button" onClick={restoreTrial}><span>Вернуть пробный период</span></button> : null}
            <button type="button" className={d.banned ? '' : 'danger'} onClick={toggleBan}><span>{d.banned ? 'Снять блокировку' : 'Заблокировать'}</span></button>
          </div>
        </Card>
      </div>
    </div>

    {isAdmin && <UserTools key={u.id} user={u} capabilities={caps} onChanged={reload} />}
    {paymentHistory && <PaymentHistory payment={paymentHistory} onClose={() => setPaymentHistory(null)} />}
    {modal === 'cabinet' && <SendCabinet user={u} config={config} onClose={() => setModal(null)} />}
    <BalanceModal open={modal === 'balance'} onClose={() => setModal(null)} user={u} onDone={reload} />
    {modal === 'profile' && <ProfileModal user={u} onClose={() => setModal(null)} onDone={reload} />}
    <MessageModal open={modal === 'msg'} onClose={() => setModal(null)} user={u} />
    {modal === 'sub' && <CreateSubModal open onClose={() => setModal(null)} user={u} onDone={reload} />}
  </>;
}
