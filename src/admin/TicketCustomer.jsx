import Disclosure from '../ui/Disclosure.jsx';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/hooks.js';
import { date, dateTime, money, paymentStatusLabel, paymentTone, rub, subscriptionStatus, userName } from '../lib/format.js';
import { Badge, Button, Card, CopyField, ErrorBox, KeyValue, Spinner } from '../ui/index.jsx';

function SubscriptionLink({ sub, expanded, version }) {
  const [open, setOpen] = useState(expanded);
  const state = useLoad((signal) => open
    ? api.get(`/admin/subscriptions/${encodeURIComponent(sub.client_id)}`, null, { signal })
    : Promise.resolve(null), [open, sub.client_id, version]);
  const status = subscriptionStatus(sub);
  const url = state.data?.remnawave_link;
  return <Disclosure className="support-subscription" open={open} onOpenChange={setOpen} label={<><span>{sub.alias || sub.tariff_name || sub.email || 'Подписка'}<small>До {date(sub.expiry_time)}</small></span><Badge tone={status.tone}>{status.label}</Badge></>}>
    <div className="support-subscription-body">
      {state.loading ? <Spinner /> : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
        : url ? <CopyField value={url} label="Ссылка подписки" /> : <p className="help-text">Ссылка подписки недоступна.</p>}
      <Button size="sm" variant="ghost" to={`/admin/subscriptions/${encodeURIComponent(sub.client_id)}`}>Управление подпиской</Button>
    </div>
  </Disclosure>;
}

function PartnerSummary({ userId, version }) {
  const state = useLoad((signal) => api.get(`/partners/u${userId}`, null, { signal }), [userId, version]);
  const p = state.data;
  return <Card title="Партнёрка">
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
  </Card>;
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
  return <div className="support-customer">
    <Card title="Клиент">
      <KeyValue items={[
        ['Имя', u ? userName(u) : context?.username ? `@${context.username}` : '—'],
        u && ['ID клиента', u.id],
        ['Почта', d?.identity?.email || client?.email || '—'],
        ['Telegram', u?.tg_id || client?.tg_id || '—'],
        (u || context?.balance != null) && ['Баланс', rub(u?.balance ?? context?.balance)],
        u && ['Регистрация', date(u.created_at)],
        u && ['Пробный период', u.trial ? 'использован' : 'доступен'],
        ticket.ref_type && ['Связано с', `${ticket.ref_type}: ${ticket.ref_id}`],
      ]} />
      {d?.banned && <Badge tone="danger">Заблокирован</Badge>}
      {clientLink && <Button variant="secondary" size="sm" to={clientLink} className="btn-block">Карточка клиента</Button>}
    </Card>
    {state.loading && !d ? <Card><Spinner /></Card> : state.error ? <Card title="Данные клиента"><ErrorBox error={state.error} onRetry={state.reload} /></Card>
      : !d ? <Card><p className="muted">У обращения пока нет связанного платёжного профиля.</p></Card> : <>
        <Card title={`Подписки · ${d.keys?.length || 0}`}>
          {d.keys?.length ? <div className="support-subscriptions">{d.keys.map((sub) => <SubscriptionLink key={sub.client_id} sub={sub} version={version}
            expanded={String(ticket.ref_id) === String(sub.client_id) && ticket.ref_type === 'key' || d.keys.length === 1} />)}</div>
            : <p className="muted">Подписок нет.</p>}
        </Card>
        <Card title="Последние платежи">
          {d.payments?.length ? <ul className="support-payments">{d.payments.slice(0, 5).map((p) => <li key={p.id}>
            <div><strong>{money(p.amount, p.currency)}</strong><Badge tone={paymentTone(p.status)}>{paymentStatusLabel[p.status] || p.status}</Badge></div>
            <small>{dateTime(p.created_at)} · {p.payment_system || '—'}</small>
          </li>)}</ul> : <p className="muted">Платежей нет.</p>}
          {clientLink && <Link className="support-detail-link" to={clientLink}>Все платежи в карточке клиента</Link>}
        </Card>
        {isAdmin && config?.features?.partner_enabled && u?.id != null && <PartnerSummary userId={u.id} version={version} />}
      </>}
  </div>;
}
