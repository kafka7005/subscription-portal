import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, paymentDateTime, paymentTimeMs, money, paymentStatusLabel, paymentTone, rub, userName } from '../lib/format.js';
import { Badge, Card, Loadable, PageHead, Stat, Table } from '../ui/index.jsx';

const soft = (p) => p.catch(() => null);

// Выручка за последние 30 дней по успешным платежам (кроме ручных начислений админом).
function revenue(items) {
  const since = Date.now() - 30 * 86400000;
  const ok = (items || []).filter((p) => p.status === 'success' && p.payment_system !== 'admin' && p.amount > 0
    && paymentTimeMs(p.created_at) >= since && (!p.currency || p.currency === 'RUB'));
  return { sum: ok.reduce((s, p) => s + p.amount, 0), count: ok.length };
}

export default function Dashboard() {
  useDocumentTitle('Сводка');
  const { isAdmin, config } = useAuth();
  const navigate = useNavigate();
  const stats = useLoad((signal) => soft(api.get('/admin/keys/stats', null, { signal })), []);
  const payments = useLoad((signal) => soft(api.get('/admin/payments', { status: 'success', limit: 200 }, { signal })), []);
  const tickets = useLoad((signal) => soft(api.get('/admin/tickets', { status: 'open', limit: 5 }, { signal })), []);
  const unanswered = useLoad((signal) => soft(api.get('/admin/tickets/unanswered-count', null, { signal })), []);
  const users = useLoad((signal) => soft(api.get('/users/search', { limit: 1 }, { signal })), []);
  const payouts = useLoad((signal) => (isAdmin && config?.features?.partner_enabled ? soft(api.get('/partners/payouts/pending', { limit: 1 }, { signal })) : null), [isAdmin, config]);
  const servers = useLoad((signal) => (isAdmin ? soft(api.get('/servers/stats', null, { signal })) : null), [isAdmin]);

  const s = stats.data;
  const rev = revenue(payments.data?.items);

  return <>
    <PageHead title="Сводка" subtitle="Главное по сервису на сегодня. Цифры кликабельны." />
    {payouts.data?.total > 0 && <Link to="/admin/partners" className="alert-row anim-pop">
      <span className="alert-dot" />
      <span><b>Заявок на вывод от партнёров: {payouts.data.total}</b> — проверьте реквизиты и подтвердите выплату.</span>
      <span className="alert-cta">Открыть →</span>
    </Link>}
    <div className="grid grid-4">
      <Stat label="Активных подписок" value={s ? s.active : '—'} hint={s ? `всего ${s.total_keys}, заморожено ${s.frozen}` : null} to="/admin/subscriptions" />
      <Stat label="Истекают за 3 дня" value={s ? s.expiring?.['3d'] ?? 0 : '—'} hint={s ? `за неделю ${s.expiring?.['7d'] ?? 0}` : null} tone={s?.expiring?.['3d'] ? 'warn' : undefined} />
      <Stat label="Выручка за 30 дней" value={payments.data ? rub(rev.sum) : '—'} hint={payments.data ? `${rev.count} оплат${payments.data.total > 200 ? ' (по последним 200)' : ''}` : null} to="/admin/payments" />
      <Stat label="Ждут ответа" value={unanswered.data ? unanswered.data.count : '—'} hint="обращения в поддержку" tone={unanswered.data?.count ? 'warn' : undefined} to="/admin/tickets" />
    </div>

    <div className="grid grid-main">
      <Card title="Последние оплаты" actions={<Link className="btn btn-ghost btn-sm" to="/admin/payments">Все платежи</Link>}>
        <Loadable state={payments}>{(data) => <Table rows={(data?.items || []).slice(0, 8)} rowKey={(p) => p.id}
          onRowClick={(p) => p.user_id && navigate(`/admin/users/${p.user_id}`)}
          columns={[
            { key: 'who', title: 'Клиент', className: 'cell-primary', render: (p) => <div className="cell-main"><strong>{userName(p)}</strong><span>{paymentDateTime(p.created_at)}</span></div> },
            { key: 'system', title: 'Касса', render: (p) => p.payment_system },
            { key: 'status', title: 'Статус', render: (p) => <Badge tone={paymentTone(p.status)}>{paymentStatusLabel[p.status] || p.status}</Badge> },
            { key: 'amount', title: 'Сумма', className: 'num', render: (p) => <strong>{money(p.amount, p.currency)}</strong> },
          ]} />}</Loadable>
      </Card>
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Новые обращения" actions={<Link className="btn btn-ghost btn-sm" to="/admin/tickets">Открыть</Link>}>
          <Loadable state={tickets}>{(data) => (data?.items?.length
            ? <ul className="ticket-list">{data.items.map((t) => <li key={t.id}><Link to={`/admin/tickets/${t.id}`} className="ticket-row">
              <div className="cell-main"><strong>{t.subject || 'Без темы'}</strong><span>{dateTime(t.last_message_at || t.created_at)}</span></div>
            </Link></li>)}</ul>
            : <p className="muted">Новых обращений нет 🎉</p>)}</Loadable>
        </Card>
        <Card title="Клиенты">
          <div className="stack">
            <div className="row-between"><span className="muted">Всего пользователей</span><strong>{users.data?.total ?? '—'}</strong></div>
            {s && <div className="row-between"><span className="muted">Доля заморозок</span><strong>{s.frozen_ratio_pct}%</strong></div>}
            {s && <div className="row-between"><span className="muted">Истекают за 30 дней</span><strong>{s.expiring?.['30d'] ?? 0}</strong></div>}
          </div>
        </Card>
        {isAdmin && servers.data?.active_by_cluster?.length > 0 && <Card title="Нагрузка по серверам" actions={<Link className="btn btn-ghost btn-sm" to="/admin/servers">Серверы</Link>}>
          <div className="bars">
            {(() => {
              const rows = servers.data.active_by_cluster.slice().sort((a, b) => b.active - a.active).slice(0, 8);
              const max = Math.max(1, ...rows.map((r) => r.active));
              return rows.map((r) => <div className="bar-row" key={r.server}>
                <span className="bar-label">{r.server}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.active / max) * 100}%` }} /></span>
                <strong>{r.active}</strong>
              </div>);
            })()}
          </div>
        </Card>}
      </div>
    </div>
  </>;
}
