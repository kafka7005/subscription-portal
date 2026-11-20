import { useGiveawayConfig } from '../lib/giveaways.js';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { Button, Icon } from '../ui/index.jsx';
import { Sidebar } from '../ui/shell.jsx';
import ErrorBoundary from '../ui/ErrorBoundary.jsx';
import Topbar from './Topbar.jsx';
import SiteBanner from './SiteBanner.jsx';
import LinkEmailModal from './LinkEmail.jsx';
import DownloadModal from './DownloadModal.jsx';
import DocsMenu from '../ui/DocsMenu.jsx';
import { useSiteSettings } from '../lib/siteSettings.js';
import { useApplyCabinetTheme, useCabinetTheme } from '../lib/theme.js';

const EMAIL_REMINDER = 'portal-email-reminder';

// Все разделы кабинета. available — включён ли раздел в боте (site-config.features).
export const CABINET_SECTIONS = [
  { key: 'home', to: '/cabinet', end: true, icon: 'home', label: 'Главная', short: 'Главная', locked: true },
  { key: 'payments', to: '/cabinet/payments', icon: 'card', label: 'Платежи', short: 'Платежи' },
  { key: 'giveaways', to: '/cabinet/giveaways', icon: 'gift', label: 'Розыгрыши', short: 'Розыгрыши', feature: 'giveaways_enabled' },
  { key: 'gifts', to: '/cabinet/gifts', icon: 'gift', label: 'Подарки', short: 'Подарки', feature: 'gift_enabled' },
  { key: 'partner', to: '/cabinet/partner', icon: 'handshake', label: 'Партнёрка', short: 'Партнёрка', feature: 'partner_enabled' },
  { key: 'faq', to: '/cabinet/faq', icon: 'help', label: 'Частые вопросы', short: 'FAQ' },
  { key: 'status', to: '/cabinet/status', icon: 'server', label: 'Статус сервиса', short: 'Статус', siteFlag: 'service_notice', siteEnabledKey: 'page_enabled' },
  { key: 'support', to: '/cabinet/support', icon: 'chat', label: 'Поддержка', short: 'Помощь', feature: 'support_tickets_enabled', defaultOn: true },
  { key: 'profile', to: '/cabinet/profile', icon: 'user', label: 'Профиль', short: 'Профиль', locked: true },
];
const DEFAULT_MOBILE = ['home', 'payments', 'partner', 'support', 'profile'];

export function sectionAvailable(sec, features, site) {
  if (sec.siteFlag && (sec.siteEnabledKey ? site?.[sec.siteFlag]?.[sec.siteEnabledKey] === false : !site?.[sec.siteFlag]?.enabled)) return false;
  if (!sec.feature) return true;
  return sec.defaultOn ? features[sec.feature] !== false : Boolean(features[sec.feature]);
}

// Порядок и видимость задаются в админке → Сайт → Меню (kz-site.nav).
export function cabinetNav(features, nav = [], site = null) {
  const conf = new Map((nav || []).map((n, i) => [n.key, { ...n, order: i }]));
  const items = CABINET_SECTIONS
    .filter((sec) => sectionAvailable(sec, features, site))
    .map((sec, i) => {
      const c = conf.get(sec.key);
      return {
        ...sec,
        label: c?.label || sec.label,
        short: c?.short || sec.short,
        side: sec.locked ? true : c ? c.side !== false : true,
        mobile: c ? Boolean(c.mobile) : DEFAULT_MOBILE.includes(sec.key),
        order: c ? c.order : 100 + i,
      };
    })
    .sort((x, y) => x.order - y.order);
  return {
    side: items.filter((i) => i.side),
    mobile: (items.some((i) => i.mobile) ? items.filter((i) => i.mobile) : items).slice(0, 5),
  };
}

export default function CabinetLayout() {
  const { me, config, isStaff, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const summary = useLoad((signal) => api.get('/auth/summary', null, { signal }), [me?.id, me?.email, me?.tg_id]);
  const giveawayConfig = useGiveawayConfig();
  const features = { ...config?.features, giveaways_enabled: giveawayConfig?.enabled };
  const site = useSiteSettings();
  const theme = useCabinetTheme();
  useApplyCabinetTheme(theme.light);
  const { side: items, mobile: tabs } = cabinetNav(features, site?.nav, site);
  const [emailAsk, setEmailAsk] = useState(false);
  // Окно загрузки приложений (админка → Сайт → Загрузка). Открывается и по ссылке ?download=1.
  const [params, setParams] = useSearchParams();
  const downloadsOn = Boolean(site?.downloads?.enabled);
  const downloadOpen = downloadsOn && params.get('download') === '1';
  const openDownload = () => { const p = new URLSearchParams(params); p.set('download', '1'); setParams(p); };
  const closeDownload = () => { const p = new URLSearchParams(params); p.delete('download'); setParams(p, { replace: true }); };

  // Тем, у кого нет почты, один раз за сессию предлагаем её привязать.
  useEffect(() => {
    if (!me || me.email || config?.auth?.email_code_login_enabled === false) return;
    let shown = false;
    try { shown = sessionStorage.getItem(EMAIL_REMINDER) === '1'; } catch { /* ignore */ }
    if (shown) return;
    const id = setTimeout(() => setEmailAsk(true), 900);
    return () => clearTimeout(id);
  }, [me, config]);
  const closeEmailAsk = () => {
    try { sessionStorage.setItem(EMAIL_REMINDER, '1'); } catch { /* ignore */ }
    setEmailAsk(false);
  };

  const onLogout = async () => { await logout(); navigate('/', { replace: true }); };

  return <div className={`app theme-cabinet ${theme.light ? 'is-light' : ''}`}>
    <div className="app-shell">
      <Sidebar items={items} brandTo="/" footer={<>
        {downloadsOn && <button type="button" className="side-download" onClick={openDownload}>
          <span className="side-download-icon"><Icon name="download" size={18} /></span>
          <span className="side-download-text"><strong>Скачать</strong><small>Приложение Service Portal</small></span>
        </button>}
        {isStaff && <Button variant="secondary" size="sm" icon="settings" to="/admin">Админка</Button>}
        <Button variant="ghost" size="sm" icon="logout" onClick={onLogout}>Выйти</Button>
        <DocsMenu variant="side" />
      </>} />
      <div className="app-column">
        <SiteBanner />
        <Topbar summary={summary.data} isStaff={isStaff} theme={theme} onDownload={downloadsOn ? openDownload : null} />
        <main className="app-main">
          <div className="app-content page-enter" key={location.pathname}>
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet context={{ summary, giveawaysVisible: Boolean(giveawayConfig?.enabled) }} />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
    <nav className="tabbar" aria-label="Разделы кабинета">
      {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}>
        <Icon name={t.icon} size={22} /><span>{t.short}</span>
      </NavLink>)}
    </nav>
    <LinkEmailModal open={emailAsk} reminder onClose={closeEmailAsk} />
    <DownloadModal open={downloadOpen} onClose={closeDownload} downloads={site?.downloads} />
  </div>;
}
