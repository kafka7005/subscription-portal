import { useEffect, useState } from 'react';
import { rub } from '../lib/format.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Icon, useToast } from '../ui/index.jsx';

// Ежедневный бонус на баланс (тумблер DAILY_BONUS_ENABLED в настройках бота → раздел бонусов).
// GET /api/bonus/daily/me — состояние, POST /api/bonus/daily/me/claim — забрать.

function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds || 0);
  useEffect(() => {
    setLeft(seconds || 0);
    if (!seconds) return undefined;
    const started = Date.now();
    const id = setInterval(() => setLeft(Math.max(0, seconds - Math.floor((Date.now() - started) / 1000))), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

const clock = (s) => {
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

export default function DailyBonus({ onClaimed }) {
  const { config } = useAuth();
  const toast = useToast();
  const enabled = Boolean(config?.features?.daily_bonus_enabled);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [lastAmount, setLastAmount] = useState(null);
  const [credited, setCredited] = useState(false);
  useEffect(() => {
    if (!credited) return;
    const timer = setTimeout(() => setCredited(false), 2800);
    return () => clearTimeout(timer);
  }, [credited]);
  const left = useCountdown(state && !state.can_claim ? state.seconds_left : 0);

  const load = () => api.get('/bonus/daily/me').then(setState).catch(() => setState(null));
  useEffect(() => { if (enabled) load(); else setState(null); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state && !state.can_claim && state.seconds_left && left === 0) load(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !state?.enabled) return null;
  const ready = state.can_claim && !credited;

  const claim = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const r = await api.post('/bonus/daily/me/claim');
      if (r?.ok === false) throw new Error(r.reason || 'Бонус пока недоступен');
      setLastAmount(Number.isFinite(r.amount) ? r.amount : null);
      setCredited(true);
      if (r.state) setState(r.state); else await load();
      onClaimed?.();
    } catch (err) { toast.error(err); await load(); } finally { setBusy(false); }
  };

  return <section className="bonus-reward" data-phase={ready ? 'ready' : credited ? 'credited' : 'waiting'} aria-label="Ежедневный бонус">
    <span className="bonus-emblem" aria-hidden="true">
      <Icon key={ready ? 'gift' : 'check'} name={ready ? 'gift' : 'check'} size={21} />
    </span>
    <div className="bonus-details">
      <strong>{ready ? 'Ежедневный бонус' : 'Бонус получен'}</strong>
      <small>{ready
        ? (state.streak ? `Серия: ${state.streak} дн.` : 'Доступен сегодня')
        : `Следующий через ${clock(left)}${state.streak ? ` · серия ${state.streak} дн.` : ''}`}</small>
    </div>
    {ready && <button type="button" className="bonus-claim" onClick={claim} disabled={busy} aria-busy={busy}>
      {busy ? 'Начисляем…' : 'Забрать бонус'}
    </button>}
    <div className="bonus-receipt" role="status">
      {!ready && (credited || lastAmount != null) && <span>Зачислено на баланс{lastAmount != null && <> <strong>+{rub(lastAmount)}</strong></>}</span>}
    </div>
  </section>;
}
