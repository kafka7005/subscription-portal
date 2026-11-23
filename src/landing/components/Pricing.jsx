import Disclosure from '../../ui/Disclosure.jsx';
import { useEffect, useRef, useState } from 'react';
import { deviceText, money, plans as demoPlans } from '../lib/pricing.js';
import { useAnimatedNumber, useReducedMotion } from '../lib/useMotion.js';
import { Icon } from '../../ui/icons.jsx';
import { configPrice, loadLandingGroup, loadPublicTariffs, siteTariffs } from '../../lib/tariffs.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

const deviceCounts = Array.from({ length: 10 }, (_, index) => index + 1);

function landingDeviceOptions(tariff) {
  if (!tariff.configurable || !tariff.device_options?.length) return [tariff.device_limit ?? 0];
  const options = [...tariff.device_options].sort((a, b) => a - b);
  const compact = options.filter(n => n <= 10);
  return compact.length ? compact : [options[0]];
}

// Demo durations reserve space while loading. Only live API quotes can be bought.
function useLivePlans() {
  const [plans, setPlans] = useState(() => demoPlans.map((p) => ({ id: Number(p.id), days: p.days, from: p.prices[0], demo: p })));
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoadError(false);
    Promise.all([loadPublicTariffs({ refresh: attempt > 0 }), loadLandingGroup()]).then(([all, group]) => {
      const live = siteTariffs(all, group).slice(0, 4).map((t) => ({ id: t.id, days: t.duration_days, from: t.price_rub, limits: landingDeviceOptions(t), configurable: t.configurable && Boolean(t.device_options?.length) }));
      if (!live.length) throw new Error('No available plans');
      if (alive) setPlans(live);
    }).catch(() => { if (alive) setLoadError(true); });
    return () => { alive = false; };
  }, [attempt]);
  return { plans, loadError, retryPlans: () => setAttempt((n) => n + 1) };
}

export default function Pricing({ copy, locale, onCheckout }) {
  const { me } = useAuth();
  const { plans, loadError, retryPlans } = useLivePlans();
  const [planId, setPlanId] = useState(plans[0].id);
  const [preferredDevices, setDevices] = useState(1);
  const [promo, setPromo] = useState('');
  const [promoState, setPromoState] = useState('idle');
  const [discount, setDiscount] = useState(0);
  const [promoFocused, setPromoFocused] = useState(false);
  const [quote, setQuote] = useState(null);
  const [priceError, setPriceError] = useState(false);
  const [priceRetry, setPriceRetry] = useState(0);
  const inputRef = useRef(null);
  const reduced = useReducedMotion();
  const plan = plans.find((item) => item.id === planId) || plans[0];
  const limits = plan.limits || deviceCounts;
  const devices = limits.includes(preferredDevices) ? preferredDevices : limits[0];
  const devicesLabel = n => n === 0 ? (locale === 'en' ? 'Unlimited devices' : 'Без лимита устройств') : deviceText(n, locale);
  const livePrice = quote?.tariffId === plan.id && quote?.devices === devices ? quote.price : null;
  useEffect(() => { if (!plans.some((p) => p.id === planId)) setPlanId(plans[0].id); }, [plans, planId]);

  useEffect(() => {
    let alive = true;
    setQuote(null);
    setPriceError(false);
    if (plan.demo) return undefined;
    configPrice(plan.id, plan.configurable ? devices : undefined).then((raw) => {
      const price = Number(raw);
      if (raw == null || !Number.isFinite(price) || price < 0) throw new Error('Invalid quote');
      if (alive) setQuote({ tariffId: plan.id, devices, price });
    }).catch(() => { if (alive) setPriceError(true); });
    return () => { alive = false; };
  }, [plan, devices, priceRetry]);

  const base = livePrice ?? 0;
  const total = Math.max(0, base - discount);
  const displayedPrice = useAnimatedNumber(total, reduced);
  const calculating = plan.demo || livePrice == null;

  // Для вошедших проверяем промокод сразу (расчёт без списания) и пересчитываем при смене
  // срока или устройств; для гостей — запоминаем и проверяем на оформлении.
  const checking = promoState === 'checking';
  const active = promoState === 'applied' || checking;
  useEffect(() => {
    if (!active || !me || plan.demo) { if (!active) setDiscount(0); return undefined; }
    const controller = new AbortController();
    setDiscount(0);
    setPromoState('checking');
    api.post('/tariffs/purchase', { tariff_id: plan.id, selected_device_limit: plan.configurable ? devices : undefined, coupon_code: promo.trim(), autopay_consent: false },
      { query: { preview: true }, signal: controller.signal })
      .then((r) => {
        if (r.applied_coupon_code) { setDiscount(r.discount_rub || 0); setPromoState('applied'); }
        else { setDiscount(0); setPromoState('invalid'); }
      })
      .catch((err) => { if (err.name !== 'AbortError') { setDiscount(0); setPromoState(err.data?.detail?.code === 'single_subscription' ? 'limit' : 'invalid'); } });
    return () => controller.abort();
  }, [active, me, plan, devices]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectDevice = (next, focus = false) => {
    setDevices(next);
    if (focus) requestAnimationFrame(() => document.getElementById(`device-${next}`)?.focus({ preventScroll: true }));
  };
  const onDeviceKey = (event) => {
    const i = limits.indexOf(devices);
    const values = { ArrowLeft: limits[Math.max(0, i - 1)], ArrowRight: limits[Math.min(limits.length - 1, i + 1)], Home: limits[0], End: limits.at(-1) };
    if (event.key in values) { event.preventDefault(); selectDevice(values[event.key], true); }
  };
  const onPlanKey = (event, index) => {
    const n = plans.length;
    const values = { ArrowLeft: (index + n - 1) % n, ArrowRight: (index + 1) % n, Home: 0, End: n - 1 };
    if (event.key in values) {
      event.preventDefault();
      const next = plans[values[event.key]].id;
      setPlanId(next);
      document.getElementById(`plan-${next}`)?.focus();
    }
  };
  const applyPromo = (event) => {
    event.preventDefault();
    if (promoState === 'applied') {
      setPromo(''); setPromoState('idle'); setDiscount(0); inputRef.current?.focus(); return;
    }
    if (!promo.trim()) { setPromoState('empty'); inputRef.current?.focus(); return; }
    setPromoState(me && !plan.demo ? 'checking' : 'applied');
  };
  const editPromo = (event) => {
    setPromo(event.target.value.toUpperCase().replace(/\s/g, '')); setPromoState('idle'); setDiscount(0);
  };
  const promoMessage = promoState === 'limit' ? (locale === 'en' ? 'You can renew your existing subscription in your account.' : 'Действующую подписку можно продлить в кабинете.') : checking ? copy.applying + '…' : promoState === 'applied' ? (me && discount > 0 ? `${copy.discount}: −${money(discount, locale)}` : copy.promoApplied) : promoState === 'invalid' ? copy.promoInvalid : promoState === 'empty' ? copy.promoEmpty : promoFocused ? copy.promoDemo : '';

  return <section className="pricing-section" id="plans" aria-labelledby="pricing-title">
    <h2 id="pricing-title">{copy.configure}</h2>
    <div className="pricing-layout">
      <div className="settings-card">
        <h3>{copy.duration}</h3>
        <div className="duration-options" role="radiogroup" aria-label={copy.duration}>
          {plans.map((item, index) => <button className="duration-option" key={item.id} id={`plan-${item.id}`} type="button" role="radio"
            aria-checked={planId === item.id} tabIndex={planId === item.id ? 0 : -1}
            onClick={() => setPlanId(item.id)} onKeyDown={(event) => onPlanKey(event, index)}>
            <span className="duration-check" aria-hidden="true">{planId === item.id && <Icon name="check" size={14} />}</span>
            <strong>{item.days}</strong><span>{copy.days}</span>
            {!item.demo && <small>{copy.from} {money(item.from, locale)}</small>}
          </button>)}
        </div>
        <div className="device-configuration">
          <h3 id="devices-label">{copy.devices}</h3>
          <div className="device-configuration-row">
            <div className="device-preview"><Icon name="device" size={27} /><span><strong>{devicesLabel(devices)}</strong><small>{copy.heroNote}</small></span></div>
          </div>
          <div className="device-quick" role="radiogroup" aria-labelledby="devices-label" onKeyDown={onDeviceKey}>
            {limits.map((value) => <button id={`device-${value}`} key={value} type="button" role="radio" aria-label={devicesLabel(value)}
              aria-checked={value === devices} tabIndex={value === devices ? 0 : -1} onClick={() => selectDevice(value)}>{value || '∞'}</button>)}
          </div>
        </div>
        <Disclosure className="promo-disclosure" label={<><Icon name="tag" size={19} /><span>{copy.promo}</span><Icon name="plus" size={18} /></>}>
          <form className="promo-field" onSubmit={applyPromo}>
            <label className="sr-only" htmlFor="promo-code">{copy.promo}</label>
            <div className="promo-input" data-state={promoState}>
              <input ref={inputRef} id="promo-code" autoComplete="off" spellCheck="false" autoCapitalize="characters" maxLength="32" value={promo} onChange={editPromo}
                onFocus={() => setPromoFocused(true)} onBlur={() => setPromoFocused(false)}
                aria-describedby="promo-message" aria-invalid={promoState === 'invalid' || promoState === 'empty'} placeholder={copy.promoPlaceholder} />
              <button type="submit" disabled={checking}>{checking ? copy.applying : promoState === 'applied' ? copy.removePromo : copy.apply}</button>
            </div>
            <div className="expand-track" data-expanded={Boolean(promoMessage)}><div className="expand-clip"><p className="promo-message" id="promo-message" role="status">{promoMessage}</p></div></div>
          </form>
        </Disclosure>
      </div>
      <aside className="summary-card" aria-label={copy.selectionTitle}>
        <div className="summary-heading"><h3>{copy.selectionTitle}</h3><img className="summary-mascot" src="/icons/logo.svg" alt="" width="48" height="48" /></div>
        <div className="selection-recap"><span><Icon name="clock" size={21} />{plan.days} {copy.days}</span><span><Icon name="device" size={21} />{devicesLabel(devices)}</span></div>
        <div className="price-line" aria-busy={calculating && !priceError && !loadError}>
          <output className="summary-price" aria-hidden="true">{calculating ? '…' : money(displayedPrice, locale)}</output>
          {discount > 0 && !calculating && <span className="price-before"><s>{money(base, locale)}</s><span>{copy.discount}</span></span>}
          <p>{locale === 'en' ? 'for the entire period' : 'за весь период'}</p>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copy.summaryTitle(plan.days)}, {devicesLabel(devices)}, {calculating ? copy.applying : `${copy.total}: ${money(total, locale)}`}</p>
        {(priceError || loadError) && <div className="landing-price-error" role="alert"><p>{locale === 'en' ? 'Could not calculate the price.' : 'Не удалось рассчитать стоимость.'}</p><button type="button" onClick={() => loadError ? retryPlans() : setPriceRetry((n) => n + 1)}>{locale === 'en' ? 'Try again' : 'Повторить'}</button></div>}
        <ul className="plan-features">{copy.features.map((feature) => <li key={feature}><Icon name="check" size={20} /><span>{feature}</span></li>)}</ul>
        <div className="checkout-area"><button type="button" className="checkout-button" disabled={calculating || checking}
          onClick={() => onCheckout({ tariffId: plan.id, days: plan.days, devices, promo: promoState === 'applied' ? promo.trim().toUpperCase() : '' })}>
          {copy.checkout}<Icon name="arrow" size={21} />
        </button><p>{copy.paymentNote}</p></div>
      </aside>
    </div>
  </section>;
}
