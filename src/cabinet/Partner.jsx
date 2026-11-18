import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import WithdrawModal from './WithdrawModal.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { dateTime, rub, shortDate } from '../lib/format.js';
import { Badge, Button, Card, CopyField, Empty, Icon, Input, Loadable, Modal, PageHead, Select, Spinner, Table, Tabs, useToast } from '../ui/index.jsx';

const PAYOUT_STATUS = { pending: ['Ожидает', 'warn'], approved: ['Выплачено', 'ok'], paid: ['Выплачено', 'ok'], rejected: ['Отклонено', 'danger'], canceled: ['Отменено', 'muted'] };
const KIND = { referral_bonus: 'Начисление', bonus: 'Начисление', payout: 'Вывод', payout_reserve: 'Резерв на вывод', refund: 'Возврат', admin: 'Корректировка' };

function MethodModal({ open, onClose, method, onSaved }) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [requisites, setRequisites] = useState('');
  const [busy, setBusy] = useState(false);
  const options = method?.methods || [];
  useEffect(() => { if (open) { setKey(method?.method || options[0]?.key || ''); setRequisites(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const hint = options.find((m) => m.key === key)?.hint;
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { const r = await api.put('/partners/payout-method/me', { method: key, requisites: requisites.trim() }); toast('Реквизиты сохранены'); onSaved(r); onClose(); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open={open} onClose={onClose} title="Куда выводить" size="sm">
    <form className="stack" onSubmit={save}>
      <Select label="Способ" value={key} onChange={(e) => setKey(e.target.value)} options={options.map((m) => ({ value: m.key, label: m.label }))} />
      <Input label="Реквизиты" required value={requisites} onChange={(e) => setRequisites(e.target.value)} hint={hint || 'Номер карты, телефон СБП или адрес кошелька'} />
      <Button type="submit" busy={busy} className="btn-block">Сохранить</Button>
    </form>
  </Modal>;
}

export default function Partner() {
  useDocumentTitle('Партнёрка');
  const { config } = useAuth();
  const { summary } = useOutletContext();
  const [tab, setTab] = useState('history');
  const [modal, setModal] = useState(null);
  const conditions = useLoad((signal) => api.get('/partners/conditions', null, { signal }), []);
  const finance = useLoad((signal) => api.get('/partners/finance/me', null, { signal }).catch(() => null), []);
  const method = useLoad((signal) => api.get('/partners/payout-method/me', null, { signal }), []);
  const transfer = useLoad((signal) => config?.features?.partner_enabled ? api.get('/portal/partner-transfer/options', null, { signal }) : Promise.resolve(null), [config]);
  const invited = useLoad((signal) => api.get('/partners/invited/me', { limit: 100 }, { signal }), []);
  const s = summary.data;

  if (!config?.features?.partner_enabled) return <Card><Empty icon="handshake" title="Партнёрская программа выключена" text="Загляните позже." /></Card>;
  if (!s) return <Spinner />;

  const link = s.partner_code ? `${window.location.origin}/partner/${encodeURIComponent(s.partner_code)}` : '';
  const botLink = config?.bot_username && s.partner_code ? `https://t.me/${config.bot_username}?start=partner_${s.partner_code}` : '';
  const c = conditions.data;
  const balance = Number(s.partner_balance || 0);
  const reloadMoney = () => { summary.reload(true); finance.reload(true); };

  return <>
    <PageHead title="Партнёрская программа" subtitle="Приглашайте людей по своей ссылке и получайте процент с каждой их оплаты." />

    <section className="partner-overview" aria-label="Партнёрский счёт">
      <div className="partner-balance"><span>Партнёрский баланс</span><strong>{rub(balance)}</strong></div>
      <dl className="partner-metrics"><div><dt>Ваш процент</dt><dd>{s.partner_percent || 0}%</dd></div><div><dt>Приглашено</dt><dd>{s.partner_referred_total}</dd></div><div><dt>Оплатили</dt><dd>{s.partner_referred_paid}</dd></div></dl>
      <Button icon="wallet" disabled={balance <= 0} onClick={() => setModal('withdraw')}>Вывести</Button>
    </section>

    <div className="grid grid-main">
      <Card title="Ваша ссылка" className="partner-links">
        <div className="stack">
          {link ? <CopyField value={link} label="На сайт" /> : <p className="muted">Ссылка появится, когда бот выдаст партнёрский код.</p>}
          {botLink && <CopyField value={botLink} label="В Telegram-бот" />}
          <p className="field-hint">Человек переходит по ссылке, входит удобным способом — и закрепляется за вами навсегда.</p>
        </div>
      </Card>
      <Card title="Вывод" actions={<Button size="sm" variant="ghost" onClick={() => setModal('method')}>{method.data?.configured ? 'Изменить' : 'Указать'}</Button>}>
        {method.loading ? <Spinner /> : method.data?.configured
          ? <div className="link-row is-linked"><span className="link-icon"><Icon name="wallet" size={20} /></span><div className="cell-main"><strong>{method.data.method_label}</strong><span>{method.data.masked}</span></div></div>
          : <div className="link-row is-missing"><span className="link-icon"><Icon name="wallet" size={20} /></span><div className="cell-main"><strong>Реквизиты не указаны</strong><span>Нужны для вывода на карту или кошелёк</span></div></div>}
        {finance.data && <div className="account-stats">
          <div><span className="muted">Заработано</span><strong>{rub(finance.data.earned_rub)}</strong></div>
          <div><span className="muted">В обработке</span><strong>{rub(finance.data.pending_rub)}</strong></div>
        </div>}
      </Card>
    </div>

    {c && (c.summary || c.level_lines?.length || c.rules?.length) && <Card title="Условия" className="partner-conditions">
      <div className="stack">
        {c.summary && <p>{c.summary}</p>}
        {c.level_lines?.length > 0 && <ul className="plain-list">{c.level_lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {c.rules?.length > 0 && <ul className="plain-list muted">{c.rules.map((l) => <li key={l}>{l}</li>)}</ul>}
        {c.examples?.length > 0 && <div className="chips">{c.examples.map((l) => <span className="chip" key={l}>{l}</span>)}</div>}
      </div>
    </Card>}

    <Card className="partner-history">
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'history', label: 'Начисления' }, { value: 'payouts', label: 'Выводы' }, { value: 'invited', label: 'Приглашённые' }]} />
      <div style={{ marginTop: 16 }}>
        {tab === 'history' && <Loadable state={finance}>{(f) => <Table rows={f?.items || []} rowKey={(r) => r.id}
          empty={<Empty icon="chart" title="Начислений пока нет" text="Здесь появятся бонусы с оплат приглашённых." />}
          columns={[
            { key: 'date', title: 'Дата', className: 'nowrap', render: (r) => dateTime(r.created_at) },
            { key: 'kind', title: 'Операция', render: (r) => KIND[r.kind] || r.kind },
            { key: 'amount', title: 'Сумма', className: 'num', render: (r) => <strong className={r.amount_rub < 0 ? '' : 'tone-ok'}>{rub(r.amount_rub, { sign: true })}</strong> },
          ]} />}</Loadable>}
        {tab === 'payouts' && <Loadable state={finance}>{(f) => <Table rows={f?.payouts || []} rowKey={(r) => r.id}
          empty={<Empty icon="wallet" title="Выводов пока не было" />}
          columns={[
            { key: 'date', title: 'Дата', className: 'nowrap', render: (r) => dateTime(r.created_at) },
            { key: 'method', title: 'Способ', render: (r) => r.method || '—' },
            { key: 'status', title: 'Статус', render: (r) => { const [l, t] = PAYOUT_STATUS[r.status] || [r.status, 'muted']; return <Badge tone={t}>{l}</Badge>; } },
            { key: 'amount', title: 'Сумма', className: 'num', render: (r) => <strong>{rub(r.amount_rub)}</strong> },
          ]} />}</Loadable>}
        {tab === 'invited' && <Loadable state={invited}>{(d) => <Table rows={d?.items || []} rowKey={(r, i) => r.user_id ?? i}
          empty={<Empty icon="users" title="Пока никого" text="Отправьте ссылку — здесь появятся те, кто по ней пришёл." />}
          columns={[
            { key: 'who', title: 'Пользователь', render: (r) => (r.tg_id ? `TG ···${String(r.tg_id).slice(-4)}` : `#${r.user_id}`) },
            { key: 'joined', title: 'Пришёл', className: 'nowrap', render: (r) => shortDate(r.joined_at) },
            { key: 'keys', title: 'Подписок', className: 'num', render: (r) => r.keys_count },
            { key: 'pays', title: 'Оплат', className: 'num', render: (r) => (r.payments_count ? <Badge tone="ok">{r.payments_count}</Badge> : '—') },
          ]} />}</Loadable>}
      </div>
    </Card>

    <MethodModal open={modal === 'method'} onClose={() => setModal(null)} method={method.data} onSaved={(r) => method.setData(r)} />
    {modal === 'withdraw' && <WithdrawModal balance={balance} conditions={conditions} transfer={transfer} method={method} onMethodSaved={method.setData} onDone={reloadMoney} onClose={() => setModal(null)} />}
  </>;
}
