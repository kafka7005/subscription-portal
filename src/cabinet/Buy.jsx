import { renewalSummary } from '../lib/renewalSummary.js';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, days, devices as devicesText, rub } from '../lib/format.js';
import { cleanName, loadLandingGroup, siteTariffs, usePublicTariffs } from '../lib/tariffs.js';
import { Button, ErrorBox, Icon, Input, PageHead, Spinner, useToast } from '../ui/index.jsx';
import { PaymentPicker, returnUrls, usePaymentChoice } from './PaymentPicker.jsx';
import PaymentConsents, { usePaymentConsents } from './PaymentConsents.jsx';
import { DeviceStepper, Line, PlanPicker, Step, Summary } from './checkout.jsx';

// Покупка и продление. Цена и скидка — всегда расчёт бота (preview=true ничего не списывает).
export default function Buy() {
  const [params] = useSearchParams();
  const renewId = params.get('renew');
  return <Checkout key={renewId || 'purchase'} renewId={renewId} />;
}

function Checkout({ renewId }) {
  const [params, setParams] = useSearchParams();
  useDocumentTitle(renewId ? 'Продление' : 'Покупка');
  const navigate = useNavigate();
  const toast = useToast();
  const { config } = useAuth();
  const tariffsState = usePublicTariffs();
  const fromLanding = !renewId && params.get('source') === 'landing';
  const landing = useLoad(signal => fromLanding ? loadLandingGroup(signal) : null, [fromLanding]);
  const renewKey = useLoad(async signal => {
    if (!renewId) return null;
    const [details, keys] = await Promise.all([
      api.get(`/keys/${encodeURIComponent(renewId)}/details`, null, { signal }),
      api.get('/keys', null, { signal }),
    ]);
    const key = keys.find(item => item.client_id === renewId);
    return { ...details, tariff_id: key?.tariff_id ?? null };
  }, [renewId]);

  const currentPlan = tariffsState.data?.find(t => t.id === renewKey.data?.tariff_id);
  const renewalGroup = currentPlan?.group_code;
  const group = fromLanding ? landing.data : renewalGroup && currentPlan.price_rub > 0
    && !['trial', 'discounts', 'discounts_max', 'cold_discounts', 'cold_discounts_max', 'gifts'].includes(renewalGroup)
    ? renewalGroup : undefined;
  const tariffs = useMemo(() => fromLanding && !group ? [] : siteTariffs(tariffsState.data, group), [tariffsState.data, fromLanding, group]);

  const [promo, setPromo] = useState(params.get('promo') || '');
  const promoApplied = params.get('promo') || '';
  const [promoOpen, setPromoOpen] = useState(Boolean(params.get('promo')));
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [paying, setPaying] = useState(false);

  const wantedId = params.get('tariff') ?? renewKey.data?.tariff_id;
  const tariff = tariffs.find(t => t.id === Number(wantedId)) ?? (renewId || fromLanding ? null : tariffs[0]);
  const tariffId = tariff?.id;
  const deviceOptions = tariff?.configurable && tariff.device_options?.length ? tariff.device_options : null;
  const preferredCount = params.get('devices') ?? (renewId ? renewKey.data?.device_limit : 1);
  const count = preferredCount == null ? null : Number(preferredCount);
  const useSavedConfig = Boolean(renewId && tariff && tariffId === renewKey.data?.tariff_id && !params.has('devices'));
  const missingLimit = !useSavedConfig && renewId && deviceOptions && !deviceOptions.includes(count);
  const deviceCount = deviceOptions
    ? (deviceOptions.includes(count) ? count : deviceOptions[0])
    : ((renewId && tariffId === renewKey.data?.tariff_id ? renewKey.data?.device_limit : null) ?? tariff?.device_limit ?? 1);
  const selectedLimit = !useSavedConfig && deviceOptions ? deviceCount : undefined;

  function selectParam(name, value) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(name);
    else next.set(name, String(value));
    setParams(next, { replace: true });
  }

  const ready = Boolean(tariff && !missingLimit && (!renewId || renewKey.data));
  const body = useMemo(() => ready ? ({
    tariff_id: tariffId,
    selected_device_limit: selectedLimit,
    coupon_code: promoApplied || undefined,
    autopay_consent: false,
  }) : null, [ready, tariffId, selectedLimit, promoApplied]);
  const debouncedBody = useDebounced(body, 200);
  const path = renewId ? `/keys/${encodeURIComponent(renewId)}/renew` : '/tariffs/purchase';

  useEffect(() => {
    if (!debouncedBody || debouncedBody !== body) return undefined;
    const controller = new AbortController();
    setPreviewError(null);
    api.post(path, debouncedBody, { signal: controller.signal, query: { preview: true } })
      .then((res) => { if (!controller.signal.aborted) setPreview({ ...res, _coupon: debouncedBody.coupon_code || '', _request: JSON.stringify(debouncedBody), _path: path }); })
      .catch((err) => { if (err.name !== 'AbortError') { setPreview(null); setPreviewError(err); } });
    return () => controller.abort();
  }, [body, debouncedBody, path, renewId, retry, config]);

  const stale = !preview || preview._request !== JSON.stringify(body) || preview._path !== path;
  const quote = !stale && renewId ? preview : null;
  const baseLimit = useSavedConfig ? quote?.new_device_limit ?? tariff?.device_limit : deviceCount;
  const finalLimit = quote ? quote.carried_device_limit ?? quote.new_device_limit ?? tariff?.device_limit : baseLimit;
  const deviceLabel = finalLimit == null ? 'По условиям тарифа' : finalLimit === 0 ? 'Без лимита устройств' : devicesText(finalLimit);
  const toPay = preview?.payment_required ? preview.required_amount_rub : 0;
  const choice = usePaymentChoice(toPay, stale ? null : preview);
  const consent = usePaymentConsents(choice, `${path}:${JSON.stringify(body)}:${preview?.final_price_rub}:${toPay}`);
  const promoState = !promoApplied ? null : stale ? 'checking' : preview.applied_coupon_code ? 'ok' : 'bad';
  const total = preview ? (toPay > 0 ? choice.gross : 0) : null;
  const couponsOn = config?.features?.coupon_enabled !== false;

  // Продление: новая дата окончания = максимум(сейчас, текущий конец) + срок тарифа.
  // Смена тарифа (другие устройства/срок): бот пересчитывает остаток текущей подписки.
  const sw = renewId && preview && !stale && preview.is_switch ? preview : null;
  const credit = sw ? Number(sw.credit_to_balance_rub || 0) : 0;
  const refund = sw ? Number(sw.refund_to_balance_rub || 0) : 0;
  const netCost = preview ? Math.max(0, Number(preview.final_price_rub || 0)) : 0;
  const renewal = renewId && renewKey.data && tariff && !stale
    ? renewalSummary(preview, tariff.duration_days, renewKey.data.expiry_time) : null;
  const newExpiry = renewal?.end;
  const externalMayKeepExpiry = sw && toPay > 0 && newExpiry < Number(renewKey.data?.expiry_time);

  const pay = async () => {
    if (!consent.ready || stale || paying) return;
    setPaying(true);
    try {
      const res = await api.post(path, {
        ...body, ...consent.payload, provider_id: toPay ? choice.provider : undefined, accepted_gross_amount: toPay ? choice.acceptedGross : undefined, ...returnUrls(),
      });
      if (res.payment_url) { window.location.assign(res.payment_url); return; }
      if (res.ok === false) throw new Error(res.message || 'Не удалось оформить');
      toast(res.message || (renewId ? 'Подписка продлена' : 'Подписка оформлена'));
      navigate('/cabinet', { replace: true });
    } catch (err) {
      if (err.data?.detail?.code === 'single_subscription') setPreviewError(err);
      else toast.error(err);
      setPaying(false);
    }
  };

  if (!renewId && previewError?.data?.detail?.code === 'single_subscription') return <>
    <PageHead title="У вас уже есть подписка" subtitle="Откройте её в личном кабинете, чтобы посмотреть условия и продлить срок." />
    <div className="row"><Button to="/cabinet">Мои подписки</Button>
      <Button variant="secondary" onClick={() => setRetry(n => n + 1)}>Проверить снова</Button></div>
  </>;
  if (tariffsState.error) return <ErrorBox error={tariffsState.error} />;
  if (!tariffsState.data || (renewId && renewKey.loading)) return <Spinner />;
  if (renewKey.error) return <ErrorBox error={renewKey.error} onRetry={renewKey.reload} />;
  if (fromLanding && landing.loading) return <Spinner />;
  if (fromLanding && landing.error) return <ErrorBox error={landing.error} onRetry={landing.reload} />;
  if (!tariffs.length) return <PageHead back="/cabinet" title="Нет доступных тарифов" />;
  const rk = renewKey.data;

  const button = <Button size="lg" className="btn-block pay-btn" busy={paying} disabled={!consent.ready || !preview || stale || previewError || (toPay > 0 && !choice.provider)} onClick={pay} iconRight="arrow">
    {toPay > 0 ? 'Перейти к оплате' : sw ? (refund > 0 ? 'Сменить тариф' : 'Сменить тариф с баланса') : renewId ? 'Продлить с баланса' : 'Оформить с баланса'}
  </Button>;

  let n = 0;
  return <div className="checkout">
    <PageHead back="/cabinet" title={renewId ? 'Продление подписки' : 'Новая подписка'}
      subtitle={renewId ? 'Выберите параметры и проверьте новый срок перед оплатой.' : 'Трафик без ограничений и все локации. Подписка появится сразу после оплаты.'} />

    {rk && <div className="renew-strip card">
      <span className="sub-card-icon"><Icon name="shield" size={20} /></span>
      <div className="cell-main"><strong>{rk.alias || cleanName(rk.tariff_name) || 'Подписка'}</strong><span>сейчас до {date(rk.expiry_time)}</span></div>
      {newExpiry && <div className="renew-arrow"><Icon name="arrow" size={16} /><div className="cell-main"><strong className="tone-ok">до {date(newExpiry)}</strong><span>по расчёту бота</span></div></div>}
    </div>}

    <div className="checkout-grid">
      <div className="stack" style={{ gap: 16 }}>
        <Step n={++n} title="Срок" hint="Чем дольше — тем дешевле месяц" done={Boolean(tariff)}>
          {fromLanding && !tariff && <p className="muted">Выбранный на лендинге тариф больше недоступен. Выберите другой.</p>}
          {renewId && !tariff && <p className="muted">Прежний тариф недоступен для выбора. Выберите новый тариф для продления.</p>}
          <PlanPicker tariffs={tariffs} value={tariffId} onChange={id => selectParam('tariff', id)} />
        </Step>
        {deviceOptions && (missingLimit || deviceOptions.length > 1) && <Step n={++n} title="Устройства" hint={useSavedConfig ? 'Базовый лимит подписки' : missingLimit ? 'Выберите количество' : deviceLabel} done={!missingLimit && baseLimit != null}>
          {missingLimit || !deviceOptions.includes(baseLimit) ? <div>
            <p className="field-hint">{useSavedConfig ? 'Бот рассчитает продление с текущими параметрами. Здесь можно выбрать другую базу.' : 'Прежний лимит недоступен. Сколько устройств нужно для продления?'}</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>{deviceOptions.map(n => <Button key={n} variant="secondary" onClick={() => selectParam('devices', n)}>{n === 0 ? 'Без лимита' : devicesText(n)}</Button>)}</div>
          </div> : <DeviceStepper options={deviceOptions} value={baseLimit} onChange={n => selectParam('devices', n)} />}
        </Step>}
        {ready && couponsOn && <Step n={++n} title="Промокод" hint="Необязательно" done={promoState === 'ok'}
          aside={<button type="button" className="btn btn-link" aria-controls="checkout-promo" aria-expanded={promoOpen} onClick={() => setPromoOpen(!promoOpen)}>{promoOpen ? 'Свернуть' : promoApplied ? 'Показать код' : 'У меня есть код'}</button>}>
          <div id="checkout-promo" className="expand-track" data-expanded={promoOpen} inert={!promoOpen}>
            <div className="expand-clip"><div className="checkout-promo-fields">
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); selectParam('promo', promo.trim().toUpperCase()); }}>
              <Input aria-label="Промокод" placeholder="Введите промокод" value={promo} autoComplete="off" spellCheck="false"
                readOnly={Boolean(promoApplied)} className={promoState ? `promo-${promoState}` : ''}
                onChange={(e) => setPromo(e.target.value.toUpperCase().replace(/\s/g, ''))} />
              {promoApplied
                ? <Button variant="secondary" onClick={() => { setPromo(''); selectParam('promo', ''); }}>Убрать</Button>
                : <Button type="submit" variant="secondary" disabled={!promo.trim()}>Применить</Button>}
            </form>
            <div className="expand-track" data-expanded={Boolean(promoState)}><div className="expand-clip"><p className={`promo-status promo-status-${promoState}`} role="status">
              {promoState === 'checking' && <><span className="spinner spinner-sm" />Проверяем промокод…</>}
              {promoState === 'ok' && <>✓ Скидка {rub(preview.discount_rub)} применена</>}
              {promoState === 'bad' && <>Код не даёт скидку на эту покупку. Промокоды на баланс или дни активируйте на главной.</>}
            </p></div></div>
            </div></div>
          </div>
        </Step>}
        {ready && toPay > 0 && <Step n={++n} title="Способ оплаты" hint={choice.fee ? `комиссия кассы ${rub(choice.fee)}` : 'без комиссии'} done={Boolean(choice.provider)}>
          <PaymentPicker choice={choice} />
        </Step>}
      </div>

      {ready && <Summary eyebrow={sw ? 'Смена тарифа' : renewId ? 'Продление' : 'Service Portal'}
        consents={<PaymentConsents consent={consent} />}
        extra={sw && <div className="switch-note">
          <Icon name="refresh" size={18} />
          <p>Параметры подписки меняются{renewKey.data?.device_limit && deviceOptions && renewKey.data.device_limit !== deviceCount ? ` (${devicesText(renewKey.data.device_limit)} → ${deviceCount})` : ''}.
            {' '}{renewal?.note}
            {externalMayKeepExpiry && ' При оплате через некоторые кассы бот сохраняет прежнюю дату окончания, если она позже.'}</p>
        </div>} title={tariff ? days(tariff.duration_days) : '—'}
        features={[deviceLabel, 'Трафик без ограничений', 'Все локации и протоколы']}
        total={previewError || stale ? null : total} button={button}
        note={`После оплаты вы вернётесь на сайт, а подписка ${renewId ? 'продлится' : 'появится в кабинете'} автоматически.`}>
        {previewError ? <ErrorBox error={previewError} /> : stale ? <div className="skeleton" style={{ height: 64 }} /> : <>
          <Line label={sw ? 'Новый тариф' : 'Стоимость'} value={rub(preview.base_price_rub)} />
          {quote && finalLimit != null && <Line label="Устройств после продления" value={finalLimit === 0 ? 'Без лимита' : finalLimit} />}
          {quote?.carried_addons_rub > 0 && <Line label="В том числе перенос докупленных опций" value={rub(quote.carried_addons_rub)} />}
          {preview.discount_rub > 0 && <Line label={`Промокод ${preview.applied_coupon_code || ''}`} value={`−${rub(preview.discount_rub)}`} tone="ok" />}
          {credit > 0 && <Line label="Остаток текущей подписки" value={`−${rub(Math.min(credit, preview.base_price_rub - (preview.discount_rub || 0)))}`} tone="ok" />}
          {sw?.credit_days > 0 && <Line label="Остаток пересчитан в дни" value={`+${days(sw.credit_days)}`} tone="ok" />}
          {refund > 0 && <Line label="Вернётся на баланс" value={`+${rub(refund)}`} tone="ok" />}
          {netCost - toPay > 0 && <Line label="С баланса" value={`−${rub(netCost - toPay)}`} />}
          {choice.fee > 0 && toPay > 0 && <Line label="Комиссия кассы" value={rub(choice.fee)} />}
        </>}
      </Summary>}
    </div>
  </div>;
}
