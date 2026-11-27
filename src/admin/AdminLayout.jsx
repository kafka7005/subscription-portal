import { readModuleVersion } from './ModuleUpdates.jsx';
import { useLoad } from '../lib/hooks.js';
import { reviewApi } from '../lib/reviews.js';
import { useGiveawayConfig } from '../lib/giveaways.js';
import { Notifications } from '../cabinet/Topbar.jsx';
import { UpdateNotice } from './SiteUpdates.jsx';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from '../ui/ErrorBoundary.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApplyCabinetTheme, useCabinetTheme } from '../lib/theme.js';
import { Button, Icon } from '../ui/index.jsx';
import { AppBrand, Drawer, MenuButton, Sidebar, useDrawer } from '../ui/shell.jsx';

// Пункты меню и кому они видны. Модератор (role=moderator) работает с клиентами
// и поддержкой; тарифы, промокоды, серверы и рассылки — только у админа.
export function adminNav({ isAdmin, unanswered, partnerOn, payouts, giveawaysOn }) {
  return [
    { group: 'Обзор' },
    { to: '/admin', end: true, icon: 'chart', label: 'Сводка' },
    isAdmin && { to: '/admin/statistics', icon: 'chart', label: 'Статистика бота' },
    { group: 'Клиенты' },
    { to: '/admin/users', icon: 'users', label: 'Пользователи' },
    { to: '/admin/subscriptions', icon: 'shield', label: 'Подписки' },
    { to: '/admin/payments', icon: 'card', label: 'Платежи' },
    { to: '/admin/tickets', icon: 'chat', label: 'Поддержка', count: unanswered },
    isAdmin && partnerOn && { to: '/admin/partners', icon: 'handshake', label: 'Партнёры', count: payouts },
    isAdmin && { group: 'Продажи' },
    isAdmin && { to: '/admin/tariffs', icon: 'tag', label: 'Тарифы' },
    giveawaysOn && { to: '/admin/giveaways', icon: 'gift', label: 'Розыгрыши' },
    isAdmin && { to: '/admin/coupons', icon: 'gift', label: 'Промокоды' },
    isAdmin && { group: 'Сервис' },
    isAdmin && { to: '/admin/servers', icon: 'server', label: 'Серверы' },
    isAdmin && { to: '/admin/broadcast', icon: 'send', label: 'Рассылка' },
    isAdmin && { to: '/admin/settings', icon: 'settings', label: 'Настройки бота' },
    isAdmin && { to: '/admin/audit', icon: 'file', label: 'Журнал действий' },
    isAdmin && { to: '/admin/site', icon: 'file', label: 'Сайт' },
  ].filter(Boolean);
}


export default function AdminLayout() {
  const { isAdmin, logout, me, config } = useAuth();
  const navigate = useNavigate();
  const drawer = useDrawer();
  const location = useLocation();
  const theme = useCabinetTheme();
  useApplyCabinetTheme(theme.light);
  const [mobileHeader, setMobileHeader] = useState(() => window.matchMedia('(max-width: 999px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 999px)');
    const sync = () => setMobileHeader(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const onDashboard = location.pathname.replace(/\/$/, '') === '/admin';
  const partnerOn = isAdmin && Boolean(config?.features?.partner_enabled);
  const module = useLoad(signal => isAdmin ? readModuleVersion(signal) : null, [isAdmin, me?.id]);
  const tickets = useLoad(signal => api.get('/admin/tickets-metrics', null, { signal }), [location.pathname, me?.id]);
  const pendingPayouts = useLoad(signal => partnerOn ? api.get('/partners/payouts/pending', { limit: 1 }, { signal }) : null,
    [partnerOn, location.pathname, me?.id]);
  const reviews = useLoad(signal => isAdmin && onDashboard ? api.get(reviewApi + '/admin/pending-count', null, { signal }) : null,
    [isAdmin, onDashboard, me?.id]);
  const refreshTickets = tickets.reload, refreshPayouts = pendingPayouts.reload, refreshReviews = reviews.reload, refreshVersion = module.reload;
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      refreshTickets(true);
      if (partnerOn) refreshPayouts(true);
      if (isAdmin && onDashboard) refreshReviews(true);
      if (isAdmin) refreshVersion(true);
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [partnerOn, isAdmin, onDashboard, refreshTickets, refreshPayouts, refreshReviews, refreshVersion]);
  const byStatus = tickets.data?.by_status;
  const unanswered = byStatus && !tickets.error ? (byStatus.open || 0) + (byStatus.pending || 0) : null;
  const payouts = partnerOn && !pendingPayouts.error ? pendingPayouts.data?.total : null;
  const attention = {
    unanswered, payouts, reviews: isAdmin && !reviews.error ? reviews.data?.count : null,
    reviewCountMissing: [404, 405].includes(reviews.error?.status),
    failed: [tickets.error && 'обращения', partnerOn && pendingPayouts.error && 'заявки на вывод',
      isAdmin && reviews.error && ![404, 405].includes(reviews.error.status) && 'отзывы'].filter(Boolean),
  };

  const giveawayConfig = useGiveawayConfig();
  const items = adminNav({ giveawaysOn: isAdmin && giveawayConfig?.manage, isAdmin, unanswered, payouts, partnerOn: config?.features?.partner_enabled });
  const footer = <>
    {isAdmin && <UpdateNotice />}
    <Button variant="ghost" size="sm" icon="download" href="/admin-install.html">На экран «Домой»</Button>
    <Button variant="secondary" size="sm" icon="home" to="/cabinet">Мой кабинет</Button>
    <Button variant="ghost" size="sm" icon="logout" onClick={async () => { if (await logout()) navigate('/', { replace: true }); }}>Выйти</Button>
  </>;
  const roleBadge = isAdmin ? 'Админ' : me?.role === 'moderator' ? 'Модер' : 'Staff';
  const themeButton = <button type="button" className="top-icon admin-theme-toggle" onClick={theme.toggle}
    aria-label={theme.light ? 'Тёмная тема' : 'Светлая тема'} title={theme.light ? 'Тёмная тема' : 'Светлая тема'}>
    <Icon name={theme.light ? 'moon' : 'sun'} />
  </button>;

  return <div className="app theme-admin theme-cabinet">
    <div className="app-shell">
      <Sidebar items={items} brandTo="/admin" brandBadge={roleBadge} footer={footer} />
      <div className="app-column">
        <header className="mobile-bar">
          <MenuButton onClick={drawer.show} />
          <AppBrand to="/admin" badge={roleBadge} />
          {themeButton}
          {isAdmin && mobileHeader && <Notifications />}
        </header>
        <header className="topbar admin-topbar">
          <span className="admin-workspace">Управление сервисом <span className="badge">{roleBadge}</span></span>
          <div className="topbar-right">{isAdmin && !mobileHeader && <Notifications />}{themeButton}<Button variant="ghost" size="sm" icon="home" to="/cabinet">Мой кабинет</Button></div>
        </header>
        <main className="app-main">
          <div className="app-content page-enter" key={location.pathname}><ErrorBoundary resetKey={location.pathname}><Outlet context={{ moduleVersion: module.error ? null : module.data, attention }} /></ErrorBoundary></div>
        </main>
      </div>
    </div>
    <Drawer open={drawer.open} onClose={drawer.hide}>
      <Sidebar items={items} brandTo="/admin" brandBadge={roleBadge} footer={footer} onNavigate={drawer.hide} />
    </Drawer>
  </div>;
}
