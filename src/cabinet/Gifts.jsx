import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, days as daysText, rub } from '../lib/format.js';
import { cleanName, configPrice } from '../lib/tariffs.js';
import { Badge, Button, Card, CopyField, Empty, ErrorBox, Icon, IconButton, Input, Loadable, Modal, PageHead, Spinner, Tabs, useConfirm, useToast } from '../ui/index.jsx';
import { PaymentPicker, returnUrls, usePaymentChoice } from './PaymentPicker.jsx';
import PaymentConsents, { usePaymentConsents } from './PaymentConsents.jsx';
import { DeviceStepper, Line, PlanPicker, Step, Summary } from './checkout.jsx';

// Подарки: купить подписку для другого человека (тарифы группы «gifts»),
// посмотреть свои подарки со ссылкой и QR, активировать полученный подарок.
// Ссылка подарка из бота: <сайт>/gift/<id> → сюда с ?code=<id>.

const giftLink = (g) => g.site_gift_link || `${window.location.origin}/gift/${g.gift_id}`;

function ShareModal({ gift, onClose }) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    setQr(null);
    if (!gift) return;
    api.get(`/gifts/my/${encodeURIComponent(gift.gift_id)}/qr`).then((r) => setQr(r.image_data_url || 'error')).catch(() => setQr('error'));
  }, [gift]);
  return <Modal open={Boolean(gift)} onClose={onClose} title="Подарок готов" size="sm">
    {gift && <>
      <p className="muted">Отправьте ссылку получателю. Он откроет её, войдёт удобным способом — и подписка появится у него в кабинете.</p>
      <CopyField value={giftLink(gift)} label="Ссылка на подарок" />
      <div className="qr-box">{!qr ? <Spinner /> : qr === 'error' ? <span className="muted">QR недоступен</span> : <img src={qr} alt="QR-код подарка" width="220" height="220" />}</div>
      {navigator.share && <Button variant="secondary" icon="send" onClick={() => navigator.share({ title: 'Подарок — Service Portal', text: 'Дарю тебе подписку Service Portal!', url: giftLink(gift) }).catch(() => {})}>Поделиться</Button>}
    </>}
  </Modal>;
}

function BuyGift({ onCreated, balance }) {
  const toast = useToast();
  const tariffs = useLoad((signal) => api.get('/tariffs/public', { group_code: 'gifts' }, { signal }), []);
  const list = useMemo(() => (tariffs.data || []).filter((t) => t.group_code === 'gifts' && t.price_rub > 0), [tariffs.data]);
  const [tariffId, setTariffId] = useState(null);
  const [devices, setDevices] = useState(1);
  const [price, setPrice] = useState(null);
  const [busy, setBusy] = useState(false);
  const tariff = list.find((t) => t.id === tariffId) || list[0];
  const deviceOptions = tariff?.configurable && tariff.device_options?.length ? tariff.device_options : null;
  useEffect(() => { if (tariff && tariffId !== tariff.id) setTariffId(tariff.id); }, [tariff]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tariff) return undefined;
    let alive = true;
    setPrice(null);
    (deviceOptions ? configPrice(tariff.id, devices) : Promise.resolve(tariff.price_rub)).then((p) => alive && setPrice(p)).catch(() => alive && setPrice(tariff.price_rub));
    return () => { alive = false; };
  }, [tariff, devices]); // eslint-disable-line react-hooks/exhaustive-deps
  const toPay = price == null ? 0 : Math.max(0, Math.ceil(price - Number(balance || 0)));
  const choice = usePaymentChoice(toPay);
  const consent = usePaymentConsents(choice, `${tariff?.id}:${devices}:${price}`);

  const buy = async () => {
    if (!consent.ready || busy) return;
    setBusy(true);
    try {
      const res = await api.post('/gifts/create', {
        tariff_id: tariff.id, selected_device_limit: deviceOptions ? devices : undefined, autopay_consent: false,
        provider_id: toPay > 0 ? choice.provider : undefined, accepted_gross_amount: toPay > 0 ? choice.acceptedGross : undefined, ...returnUrls(),
      });
      if (res.payment_url) { window.location.assign(res.payment_url); return; }
      toast(res.message || 'Подарок создан');
      onCreated(res);
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  if (tariffs.loading && !tariffs.data) return <Spinner />;
  if (tariffs.error) return <ErrorBox error={tariffs.error} onRetry={tariffs.reload} />;
  if (!list.length) return <Empty icon="gift" title="Подарки пока не продаются" text="Загляните позже." />;
  const total = price == null ? null : toPay > 0 ? choice.gross : 0;
  const button = <Button size="lg" className="btn-block pay-btn" busy={busy} disabled={!consent.ready || price == null || (toPay > 0 && !choice.provider)} onClick={buy} iconRight="arrow">
    {toPay > 0 ? 'Оплатить подарок' : 'Создать подарок'}
  </Button>;
  let n = 0;
  return <div className="checkout-grid">
    <div className="stack" style={{ gap: 16 }}>
      <Step n={++n} title="Срок подарка" hint="Получатель активирует его, когда удобно" done={Boolean(tariff)}>
        <PlanPicker tariffs={list} value={tariff?.id} onChange={setTariffId} label="Срок подарка" />
      </Step>
      {deviceOptions && deviceOptions.length > 1 && <Step n={++n} title="Устройства" done>
        <DeviceStepper options={deviceOptions} value={devices} onChange={setDevices} />
      </Step>}
      {toPay > 0 && <Step n={++n} title="Способ оплаты" hint={choice.fee ? `комиссия кассы ${rub(choice.fee)}` : 'без комиссии'} done={Boolean(choice.provider)}>
        <PaymentPicker choice={choice} />
      </Step>}
    </div>
    <Summary eyebrow="Подарок" title={tariff ? cleanName(tariff.name) || daysText(tariff.duration_days) : '—'}
      consents={<PaymentConsents consent={consent} />}
      features={[daysText(tariff?.duration_days || 0), deviceOptions ? `${devices} устр.` : 'Трафик без ограничений', 'Ссылка и QR для получателя']}
      extra={<div className="gift-ribbon" aria-hidden="true"><Icon name="gift" size={26} /></div>}
      total={total} button={button} note="После оплаты подарок появится во вкладке «Мои подарки» — со ссылкой и QR-кодом.">
      <Line label="Стоимость" value={price == null ? '…' : rub(price)} />
      {price != null && price - toPay > 0 && <Line label="С баланса" value={`−${rub(price - toPay)}`} />}
      {choice.fee > 0 && toPay > 0 && <Line label="Комиссия кассы" value={rub(choice.fee)} />}
    </Summary>
  </div>;
}

function MyGifts({ onShare, reloadKey }) {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useLoad((signal) => api.get('/gifts/my', { limit: 100 }, { signal }), [reloadKey]);
  const remove = async (g) => {
    if (!await confirm({ title: 'Удалить подарок?', text: 'Ссылка перестанет работать. Деньги за неиспользованный подарок не возвращаются автоматически.', confirmText: 'Удалить', danger: true })) return;
    try { await api.del(`/gifts/my/${encodeURIComponent(g.gift_id)}`); toast('Подарок удалён'); state.reload(true); } catch (err) { toast.error(err); }
  };
  return <Loadable state={state}>{(data) => {
    const gifts = data?.gifts || [];
    if (!gifts.length) return <Card><Empty icon="gift" title="Подарков пока нет" text="Купите подписку в подарок — здесь появится ссылка для получателя." /></Card>;
    return <div className="gift-grid stagger">{gifts.map((g) => <article key={g.gift_id} className="card card-padded gift-card lift">
      <div className="row-between">
        <div className="gift-hero gift-hero-sm"><Icon name="gift" size={20} /></div>
        {g.is_used ? <Badge tone="muted">Активирован</Badge> : <Badge tone="ok">Ждёт получателя</Badge>}
      </div>
      <div className="cell-main"><strong>{cleanName(g.tariff_name) || daysText(g.duration_days)}</strong><span>{daysText(g.duration_days)} · {rub(g.price_rub)} · создан {date(g.created_at)}</span></div>
      {!g.is_used ? <div className="row">
        <Button size="sm" icon="send" onClick={() => onShare(g)}>Поделиться</Button>
        <IconButton icon="trash" label="Удалить подарок" onClick={() => remove(g)} />
      </div> : g.usages?.length ? <span className="muted" style={{ fontSize: 13 }}>Активирован {date(g.usages[0]?.used_at || g.usages[0]?.created_at)}</span> : null}
    </article>)}</div>;
  }}</Loadable>;
}

function Redeem({ initialCode, onRedeemed }) {
  const toast = useToast();
  const [code, setCode] = useState(initialCode || '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try { const r = await api.post('/gifts/redeem', { gift_code: code.trim() }); toast(r.message || 'Подарок активирован — подписка в кабинете'); setCode(''); onRedeemed(); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Card className="redeem-card">
    <div className="gift-hero"><Icon name="gift" size={28} /></div>
    <h2>Активировать подарок</h2>
    <p className="muted">Введите код из ссылки или откройте ссылку подарка — код подставится сам.</p>
    <form className="inline-form" onSubmit={submit}>
      <Input aria-label="Код подарка" placeholder="Код подарка" value={code} onChange={(e) => setCode(e.target.value.trim())} required autoFocus={Boolean(initialCode)} />
      <Button type="submit" busy={busy}>Активировать</Button>
    </form>
  </Card>;
}

export default function Gifts() {
  useDocumentTitle('Подарки');
  const { config } = useAuth();
  const { summary } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const code = params.get('code') || '';
  const tab = params.get('tab') || (code ? 'redeem' : 'buy');
  const [share, setShare] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  if (!config?.features?.gift_enabled) return <Card><Empty icon="gift" title="Подарки сейчас недоступны" text="Загляните позже." /></Card>;
  const go = (t) => setParams({ tab: t });

  return <>
    <PageHead title="Подарки" subtitle="Подарите подписку близким или активируйте подарок, который прислали вам." />
    <Tabs value={tab} onChange={go} tabs={[{ value: 'buy', label: 'Подарить' }, { value: 'mine', label: 'Мои подарки' }, { value: 'redeem', label: 'Активировать' }]} />
    {tab === 'buy' && <BuyGift balance={summary.data?.balance} onCreated={(res) => { summary.reload(true); setReloadKey((k) => k + 1); go('mine'); if (res.gift_id) setShare({ gift_id: res.gift_id, site_gift_link: res.site_gift_link }); }} />}
    {tab === 'mine' && <MyGifts onShare={setShare} reloadKey={reloadKey} />}
    {tab === 'redeem' && <Redeem initialCode={code} onRedeemed={() => { summary.reload(true); setParams({}); }} />}
    <ShareModal gift={share} onClose={() => setShare(null)} />
  </>;
}
