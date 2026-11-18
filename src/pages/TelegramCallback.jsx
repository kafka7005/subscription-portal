import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { finishTelegramAuth } from '../lib/telegramAuth.js';
import { applyStoredReferral } from '../lib/referral.js';
import { Button } from '../ui/index.jsx';
import { AppBrand } from '../ui/shell.jsx';

// Сюда Telegram возвращает пользователя после входа (/auth/telegram?code=…&state=…).
export default function TelegramCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setMe } = useAuth();
  const [error, setError] = useState(null);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return; // StrictMode вызывает эффект дважды, а код одноразовый
    done.current = true;
    finishTelegramAuth(params)
      .then(async ({ identity, next }) => {
        setMe(identity);
        await applyStoredReferral(identity);
        navigate(next, { replace: true });
      })
      .catch(setError);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="app auth-page">
    <header className="auth-top"><AppBrand to="/" /></header>
    <main className="auth-main">
      <div className="auth-card card card-padded result-card">
        {!error ? <><span className="spinner" /><p className="muted">Входим через Telegram…</p></> : <>
          <h1 className="auth-title">Не получилось войти</h1>
          <p className="muted">{error.message}</p>
          <Button className="btn-block" to="/login">Попробовать снова</Button>
        </>}
      </div>
    </main>
  </div>;
}
