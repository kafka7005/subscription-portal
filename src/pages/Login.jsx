import { useBackdropDismiss } from '../lib/hooks.js';
import { safeNext } from '../lib/safeNext.js';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, ErrorBox, IconButton, Input, Segmented } from '../ui/index.jsx';
import { TelegramIcon } from '../ui/icons.jsx';
import { applyStoredReferral, rememberReferral } from '../lib/referral.js';
import { startTelegramAuth } from '../lib/telegramAuth.js';
import { links } from '../lib/site.js';
import Landing from '../landing/Landing.jsx';

// Яндекс включается флагом сборки, когда его redirect URI в config.py бота
// переведён на этот домен (см. docs/SETUP.md). Google на сайте не используется.
const YANDEX_ENABLED = import.meta.env.VITE_YANDEX_ENABLED === 'true';

export { safeNext };

export function TelegramLoginButton({ next, mode = 'login', label = 'Войти через Telegram' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await startTelegramAuth({ mode, next }); } catch (err) { setError(err); setBusy(false); }
  };
  return <div className="tg-login">
    <button type="button" className="btn-telegram" onClick={go} disabled={busy} aria-busy={busy || undefined}>
      {busy ? <span className="spinner spinner-sm" /> : <TelegramIcon size={22} />}
      <span>{label}</span>
    </button>
    {error && <p className="field-error">{error.message}</p>}
  </div>;
}

// Содержимое окна входа: Telegram (OAuth), код на почту, пароль, восстановление.
export function LoginPanel({ next = '/cabinet', onDone }) {
  const { config, setMe } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('code');
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');

  const auth = config?.auth || {};
  const telegramOn = auth.telegram_login_enabled !== false;
  const emailOn = auth.email_code_login_enabled !== false;

  const finish = async (identity) => {
    setMe(identity);
    await applyStoredReferral(identity);
    onDone?.();
    navigate(next, { replace: true });
  };
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const sendCode = (e) => {
    e?.preventDefault();
    run(async () => {
      if (mode === 'reset') await api.post('/auth/request-password-reset', { email: email.trim(), allow_register: false });
      else await api.post('/auth/send-login-code', { email: email.trim(), allow_register: true });
      setStep('code');
      setInfo(`Код отправлен на ${email.trim()}. Проверьте почту и папку «Спам».`);
    });
  };
  const confirmCode = (e) => {
    e.preventDefault();
    run(async () => {
      const res = mode === 'reset'
        ? await api.post('/auth/confirm-password-reset', { email: email.trim(), code: code.trim(), password, password_confirm: password2 })
        : await api.post('/auth/login-by-code', { email: email.trim(), code: code.trim() });
      await finish(res.identity);
    });
  };
  const loginPassword = (e) => {
    e.preventDefault();
    run(async () => { const res = await api.post('/auth/login', { email: email.trim(), password }); await finish(res.identity); });
  };
  const switchMode = (m) => { setMode(m); setStep('email'); setCode(''); setError(null); setInfo(''); };

  return <div className="login-panel">
    <div className="login-head">
      <img src="/icons/logo.svg" alt="" width="56" height="56" />
      <h2>{mode === 'reset' ? 'Восстановление пароля' : 'Вход в Service Portal'}</h2>
      <p className="muted">{mode === 'reset' ? 'Пришлём код на почту, затем зададите новый пароль.' : 'Аккаунт создастся автоматически при первом входе.'}</p>
    </div>

    {telegramOn && mode !== 'reset' && <>
      <TelegramLoginButton next={next} />
      <p className="field-hint center">Тот же аккаунт, что и в боте{config?.bot_username ? ` @${config.bot_username}` : ''}</p>
      {emailOn && <div className="auth-or"><span>или по почте</span></div>}
    </>}

    {emailOn && <>
      {mode !== 'reset' && <Segmented label="Способ входа" value={mode} onChange={switchMode}
        options={[{ value: 'code', label: 'Код на почту' }, { value: 'password', label: 'Пароль' }]} />}
      <ErrorBox error={error} />
      {info && step === 'code' && <div className="notice">{info}</div>}

      {mode === 'password' && <form className="stack" onSubmit={loginPassword}>
        <Input label="Почта" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Input label="Пароль" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" size="lg" className="btn-block" busy={busy}>Войти</Button>
        <button type="button" className="btn btn-link auth-link" onClick={() => switchMode('reset')}>Забыли пароль?</button>
      </form>}

      {mode !== 'password' && step === 'email' && <form className="stack" onSubmit={sendCode}>
        <Input label="Почта" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Button type="submit" size="lg" variant={telegramOn ? 'secondary' : 'primary'} className="btn-block" busy={busy} iconRight="arrow">Получить код</Button>
        {mode === 'reset' && <button type="button" className="btn btn-link auth-link" onClick={() => switchMode('password')}>Вспомнил пароль</button>}
      </form>}

      {mode !== 'password' && step === 'code' && <form className="stack" onSubmit={confirmCode}>
        <Input label="Код из письма" inputMode="numeric" autoComplete="one-time-code" required value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} placeholder="123456" autoFocus maxLength={12} />
        {mode === 'reset' && <>
          <Input label="Новый пароль" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} hint="Не короче 8 символов" />
          <Input label="Повторите пароль" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)}
            error={password2 && password !== password2 ? 'Пароли не совпадают' : null} />
        </>}
        <Button type="submit" size="lg" className="btn-block" busy={busy} disabled={mode === 'reset' && password !== password2}>
          {mode === 'reset' ? 'Сохранить и войти' : 'Войти'}
        </Button>
        <div className="row-between">
          <button type="button" className="btn btn-link auth-link" onClick={() => { setStep('email'); setCode(''); setInfo(''); }}>Другая почта</button>
          <button type="button" className="btn btn-link auth-link" disabled={busy} onClick={sendCode}>Отправить ещё раз</button>
        </div>
      </form>}
    </>}

    {!emailOn && <ErrorBox error={error} />}
    {YANDEX_ENABLED && auth.yandex_login_enabled && mode !== 'reset' &&
      <Button variant="ghost" href={`/api/auth/yandex/authorize?return_to=${encodeURIComponent(next)}`} className="btn-block">Войти через Яндекс</Button>}
    <p className="auth-legal">Входя, вы принимаете <a href={links.offer}>оферту</a> и <a href={links.rules}>правила сервиса</a>.</p>
  </div>;
}

// Окно входа поверх текущей страницы (оформлено как остальные окна кабинета).
export function LoginModal({ open, onClose, next }) {
  const backdrop = useBackdropDismiss(onClose);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="app login-overlay" role="dialog" aria-modal="true" aria-label="Вход" {...backdrop}>
    <div className="login-sheet card">
      <IconButton icon="x" label="Закрыть" className="login-close" onClick={onClose} />
      <LoginPanel next={next} onDone={onClose} />
    </div>
  </div>;
}

// /login — главная с открытым окном входа (сюда ведут защищённые страницы без сессии).
export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const next = safeNext(params.get('next'));
  useEffect(() => { rememberReferral(params.get('ref')); }, [params]);
  useEffect(() => { if (me) navigate(next, { replace: true }); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <Landing />
    {!me && <LoginModal open next={next} onClose={() => navigate('/', { replace: true })} />}
  </>;
}
