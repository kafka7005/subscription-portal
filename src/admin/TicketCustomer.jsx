import { Devices } from './SubscriptionAdmin.jsx';
import Disclosure from '../ui/Disclosure.jsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/hooks.js';
import { copyText, date, dateTime, money, paymentStatusLabel, paymentTone, rub, subscriptionStatus, userName } from '../lib/format.js';
import { Badge, Button, Card, CopyField, Icon, ErrorBox, IconButton, KeyValue, Modal, Spinner, useToast } from '../ui/index.jsx';

function CopyValue({ label, value }) {
  const toast = useToast();
  if (value == null || value === '') return null;
  return <div className="customer-copy"><span>{label}</span><strong>{value}</strong>
    <IconButton icon="copy" label={`Скопировать: ${label}`} onClick={async () => {
      if (await copyText(String(value))) toast('Скопировано');
      else toast.error(new Error('Не удалось скопировать'));
    }} /></div>;
}

function SubscriptionLink({ sub, expanded, related, version }) {
  const [open, setOpen] = useState(expanded);
  const [devices, setDevices] = useState(false);
  const toast = useToast();
  const { isAdmin } = useAuth();
  const path = `/admin/subscriptions/${encodeURIComponent(sub.client_id)}`;
  const needDetails = open || sub.device_limit === undefined;
  const state = useLoad(signal => needDetails ? api.get(path, null, { signal }) : null, [needDetails, path, version]);
  const limit = state.data?.device_limit === undefined ? sub.device_limit : state.data.device_limit;
  const limitText = limit === undefined ? (state.loading ? '…' : 'нет данных')
    : limit === null || limit === 0 ? 'без ограничения' : limit;
  const status = subscriptionStatus(sub);
  const name = sub.alias || sub.tariff_name || sub.email || 'Подписка';
  return <>
    {related && <small className="customer-context-label">Клиент выбрал эту подписку</small>}
    <Disclosure className="support-subscription" open={open} onOpenChange={setOpen} label={<span className="sub-overview">
      <span className="sub-heading"><strong>{name}</strong><Badge tone={status.tone}>{status.label}</Badge></span>
      <span className="sub-facts"><span>До {date(sub.expiry_time)}</span><span><Icon name="device" size={14} />Мест для устройств: <b>{limitText}</b></span></span>
    </span>}>
      <div className="support-subscription-body">
        {state.loading ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
          : state.data?.remnawave_link ? <Button size="sm" variant="secondary" icon="copy" onClick={async () => {
            if (await copyText(state.data.remnawave_link)) toast('Ссылка скопирована');
            else toast.error(new Error('Не удалось скопировать'));
          }}>Скопировать ссылку</Button> : <p className="help-text">Ссылка подписки недоступна.</p>}
        {isAdmin && <Button size="sm" variant="secondary" icon="device" onClick={() => setDevices(true)}>Устройства</Button>}
        <Link className="support-detail-link" to={path}>Управление подпиской</Link>
      </div>
    </Disclosure>
    <Modal open={devices} onClose={() => setDevices(false)} title={`Устройства · ${name}`}>
      {devices && <Devices clientId={sub.client_id} allowResetAll={false} />}
    </Modal>
  </>;
}

function Payments({ rows, ticket, user, clientLink, version }) {
  const { isAdmin } = useAuth();
  const ref = ticket.ref_type === 'payment' ? ticket.ref_id : null;
  const [expanded, setExpanded] = useState(ref != null);
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const match = ref == null ? null : rows.find(p => String(p.id) === String(ref));
  const extra = useLoad(async signal => {
    if (!isAdmin || ref == null || match || !user) return null;
    const p = await api.get(`/payments/${encodeURIComponent(ref)}`, null, { signal });
    return p && (p.user_id != null ? String(p.user_id) === String(user.id)
      : p.tg_id != null && String(p.tg_id) === String(user.tg_id)) ? p : null;
  }, [ref, Boolean(match), user?.id, isAdmin, version]);
  const first = ref == null ? sorted[0] : match || extra.data;
  const others = sorted.filter(p => String(p.id) !== String(first?.id));
  const line = p => <li key={p.id}><div><strong>{money(p.amount,p.currency)}</strong><Badge tone={paymentTone(p.status)}>{paymentStatusLabel[p.status] || p.status}</Badge></div>
    <small>{dateTime(p.created_at)} · {p.payment_system || '—'}</small></li>;
  return <section className="customer-fold">
    <Disclosure open={expanded} onOpenChange={setExpanded} label={<>
      <Icon name="wallet" size={17} /><span>{ref == null ? 'Платежи' : 'Платёж по обращению'}</span>
      {first && <small>{money(first.amount, first.currency)}</small>}
    </>}>
      {first ? <ul className="support-payments">{line(first)}</ul> : ref != null && extra.loading ? <Spinner />
        : <p className="muted">{ref != null ? `Данные платежа №${ref} недоступны` : 'Платежей нет'}</p>}
      {others.length > 0 && <Disclosure label={`История платежей · ${others.length}`}><ul className="support-payments">{others.map(line)}</ul></Disclosure>}
      {clientLink && <Link className="support-detail-link" to={clientLink}>Все платежи в карточке клиента</Link>}
    </Disclosure>
  </section>;
}

function PartnerSummary({ userId, version }) {
  const state = useLoad((signal) => api.get(`/partners/u${userId}`, null, { signal }), [userId, version]);
  const p = state.data;
  return <div>
    {state.loading && !p ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
      : !p || p.success === false ? <p className="muted">Партнёрский профиль недоступен.</p> : <>
        <KeyValue items={[
          ['Процент', `${p.partner_percent}%`],
          ['Баланс к выводу', rub(p.partner_balance)],
          ['Приглашено', p.invited?.length ?? 0],
          ['Способ вывода', p.payout_method || 'не указан'],
        ]} />
        {p.partner_code && <CopyField label="Партнёрская ссылка" value={`${window.location.origin}/partner/${encodeURIComponent(p.partner_code)}`} />}
        <Button size="sm" variant="ghost" to={`/admin/users/${userId}`}>Управление партнёркой</Button>
      </>}
  </div>;
}

export default function TicketCustomer({ client, context, ticket, version }) {
  const { isAdmin, config } = useAuth();
  const ref = client?.admin_ref ?? client?.tg_id;
  const byTg = client?.admin_ref == null && client?.tg_id != null;
  const state = useLoad((signal) => ref != null
    ? api.get(`/users/${encodeURIComponent(ref)}/card`, { by_tg: byTg || undefined }, { signal })
    : Promise.resolve(null), [ref, byTg, version]);
  const d = state.data;
  const u = d?.user;
  const clientLink = ref != null ? `/admin/users/${encodeURIComponent(ref)}${byTg ? '?by_tg=true' : ''}` : null;
  const [partnerOpen, setPartnerOpen] = useState(false);
  const username = u?.username || context?.username;
  const name = u ? userName(u) : username || client?.email || 'Клиент';
  const keys = d?.keys || [];
  const related = ticket.ref_type === 'key' ? keys.find(k => String(k.client_id) === String(ticket.ref_id)) : null;
  const paymentPanel = <Payments rows={d?.payments || []} ticket={ticket} user={u} clientLink={clientLink} version={version} />;
  return <div className="support-customer">
    <Card className="customer-identity">
      <div className="customer-identity-head">
        <span className="customer-monogram" aria-hidden="true">{Array.from(name.replace(/^@/, '').trim())[0]?.toUpperCase()}</span>
        <div className="customer-name"><h2>{clientLink
          ? <Link to={clientLink} aria-label={`Открыть профиль: ${name}`}>{name}<Icon name="arrow" size={14} /></Link>
          : name}</h2>{username && name !== `@${username}` && <small>@{username}</small>}
          {d?.banned && <Badge tone="danger">Заблокирован</Badge>}
        </div>
        {(u || context?.balance != null) && <div className="customer-balance"><span>Баланс</span><strong>{rub(u?.balance ?? context?.balance)}</strong></div>}
      </div>
    </Card>
    {state.loading && !d ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
      : !d ? <Card><p className="muted">Нет связанного платёжного профиля.</p></Card> : <>
        {ticket.ref_type === 'payment' && paymentPanel}
        <Card title={related ? 'По этому обращению' : `Подписки · ${keys.length}`}>
          {keys.length ? <div className="support-subscriptions">
            {(related ? [related, ...keys.filter(k => k !== related)] : keys).map(sub =>
              <SubscriptionLink key={sub.client_id} sub={sub} version={version} related={sub === related} expanded={sub === related || keys.length === 1} />)}
          </div> : <p className="muted">Подписок нет.</p>}
        </Card>
        {ticket.ref_type !== 'payment' && paymentPanel}
      </>}
    <section className="customer-fold">
      <Disclosure label={<><Icon name="mail" size={17} />Контакты и профиль</>}>
        <CopyValue label="ID клиента" value={u?.id} />
        <CopyValue label="Telegram ID" value={u?.tg_id || client?.tg_id} />
        <CopyValue label="Почта" value={d?.identity?.email || client?.email} />
        {u && <KeyValue items={[
          ['Регистрация', date(u.created_at)], ['Пробный период', u.trial ? 'использован' : 'доступен'],
          ticket.ref_type && ['Связано с', `${ticket.ref_type}: ${ticket.ref_id}`],
        ]} />}
      </Disclosure>
    </section>
    {isAdmin && config?.features?.partner_enabled && u?.id != null && <section className="customer-fold">
      <Disclosure label={<><Icon name="handshake" size={17} />Партнёрка</>} open={partnerOpen} onOpenChange={setPartnerOpen}>
        {partnerOpen && <PartnerSummary userId={u.id} version={version} />}
      </Disclosure>
    </section>}
  </div>;
}
