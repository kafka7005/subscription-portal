import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle } from '../lib/hooks.js';
import { Button, Icon } from '../ui/index.jsx';
import PublicCabinetShell from '../ui/PublicCabinetShell.jsx';

// Вход в приложение Service Portal через кабинет (OAuth 2.0 + PKCE, RFC 8252).
// Приложение открывает /app/authorize?…; гость сначала входит как обычно (RequireAuth),
// затем подтверждает доступ, и браузер уходит на http://127.0.0.1:<порт>/callback?code=…
const CLIENTS = {
  'portal-desktop': { name: 'Service Portal для компьютера', icon: 'windows' },
};
const REDIRECT_RE = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/callback$/;

function withQuery(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  return url.toString();
}

export default function AppAuthorize() {
  useDocumentTitle('Вход в приложение');
  const [params] = useSearchParams();
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const req = useMemo(() => ({
    responseType: params.get('response_type'),
    clientId: params.get('client_id') || '',
    redirectUri: params.get('redirect_uri') || '',
    state: params.get('state'),
    challenge: params.get('code_challenge') || '',
    method: params.get('code_challenge_method') || 'S256',
  }), [params]);
  const client = CLIENTS[req.clientId];
  const port = Number(req.redirectUri.match(REDIRECT_RE)?.[1] || 0);
  const problem = !client ? 'Неизвестное приложение.'
    : !(port > 0 && port < 65536) ? 'Приложение передало недопустимый адрес возврата.'
      : req.responseType !== 'code' || req.method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(req.challenge) ? 'Запрос на вход повреждён.'
        : null;

  const allow = async () => {
    setBusy('allow'); setError(null);
    try {
      const res = await api.post('/app/authorize', {
        client_id: req.clientId, redirect_uri: req.redirectUri, state: req.state,
        code_challenge: req.challenge, code_challenge_method: req.method,
      });
      setDone('ok');
      window.location.assign(res.redirect);
    } catch (err) { setError(err); setBusy(null); }
  };
  const deny = () => {
    setBusy('deny'); setDone('denied');
    window.location.assign(withQuery(req.redirectUri, { error: 'access_denied', state: req.state }));
  };
  const switchAccount = async () => {
    if (!(await logout())) return;
    navigate(`/login?next=${encodeURIComponent(`/app/authorize?${params.toString()}`)}`, { replace: true });
  };

  const name = me?.display_name || (me?.username ? `@${me.username}` : me?.email) || 'Ваш аккаунт';
  return <PublicCabinetShell className="app-auth" contentClassName="service-centered">
      <section className="card card-padded app-auth-card page-enter">
        {problem ? <div className="stack">
          <div className="app-auth-icon is-bad"><Icon name="x" size={28} /></div>
          <h1>Не получилось начать вход</h1>
          <p className="muted">{problem} Закройте эту вкладку и нажмите «Войти» в приложении ещё раз.</p>
        </div> : done ? <div className="stack app-auth-done">
          <div className={`app-auth-icon ${done === 'ok' ? 'is-ok' : ''}`}><Icon name={done === 'ok' ? 'check' : 'x'} size={28} /></div>
          <h1>{done === 'ok' ? 'Готово' : 'Вход отменён'}</h1>
          <p className="muted">{done === 'ok' ? 'Возвращайтесь в приложение — оно уже получило доступ. Эту вкладку можно закрыть.' : 'Приложение не получило доступ. Эту вкладку можно закрыть.'}</p>
        </div> : <div className="stack">
          <div className="app-auth-pair" aria-hidden="true">
            <span className="app-auth-icon"><Icon name={client.icon} size={26} /></span>
            <span className="app-auth-link"><Icon name="link" size={18} /></span>
            <span className="app-auth-icon is-brand"><img src="/icons/logo.svg" alt="" width="34" height="34" /></span>
          </div>
          <h1>Войти в {client.name}?</h1>
          <p className="muted">Приложение получит доступ к вашему аккаунту:</p>
          <ul className="app-auth-scopes">
            <li><Icon name="shield" size={18} />Ссылки ваших подписок — чтобы подключаться без ручной настройки</li>
            <li><Icon name="user" size={18} />Имя и почта — чтобы показать, в какой аккаунт выполнен вход</li>
          </ul>
          <div className="app-auth-account">
            <span className="avatar">{name.replace('@', '').slice(0, 1).toUpperCase()}</span>
            <div className="cell-main"><strong>{name}</strong><span className="muted">{me?.email || 'Вход выполнен'}</span></div>
            <button type="button" className="link-btn" onClick={switchAccount}>Сменить</button>
          </div>
          {error && <p className="field-error">{error.message}</p>}
          <div className="app-auth-actions">
            <Button variant="secondary" onClick={deny} disabled={Boolean(busy)}>Отмена</Button>
            <Button onClick={allow} busy={busy === 'allow'} disabled={Boolean(busy)}>Разрешить</Button>
          </div>
          <p className="help-text">Отключить приложение можно в любой момент: Профиль → Активные сессии.</p>
        </div>}
      </section>
  </PublicCabinetShell>;
}
