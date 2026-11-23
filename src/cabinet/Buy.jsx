import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDebounced, useDocumentTitle, useLoad } from '../lib/hooks.js';
import { date, days, devices as devicesText, rub } from '../lib/format.js';
import { cleanName, siteTariffs, usePublicTariffs } from '../lib/tariffs.js';
import { Button, ErrorBox, Icon, Input, PageHead, Spinner, useToast } from '../ui/index.jsx';
import { PaymentPicker, returnUrls, usePaymentChoice } from './PaymentPicker.jsx';
import PaymentConsents, { usePaymentConsents } from './PaymentConsents.jsx';
import { DeviceStepper, Line, PlanPicker, Step, Summary } from './checkout.jsx';

// Покупка и продление. Цена и скидка — всегда расчёт бота (preview=true ничего не списывает).
export default function Buy() {
  const [params, setParams] = useSearchParams();
  const renewId = params.get('renew');
  useDocumentTitle(renewId ? 'Продление' : 'Покупка');
  const navigate = useNavigate();
  const toast = useToast();
  const { config } = useAuth();
  const tariffsState = usePublicTariffs();
  const tariffs = useMemo(() => siteTariffs(tariffsState.data), [tariffsState.data]);
  const renewKey = useLoad((signal) => (renewId ? api.get(`/keys/${encodeURIComponent(renewId)}/details`, null, { signal }) : null), [renewId]);

  const [tariffId, setTariffId] = useState(() => Number(params.get('tariff')) || null);
  const [deviceCount, setDeviceCount] = useState(() => Math.max(1, Number(params.get('devices')) || 1));
  const [promo, setPromo] = useState(params.get('promo') || '');
  const [promoApplied, setPromoApplied] = useState(params.get('promo') || '');
  const [promoOpen, setPromoOpen] = useState(Boolean(params.get('promo')));
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [paying, setPaying] = useState(false);

  const tariff = tariffs.find((t) => t.id === tariffId) || null;
  const deviceOptions = tariff?.configurable && tariff.device_options?.length ? tariff.device_options : null;

  useEffect(() => { if (tariffs.length && !tariffs.some((t) => t.id === tariffId)) setTariffId(tariffs[0].id); }, [tariffs, tariffId]);
  useEffect(() => { if (renewKey.data?.device_limit && !params.get('devices')) setDeviceCount(renewKey.data.device_limit); }, [renewKey.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (deviceOptions && !deviceOptions.includes(deviceCount)) setDeviceCount(deviceOptions[0]); }, [tariff]); // eslint-disable-line react-hooks/exhaustive-deps

  // Выбор держим в адресе: можно обновить страницу или поделиться ссылкой.
  useEffect(() => {
    if (!tariffId) return;
    const next = new URLSearchParams(params);
    next.set('tariff', tariffId); next.set('devices', deviceCount);
    if (promoApplied) next.set('promo', promoApplied); else next.delete('promo');
    setParams(next, { replace: true });
  }, [tariffId, deviceCount, promoApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(() => tariffId && ({
    tariff_id: tariffId,
    selected_device_limit: deviceOptions ? deviceCount : undefined,
    coupon_code: promoApplied || undefined,
    autopay_consent: false,
  }), [tariffId, deviceCount, promoApplied, deviceOptions]);
  const debouncedBody = useDebounced(body, 200);
  const path = renewId ? `/keys/${encodeURIComponent(renewId)}/renew` : '/tariffs/purchase';

  useEffect(() => {
    if (!debouncedBody) return undefined;
    const controller = new AbortController();
    setPreviewError(null);
    api.post(path, debouncedBody, { signal: controller.signal, query: { preview: true, force_web: renewId ? true : undefined } })
      .then((res) => { if (!controller.signal.aborted) setPreview({ ...res, _coupon: debouncedBody.coupon_code || '', _request: JSON.stringify(debouncedBody), _path: path }); })
      .catch((err) => { if (err.name !== 'AbortError') { setPreview(null); setPreviewError(err); } });
    return () => controller.abort();
  }, [debouncedBody, path, renewId, retry, config]);

  const stale = !preview || preview._request !== JSON.stringify(body) || preview._path !== path;
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
  const newExpiry = renewKey.data && tariff
    ? (sw?.keeps_period ? Number(renewKey.data.expiry_time)
      : sw ? Date.now() + (tariff.duration_days + Number(sw.credit_days || 0)) * 86400000
        : Math.max(Date.now(), Number(renewKey.data.expiry_time || 0)) + tariff.duration_days * 86400000)
    : null;

  const pay = async () => {
    if (!consent.ready || stale || paying) return;
    setPaying(true);
    try {
      const res = await api.post(path, {
        ...body, ...consent.payload, provider_id: toPay ? choice.provider : undefined, accepted_gross_amount: toPay ? choice.acceptedGross : undefined, ...returnUrls(),
      }, { query: renewId ? { force_web: true } : undefined });
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
  const rk = renewKey.data;

  const button = <Button size="lg" className="btn-block pay-btn" busy={paying} disabled={!consent.ready || !preview || stale || previewError || (toPay > 0 && !choice.provider)} onClick={pay} iconRight="arrow">
    {toPay > 0 ? 'Перейти к оплате' : sw ? (refund > 0 ? 'Сменить тариф' : 'Сменить тариф с баланса') : renewId ? 'Продлить с баланса' : 'Оформить с баланса'}
  </Button>;

  let n = 0;
  return <div className="checkout">
    <PageHead back="/cabinet" title={renewId ? 'Продление подписки' : 'Новая подписка'}
      subtitle={renewId ? 'Новый срок прибавится к текущему — ни одного дня не потеряется.' : 'Трафик без ограничений и все локации. Подписка появится сразу после оплаты.'} />
    {renewKey.error && <ErrorBox error={renewKey.error} />}

    {rk && <div className="renew-strip card">
      <span className="sub-card-icon"><Icon name="shield" size={20} /></span>
      <div className="cell-main"><strong>{rk.alias || cleanName(rk.tariff_name) || 'Подписка'}</strong><span>сейчас до {date(rk.expiry_time)}</span></div>
      {newExpiry && <div className="renew-arrow"><Icon name="arrow" size={16} /><div className="cell-main"><strong className="tone-ok">до {date(newExpiry)}</strong><span>после продления</span></div></div>}
    </div>}

    <div className="checkout-grid">
      <div className="stack" style={{ gap: 16 }}>
        <Step n={++n} title="Срок" hint="Чем дольше — тем дешевле месяц" done={Boolean(tariff)}>
          <PlanPicker tariffs={tariffs} value={tariffId} onChange={setTariffId} />
        </Step>
        {deviceOptions && deviceOptions.length > 1 && <Step n={++n} title="Устройства" hint={devicesText(deviceCount)} done>
          <DeviceStepper options={deviceOptions} value={deviceCount} onChange={setDeviceCount} />
        </Step>}
        {couponsOn && <Step n={++n} title="Промокод" hint="Необязательно" done={promoState === 'ok'}
          aside={<button type="button" className="btn btn-link" aria-controls="checkout-promo" aria-expanded={promoOpen} onClick={() => setPromoOpen(!promoOpen)}>{promoOpen ? 'Свернуть' : promoApplied ? 'Показать код' : 'У меня есть код'}</button>}>
          <div id="checkout-promo" className="expand-track" data-expanded={promoOpen} inert={!promoOpen}>
            <div className="expand-clip"><div className="checkout-promo-fields">
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setPromoApplied(promo.trim().toUpperCase()); }}>
              <Input aria-label="Промокод" placeholder="Введите промокод" value={promo} autoComplete="off" spellCheck="false"
                readOnly={Boolean(promoApplied)} className={promoState ? `promo-${promoState}` : ''}
                onChange={(e) => setPromo(e.target.value.toUpperCase().replace(/\s/g, ''))} />
              {promoApplied
                ? <Button variant="secondary" onClick={() => { setPromo(''); setPromoApplied(''); }}>Убрать</Button>
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
        {toPay > 0 && <Step n={++n} title="Способ оплаты" hint={choice.fee ? `комиссия кассы ${rub(choice.fee)}` : 'без комиссии'} done={Boolean(choice.provider)}>
          <PaymentPicker choice={choice} />
        </Step>}
      </div>

      <Summary eyebrow={sw ? 'Смена тарифа' : renewId ? 'Продление' : 'Service Portal'}
        consents={<PaymentConsents consent={consent} />}
        extra={sw && <div className="switch-note">
          <Icon name="refresh" size={18} />
          <p>Параметры подписки меняются{renewKey.data?.device_limit && deviceOptions && renewKey.data.device_limit !== deviceCount ? ` (${devicesText(renewKey.data.device_limit)} → ${deviceCount})` : ''}.
            Неиспользованный остаток текущей подписки пересчитаем{credit > 0 ? ` (${rub(credit)})` : ''}: он пойдёт в оплату нового тарифа{refund > 0 ? `, а ${rub(refund)} вернутся на баланс` : ''}.
            {sw.keeps_period ? ' Срок окончания не изменится.' : ' Новый срок начнётся сегодня.'}</p>
        </div>} title={tariff ? days(tariff.duration_days) : '—'}
        features={[devicesText(deviceCount), 'Трафик без ограничений', 'Все локации и протоколы']}
        total={previewError ? null : total} button={button}
        note={`После оплаты вы вернётесь на сайт, а подписка ${renewId ? 'продлится' : 'появится в кабинете'} автоматически.`}>
        {previewError ? <ErrorBox error={previewError} /> : !preview ? <div className="skeleton" style={{ height: 64 }} /> : <>
          <Line label={sw ? 'Новый тариф' : 'Стоимость'} value={rub(preview.base_price_rub)} />
          {preview.discount_rub > 0 && <Line label={`Промокод ${preview.applied_coupon_code || ''}`} value={`−${rub(preview.discount_rub)}`} tone="ok" />}
          {credit > 0 && <Line label="Остаток текущей подписки" value={`−${rub(Math.min(credit, preview.base_price_rub - (preview.discount_rub || 0)))}`} tone="ok" />}
          {sw?.credit_days > 0 && <Line label="Остаток пересчитан в дни" value={`+${days(sw.credit_days)}`} tone="ok" />}
          {refund > 0 && <Line label="Вернётся на баланс" value={`+${rub(refund)}`} tone="ok" />}
          {netCost - toPay > 0 && <Line label="С баланса" value={`−${rub(netCost - toPay)}`} />}
          {choice.fee > 0 && toPay > 0 && <Line label="Комиссия кассы" value={rub(choice.fee)} />}
        </>}
      </Summary>
    </div>
  </div>;
}
