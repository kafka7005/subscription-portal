import { PaymentNotice } from './PaymentConsents.jsx';
import { useEffect, useRef, useState } from 'react';
import { days as daysText, rub } from '../lib/format.js';
import { Icon } from '../ui/index.jsx';

// Общие блоки оформления: покупка, продление, подарки, докупка.

// Плавный пересчёт суммы (без анимации при reduced motion).
export function AnimatedRub({ value, className = '' }) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = from.current;
    if (reduce || start === value) { setShown(value); from.current = value; return undefined; }
    let raf; const t0 = performance.now(); const dur = 420;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <span className={`anim-num ${className}`}>{value == null ? '—' : rub(shown)}</span>;
}

export function Step({ n, title, hint, done, children, aside }) {
  return <section className={`step-card card ${done ? 'is-done' : ''}`}>
    <header className="step-head">
      <span className="step-badge">{done ? <Icon name="check" size={15} strokeWidth={2.6} /> : n}</span>
      <div className="step-title"><h2>{title}</h2>{hint && <span>{hint}</span>}</div>
      {aside}
    </header>
    <div className="step-body">{children}</div>
  </section>;
}

// Тарифы: цена за месяц и выгода относительно самого короткого срока.
export function PlanPicker({ tariffs, value, onChange, label = 'Срок' }) {
  const base = tariffs.length ? Math.min(...tariffs.map((t) => t.price_rub / Math.max(1, t.duration_days / 30))) : 0;
  const monthly = (t) => t.price_rub / Math.max(1, t.duration_days / 30);
  const firstMonthly = tariffs[0] ? monthly(tariffs[0]) : 0;
  const best = tariffs.reduce((b, t) => (!b || monthly(t) < monthly(b) ? t : b), null);
  return <div className="plan-grid" role="radiogroup" aria-label={label}>
    {tariffs.map((t, i) => {
      const save = firstMonthly ? Math.round((1 - monthly(t) / firstMonthly) * 100) : 0;
      return <button key={t.id} type="button" role="radio" aria-checked={t.id === value} className="plan-tile" onClick={() => onChange(t.id)}>
        {t === best && tariffs.length > 1 && <span className="plan-flag">Выгоднее всего</span>}
        {i === 1 && t !== best && <span className="plan-flag plan-flag-soft">Популярный</span>}
        <span className="plan-days">{daysText(t.duration_days)}</span>
        <span className="plan-price">{rub(t.price_rub)}</span>
        <span className="plan-month">{t.duration_days >= 60 ? `${rub(Math.round(monthly(t)))} / мес` : 'помесячно'}</span>
        {save > 0 && <span className="plan-save">−{save}%</span>}
        <span className="plan-check" aria-hidden="true"><Icon name="check" size={14} strokeWidth={2.8} /></span>
      </button>;
    })}
    {base === 0 && null}
  </div>;
}

// Устройства: − число + и ряд вариантов.
export function DeviceStepper({ options, value, onChange }) {
  const idx = Math.max(0, options.indexOf(value));
  const set = (i) => onChange(options[Math.max(0, Math.min(options.length - 1, i))]);
  return <div className="device-stepper">
    <div className="stepper-row">
      <button type="button" className="stepper-btn" onClick={() => set(idx - 1)} disabled={idx === 0} aria-label="Меньше устройств">−</button>
      <div className="stepper-value" aria-live="polite"><strong>{value}</strong><span>{value === 1 ? 'устройство' : value < 5 ? 'устройства' : 'устройств'}</span></div>
      <button type="button" className="stepper-btn" onClick={() => set(idx + 1)} disabled={idx === options.length - 1} aria-label="Больше устройств">+</button>
    </div>
    <div className="stepper-track" role="radiogroup" aria-label="Количество устройств">
      {options.map((n) => <button key={n} type="button" role="radio" aria-checked={n === value} className={n <= value ? 'is-filled' : ''} onClick={() => onChange(n)}>{n}</button>)}
    </div>
    <p className="field-hint">Одновременно: телефон, компьютер, планшет, ТВ — каждое устройство занимает одно место.</p>
  </div>;
}

// Итог справа (и копия-панель снизу на телефоне).
export function Summary({ eyebrow, title, features = [], children, total, totalLabel = 'К оплате', button, note, extra, consents }) {
  return <>
    <aside className="summary card" aria-label={eyebrow ? `Итог: ${eyebrow}` : 'Итог'}>
      <div className="summary-top">
        <h2 className="summary-title">{title}</h2>
        {features.length > 0 && <ul className="summary-features">{features.map((f) => <li key={f}><Icon name="check" size={15} strokeWidth={2.4} />{f}</li>)}</ul>}
      </div>
      {extra}
      <dl className="kv summary-lines">{children}</dl>
      <div className="summary-total"><span>{totalLabel}</span><AnimatedRub value={total} /></div>
      {consents}
      {button}
      {note && <p className="field-hint">{note}</p>}
    </aside>
    <div className="pay-bar">
      <PaymentNotice />
      <div className="pay-bar-sum"><span>{totalLabel}</span><AnimatedRub value={total} /></div>
      {button}
    </div>
  </>;
}

export function Line({ label, value, tone }) {
  return <div className="kv-row"><dt>{label}</dt><dd className={tone ? `tone-${tone}` : ''}>{value}</dd></div>;
}
