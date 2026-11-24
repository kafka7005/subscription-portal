import Disclosure from '../ui/Disclosure.jsx';
import { useMemo, useState } from 'react';
import useSubscriptionRefresh from './useSubscriptionRefresh.js';
import { pendingCheckout } from '../lib/checkoutReturn.js';
import { readAfterDeletion } from '../lib/readAfterDeletion.js';
import { Link, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, days as daysText, remaining, rub, subscriptionStatus } from '../lib/format.js';
import { siteTariffs, tariffName, usePublicTariffs } from '../lib/tariffs.js';
import { startTelegramAuth } from '../lib/telegramAuth.js';
import { links } from '../lib/site.js';
import { Badge, Button, Card, ErrorBox, Icon, Input, Spinner, useToast } from '../ui/index.jsx';
import { TelegramIcon } from '../ui/icons.jsx';
import LinkEmailModal from './LinkEmail.jsx';
import DevicesModal from './DevicesModal.jsx';
import DailyBonus from './DailyBonus.jsx';
import SubscriptionQr from './SubscriptionQr.jsx';

export function subTitle(key, tariffs) {
  return key.alias || key.tariff_name || tariffName(tariffs, key.tariff_id) || 'Подписка Service Portal';
}

// «Подключить» открывает страницу подписки: там актуальная инструкция и кнопки для приложений.
export function subscriptionUrl(key) {
  return key?.remnawave_link || key?.key || '';
}

function SubscriptionCard({ sub, tariffs, actions, onDevices, featured = false, details }) {
  const status = subscriptionStatus(sub);
  const left = remaining(sub.expiry_time);
  const url = subscriptionUrl(sub);
  const canRenew = actions?.renew_enabled !== false && sub.actions?.can_renew !== false;
  const canConnect = !left.expired && !sub.is_frozen && url;
  // Полоска — доля оставшегося срока от периода подписки (длительность тарифа,
  // а если тариф не публичный — от даты создания до окончания).
  const tariff = (tariffs || []).find((t) => t.id === sub.tariff_id);
  const expiry = Number(sub.expiry_time || 0);
  const created = Number(sub.created_at || 0) > 1e12 ? Number(sub.created_at) : Number(sub.created_at || 0) * 1000;
  const periodMs = tariff?.duration_days ? tariff.duration_days * 86400000 : Math.max(86400000, expiry - created);
  const leftMs = Math.max(0, expiry - Date.now());
  const pct = left.expired ? 0 : Math.max(3, Math.min(100, (leftMs / Math.max(periodMs, leftMs)) * 100));
  return <article className={`subscription-pass ${featured ? 'is-featured' : 'is-compact'} ${left.expired || sub.is_frozen ? 'is-inactive' : ''}`}>
    <div className="pass-heading">
      <div>
        <h2>{featured ? sub.alias || sub.tariff_name || 'Основная подписка' : subTitle(sub, tariffs)}</h2>
        {!featured && <span className="pass-date">до {date(sub.expiry_time)}</span>}
      </div>
      <div className="pass-heading-tools"><SubscriptionQr clientId={sub.client_id} enabled={actions?.qr_enabled === true} />{featured ? <img className="pass-brand" src="/icons/logo.svg" alt="" width="54" height="54" /> : <Badge tone={status.tone}>{status.label}</Badge>}</div>
    </div>
    {featured && <>
      <div className="pass-status"><Badge tone={status.tone}>{status.label}</Badge>{sub.is_frozen && <span>Обратитесь в поддержку</span>}</div>
      <div className="pass-term"><strong>{left.expired ? 'Срок истёк' : left.text.replace('ещё ', '')}</strong></div>
      <p className="pass-date">{left.expired ? 'закончилась' : 'до'} {date(sub.expiry_time)}</p>
      <div className="pass-ruler" role="meter" aria-label="Оставшийся срок подписки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={left.text}>
        {Array.from({ length: 48 }, (_, i) => <span key={i} className={i / 48 * 100 < pct ? 'is-filled' : ''} />)}
      </div>
      <button type="button" className="pass-devices" onClick={() => onDevices(sub)}>
        <Icon name="device" size={18} />
        {details?.device_limit != null ? <span>{details.connected_devices != null ? `${details.connected_devices} / ` : ''}{details.device_limit} {details.connected_devices != null ? 'устройств' : 'мест для устройств'}</span> : <span>Управление устройствами</span>}
        <Icon name="arrow" size={14} />
      </button>
    </>}
    <div className="pass-actions">
      <Button className="pass-connect" href={canConnect ? url : undefined} target="_blank" rel="noopener noreferrer" disabled={!canConnect} aria-disabled={!canConnect || undefined}>Подключить</Button>
      {actions?.renew_enabled !== false && <Button variant="secondary" to={canRenew ? `/cabinet/buy?renew=${encodeURIComponent(sub.client_id)}` : undefined} disabled={!canRenew}>Продлить</Button>}
      <Button variant="secondary" onClick={() => onDevices(sub)}>Устройства</Button>
    </div>
    {featured && <Link className="pass-more" to={`/cabinet/sub/${encodeURIComponent(sub.client_id)}`}>Подробнее о подписке <Icon name="arrow" size={14} /></Link>}
    {!featured && <Link className="pass-compact-more" to={`/cabinet/sub/${encodeURIComponent(sub.client_id)}`} aria-label={`Подробнее: ${subTitle(sub, tariffs)}`}><Icon name="arrow" size={18} /></Link>}
  </article>;
}

// Подписок нет — сразу предлагаем выбрать срок.
function QuickBuy({ trial, onTrial, trialBusy }) {
  const navigate = useNavigate();
  const state = usePublicTariffs();
  const plans = useMemo(() => siteTariffs(state.data).slice(0, 4), [state.data]);
  return <Card className="quick-buy" title="Выберите подписку" actions={<Link className="btn btn-ghost btn-sm" to="/cabinet/buy">Все параметры</Link>}>
    <p className="muted" style={{ marginBottom: 16 }}>Трафик без ограничений, все локации. Количество устройств выберете на следующем шаге.</p>
    {!state.data ? <Spinner /> : <div className="quick-plans stagger">
      {plans.map((t, i) => <button type="button" key={t.id} className={`quick-plan ${i === 1 ? 'is-popular' : ''}`} onClick={() => navigate(`/cabinet/buy?tariff=${t.id}`)}>
        {i === 1 && <span className="quick-tag">Популярный</span>}
        <strong>{daysText(t.duration_days)}</strong>
        <span className="quick-price">{rub(t.price_rub)}</span>
        {t.duration_days >= 60 && <span className="quick-month">{rub(Math.round(t.price_rub / (t.duration_days / 30)))} / мес</span>}
        <span className="quick-cta">Выбрать <Icon name="arrow" size={16} /></span>
      </button>)}
    </div>}
    {trial && <div className="trial-line">
      <span>Хотите сначала проверить? Пробный период — бесплатно.</span>
      <Button size="sm" variant="accent" busy={trialBusy} onClick={onTrial}>Попробовать</Button>
    </div>}
  </Card>;
}

function LinkChip({ icon, label, ok, onClick }) {
  return <button type="button" className={`account-binding ${ok ? 'is-linked' : 'is-missing'}`} onClick={ok ? undefined : onClick} disabled={ok}>
    {icon}<span>{label}</span><strong>{ok ? 'Привязан' + (label === 'Почта' ? 'а' : '') : 'Привязать'}</strong>{ok ? <Icon name="check" size={15} /> : <Icon name="arrow" size={15} />}
  </button>;
}

// Код подарка или промокод на баланс/дни: пробуем подарок, затем промокод.
function RedeemCard({ gifts, coupons }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const value = code.trim();
    setBusy(true);
    try {
      let res = null;
      if (gifts) { try { res = await api.post('/gifts/redeem', { gift_code: value }); } catch (err) { if (!coupons) throw err; } }
      if (!res && coupons) res = await api.post('/coupons/apply', { code: value });
      toast(res?.message || 'Код активирован');
      setCode('');
      setTimeout(() => window.location.reload(), 900);
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Disclosure className="cabinet-redeem" label={<><Icon name="tag" size={20} /><span>Промокод</span><Icon name="arrow" size={18} /></>}>
    <form className="inline-form" onSubmit={submit}>
      <Input aria-label="Код" placeholder="Введите код" value={code} onChange={(e) => setCode(e.target.value.trim())} required autoComplete="off" />
      <Button type="submit" variant="secondary" busy={busy}>Активировать</Button>
    </form>
    <p className="muted">Промокод на баланс или дополнительные дни.</p>
  </Disclosure>;
}

function loadSubscriptions(signal, deleted) {
  return readAfterDeletion(() => api.get('/keys', null, { signal }), deleted, signal);
}

export default function Home() {
  useDocumentTitle('Главная');
  const toast = useToast();
  const { me, config } = useAuth();
  const { summary } = useOutletContext();
  const { search, state } = useLocation();
  const keys = useLoad(signal => loadSubscriptions(signal, state?.deletedSubscription), [me?.id, state?.deletedSubscription]);
  const checkout = useMemo(() => pendingCheckout(me?.id, new URLSearchParams(search).get('checkout')), [me?.id, search]);
  const payment = useSubscriptionRefresh(me?.id, checkout, keys.reload, summary.reload);
  const actions = useLoad((signal) => api.get('/keys/actions-config', null, { signal }).catch(() => ({})), [config]).data;
  const mode = useLoad(signal => api.get('/portal/subscription-mode', null, { signal }), [config]);
  const allowExtra = mode.data?.single === false || mode.error?.status === 404;
  const tariffs = usePublicTariffs().data;
  const [emailOpen, setEmailOpen] = useState(false);
  const [devicesSub, setDevicesSub] = useState(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const features = config?.features || {};
  const s = summary.data;
  const list = (keys.data || []).slice().sort((a, b) => Number(b.expiry_time) - Number(a.expiry_time));
  const active = list.filter((k) => !remaining(k.expiry_time).expired && !k.is_frozen);
  const primary = active[0] || list[0];
  const other = list.filter((sub) => sub.client_id !== primary?.client_id);
  const primaryDetails = useLoad((signal) => primary ? api.get(`/keys/${encodeURIComponent(primary.client_id)}/details`, null, { signal }).catch(() => null) : null, [primary?.client_id, primary?.expiry_time, primary?.tariff_id]);
  const trialAvailable = features.trial_enabled && s && Number(s.trial_status) === 0;

  const takeTrial = async () => {
    setTrialBusy(true);
    try { const r = await api.post('/tariffs/trial'); toast(r.message || 'Пробный период активирован'); keys.reload(); summary.reload(true); }
    catch (err) { toast.error(err); } finally { setTrialBusy(false); }
  };
  const linkTelegram = () => startTelegramAuth({ mode: 'link', next: '/cabinet' }).catch((err) => toast.error(err));
  const statusText = keys.data === undefined ? '' : active.length === 0
    ? (primary?.is_frozen ? 'Подписка заморожена. Напишите в поддержку, если это неожиданно.' : list.length ? 'Подписка закончилась — продлите, чтобы снова подключиться.' : 'Подписки пока нет — выберите срок ниже.')
    : '';

  return <div className="cabinet-home">
    <header className="cabinet-intro"><div><h1>Твой интернет.</h1><p>Всё под контролем.</p></div>
      {list.length > 0 && allowExtra && <Button variant="ghost" size="sm" icon="plus" to="/cabinet/buy">Ещё подписка</Button>}
    </header>
    {payment.notice && <div className="cabinet-status" role="status">
      {payment.notice} <Button size="sm" variant="ghost" onClick={payment.check}>Проверить</Button>
    </div>}
    {statusText && <p className={`cabinet-status ${list.length && !active.length ? 'tone-warn' : 'muted'}`}>{statusText}</p>}
    <div className="cabinet-overview">
    <section id="subs" className="cabinet-subscriptions" aria-label="Мои подписки">
      {keys.loading && !keys.data ? <Card><Spinner /></Card>
        : keys.error && !keys.data ? <ErrorBox error={keys.error} onRetry={keys.reload} />
          : list.length === 0 ? <QuickBuy trial={trialAvailable} onTrial={takeTrial} trialBusy={trialBusy} />
            : <>
              <SubscriptionCard sub={primary} tariffs={tariffs} actions={actions} onDevices={setDevicesSub} featured details={primaryDetails.data} />
              {other.map((sub) => <SubscriptionCard key={sub.client_id} sub={sub} tariffs={tariffs} actions={actions} onDevices={setDevicesSub} />)}
              {allowExtra && <Link className="subscriptions-add" to="/cabinet/buy"><Icon name="plus" size={17} />Ещё подписка</Link>}
            </>}
    </section>
    <aside className="cabinet-account" aria-label="Аккаунт и бонусы">
      <h2>Аккаунт</h2>
      <div className="account-bindings">
        <LinkChip icon={<TelegramIcon size={20} />} label="Telegram" ok={Boolean(me?.tg_id)} onClick={linkTelegram} />
        <LinkChip icon={<Icon name="mail" size={20} />} label="Почта" ok={Boolean(me?.email && me.email_verified !== false)} onClick={() => setEmailOpen(true)} />
      </div>
      <DailyBonus onClaimed={() => summary.reload(true)} />
      <Link className="account-profile" to="/cabinet/profile">Настройки аккаунта <Icon name="arrow" size={16} /></Link>
    </aside>
    </div>
    <div className="cabinet-services">
      {features.partner_enabled && <section className="cabinet-partner"><span className="service-label">Партнёрский баланс</span>
        <div className="service-value-row"><strong>{s ? rub(s.partner_balance) : '—'}</strong><Button variant="ghost" size="sm" to="/cabinet/partner" iconRight="arrow">Пригласить друга</Button></div>
        {s && <span className="muted">Приглашено {s.partner_referred_total} · оплатили {s.partner_referred_paid}</span>}
      </section>}
      <section className="cabinet-help"><h2>Поможем с подключением</h2><p className="muted">Ответим на вопросы и поможем настроить доступ.</p>
      {features.support_tickets_enabled !== false
        ? <Button variant="ghost" size="sm" to="/cabinet/support" icon="chat">Открыть чат</Button>
        : <Button variant="ghost" size="sm" href={links.support} target="_blank" rel="noopener noreferrer" icon="chat">Поддержка в Telegram</Button>}
      </section>
    </div>
    {features.gift_enabled && <Link className="cabinet-gift" to="/cabinet/gifts"><Icon name="gift" size={20} /><span>Подписка в подарок <small>Для тех, кто вам дорог</small></span><Icon name="arrow" size={18} /></Link>}
    {features.coupon_enabled && <RedeemCard coupons />}

    <LinkEmailModal open={emailOpen} onClose={() => setEmailOpen(false)} />
    <DevicesModal sub={devicesSub} actions={actions} onClose={() => { setDevicesSub(null); primaryDetails.reload(true); }} />
  </div>;
}
