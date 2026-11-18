import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, onUnauthorized } from './api.js';
import { syncPushSubscription } from './push.js';
import { readTelegramInitData, setupTelegramSdk } from './telegramWebApp.js';
import { FullPageSpinner } from '../ui/index.jsx';

const AuthContext = createContext(null);

// Роли бота: admin — всё; moderator — поддержка и клиенты; designer — только дизайн сайта.
export const STAFF_ROLES = ['admin', 'moderator'];

export function AuthProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined — ещё грузим, null — гость
  const [config, setConfig] = useState(null);

  useEffect(() => {
    if (!me?.id) return;
    const sync = () => { if (!document.hidden) syncPushSubscription().catch(() => {}); };
    sync();
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [me?.id]);

  const refresh = useCallback(async () => {
    try {
      const identity = await api.get('/auth/me');
      setMe(identity);
      return identity;
    } catch {
      // Открыли из Telegram (Mini App) — входим автоматически по подписанным данным Telegram.
      const initData = readTelegramInitData();
      if (initData) {
        try {
          const res = await api.post('/auth/login-telegram-webapp', { init_data: initData });
          sessionStorage.removeItem('portal-tg-initdata');
          setMe(res.identity);
          return res.identity;
        } catch { /* подпись устарела — покажем обычный вход */ }
      }
      setMe(null);
      return null;
    }
  }, []);

  // Тумблеры бота применяются мгновенно, поэтому site-config перечитываем:
  // при возврате на вкладку, раз в минуту и сразу после изменений в админке.
  const refreshConfig = useCallback(() => api.get('/site-config').then(setConfig).catch(() => setConfig((c) => c || {})), []);

  useEffect(() => {
    setupTelegramSdk();
    refresh();
    refreshConfig();
    onUnauthorized(() => setMe((current) => (current ? null : current)));
    const onVisible = () => { if (!document.hidden) refreshConfig(); };
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(onVisible, 60000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(id); };
  }, [refresh, refreshConfig]);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* cookie всё равно очищаем на клиенте */ }
    setMe(null);
  }, []);

  const value = useMemo(() => ({
    me,
    config,
    loading: me === undefined,
    isStaff: Boolean(me?.is_admin && STAFF_ROLES.includes(me?.role || 'admin')),
    isAdmin: Boolean(me?.is_admin && (me?.role || 'admin') === 'admin'),
    refresh,
    refreshConfig,
    setMe,
    logout,
  }), [me, config, refresh, refreshConfig, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function RequireAuth({ children }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function RequireStaff({ children }) {
  const { me, loading, isStaff } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!isStaff) return <Navigate to="/cabinet" replace />;
  return children;
}
