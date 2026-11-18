import { StrictMode, Suspense, lazy as reactLazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, RequireAuth, RequireStaff, useAuth } from './lib/auth.jsx';
import { notificationTarget } from './lib/notificationTarget.js';
import { useSiteSettings } from './lib/siteSettings.js';
import { forgetReferral, rememberReferral } from './lib/referral.js';
import { FullPageSpinner, UiProvider } from './ui/index.jsx';
import ErrorBoundary, { reloadForStaleChunk } from './ui/ErrorBoundary.jsx';
import Login from './pages/Login.jsx';
import Landing from './landing/Landing.jsx';
import './landing/approved.css';
import './app.css';
import './app2.css';
import './app3.css';
import './app4.css';
import './app5.css';
import './app6.css';
import './app7.css';
import './app8.css';
import './cabinet.css';
import './admin.css';
import './landing/graphite.css';
import './mobile.css';



// Кабинет и админка грузятся отдельными чанками: лендинг остаётся лёгким.
// Если вкладка открыта со старого релиза и чанка уже нет — один раз перезагружаем страницу.
const lazy = (loader) => reactLazy(() => loader().catch((err) => {
  if (reloadForStaleChunk(err)) return new Promise(() => {});
  throw err;
}));

const TelegramCallback = lazy(() => import('./pages/TelegramCallback.jsx'));
const PaymentResult = lazy(() => import('./pages/PaymentResult.jsx'));
const Doc = lazy(() => import('./pages/Doc.jsx'));
const DocsIndex = lazy(() => import('./pages/Doc.jsx').then((m) => ({ default: m.DocsIndex })));
const Maintenance = lazy(() => import('./pages/Maintenance.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const AppAuthorize = lazy(() => import('./pages/AppAuthorize.jsx'));
const PublicFaq = lazy(() => import('./pages/Help.jsx').then((m) => ({ default: m.PublicFaq })));
const CabinetFaq = lazy(() => import('./pages/Help.jsx').then((m) => ({ default: m.CabinetFaq })));
const CabinetLayout = lazy(() => import('./cabinet/CabinetLayout.jsx'));
const CabinetHome = lazy(() => import('./cabinet/Home.jsx'));
const Subscription = lazy(() => import('./cabinet/Subscription.jsx'));
const Buy = lazy(() => import('./cabinet/Buy.jsx'));
const Payments = lazy(() => import('./cabinet/Payments.jsx'));
const Partner = lazy(() => import('./cabinet/Partner.jsx'));
const Gifts = lazy(() => import('./cabinet/Gifts.jsx'));
const Support = lazy(() => import('./cabinet/Support.jsx'));
const Ticket = lazy(() => import('./cabinet/Ticket.jsx'));
const Profile = lazy(() => import('./cabinet/Profile.jsx'));
const ServiceStatus = lazy(() => import('./cabinet/ServiceStatus.jsx'));
const AdminLayout = lazy(() => import('./admin/AdminLayout.jsx'));
const Dashboard = lazy(() => import('./admin/Dashboard.jsx'));
const Users = lazy(() => import('./admin/Users.jsx'));
const UserCard = lazy(() => import('./admin/UserCard.jsx'));
const Subscriptions = lazy(() => import('./admin/Subscriptions.jsx'));
const SubscriptionAdmin = lazy(() => import('./admin/SubscriptionAdmin.jsx'));
const AdminPayments = lazy(() => import('./admin/Payments.jsx'));
const Tickets = lazy(() => import('./admin/Tickets.jsx'));
const TicketAdmin = lazy(() => import('./admin/TicketAdmin.jsx'));
const Partners = lazy(() => import('./admin/Partners.jsx'));
const Tariffs = lazy(() => import('./admin/Tariffs.jsx'));
const Coupons = lazy(() => import('./admin/Coupons.jsx'));
const Servers = lazy(() => import('./admin/Servers.jsx'));
const Broadcast = lazy(() => import('./admin/Broadcast.jsx'));
const SiteAdmin = lazy(() => import('./admin/Site.jsx'));
const BotSettings = lazy(() => import('./admin/Settings.jsx'));
const AdminAudit = lazy(() => import('./admin/Audit.jsx'));

// При переходе между страницами — наверх (кроме якорей на главной).
function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => { if (!window.location.hash) window.scrollTo(0, 0); }, [pathname]);
  useEffect(() => {
    const next = pathname === '/login' ? new URLSearchParams(search).get('next') || '' : '';
    const admin = /^\/admin(?:\/|$)/.test(pathname) || /^\/admin(?:\/|\?|$)/.test(next);
    document.querySelector('link[rel="manifest"]').href = admin ? '/manifest-admin.webmanifest' : '/manifest.webmanifest';
    document.querySelector('meta[name="apple-mobile-web-app-title"]').content = admin ? 'Service Portal Admin' : 'Service Portal';
  }, [pathname, search]);
  return null;
}

// Партнёрская ссылка /partner/<код>: гость попадает на главную с подсказкой «войдите»
// (код применится, если аккаунт новый). Уже вошедших не засчитываем.
function PartnerInvite() {
  const { code } = useParams();
  const { me, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading) return;
    if (me) { forgetReferral(); navigate('/cabinet', { replace: true }); return; }
    rememberReferral(code);
    navigate('/?invite=1', { replace: true });
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps
  return <FullPageSpinner />;
}

// Ссылка на подарок из бота (<сайт>/gift/<id>): ведём в «Подарки» с подставленным кодом,
// гостя — сначала через окно входа.
function GiftLink() {
  const { giftId } = useParams();
  const target = `/cabinet/gifts?code=${encodeURIComponent(giftId || '')}`;
  return <Navigate to={target} replace />;
}

// Техработы (админка → Сайт): сотрудники и страницы входа продолжают работать.
const MAINTENANCE_BYPASS = ['/admin', '/login', '/auth/', '/docs', '/app/', '/cabinet/status'];
function MaintenanceGate({ children }) {
  const site = useSiteSettings();
  const { isStaff, loading, config } = useAuth();
  const { pathname } = useLocation();
  // Учитываем и собственный режим сайта, и общий режим техработ бота (site-config.maintenance).
  const on = (site?.maintenance?.enabled || config?.maintenance) && !loading && !isStaff && !MAINTENANCE_BYPASS.some((p) => pathname.startsWith(p));
  return on ? <Maintenance info={site?.maintenance} /> : children;
}

function LegacyCabinetRedirect() {
  const { pathname, search, hash } = useLocation();
  if (new URLSearchParams(search).has('ticket') || new URLSearchParams(search).has('ticket_id') || pathname === '/dashboard/notifications') return <Navigate to={notificationTarget(pathname + search)} replace />;
  const tab = new URLSearchParams(search).get('tab');
  const target = { keys: '/cabinet', profile: '/cabinet/profile', instructions: '/cabinet', partners: '/cabinet/partner', gifts: '/cabinet/gifts', notifications: '/cabinet/support' }[tab] || '/cabinet';
  return <Navigate to={{ pathname: target, search, hash }} replace />;
}

function App() {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>
    <Suspense fallback={<FullPageSpinner />}>
      <ScrollToTop />
      <MaintenanceGate>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/auth/telegram" element={<TelegramCallback />} />
          <Route path="/partner/:code" element={<PartnerInvite />} />
          <Route path="/gift/:giftId" element={<GiftLink />} />
          <Route path="/docs" element={<DocsIndex />} />
          <Route path="/docs/:slug" element={<Doc />} />
          <Route path="/faq" element={<PublicFaq />} />
          <Route path="/download" element={<Navigate to="/cabinet?download=1" replace />} />
          <Route path="/app/authorize" element={<RequireAuth><AppAuthorize /></RequireAuth>} />
          <Route path="/payment/:result" element={<PaymentResult />} />
          {/* Адреса, которые по умолчанию подставляет сам бот */}
          <Route path="/payment-success" element={<Navigate to="/payment/success" replace />} />
          <Route path="/payment-failure" element={<Navigate to="/payment/fail" replace />} />
          <Route path="/dashboard" element={<LegacyCabinetRedirect />} />
          <Route path="/dashboard/notifications" element={<LegacyCabinetRedirect />} />
          <Route path="/cabinet/dashboard" element={<LegacyCabinetRedirect />} />
          <Route path="/login/dashboard" element={<LegacyCabinetRedirect />} />

          <Route path="/cabinet" element={<RequireAuth><CabinetLayout /></RequireAuth>}>
            <Route index element={<CabinetHome />} />
            <Route path="sub/:clientId" element={<Subscription />} />
            <Route path="buy" element={<Buy />} />
            <Route path="payments" element={<Payments />} />
            <Route path="partner" element={<Partner />} />
            <Route path="gifts" element={<Gifts />} />
            <Route path="referrals" element={<Navigate to="/cabinet/partner" replace />} />
            <Route path="support" element={<Support />} />
            <Route path="support/:ticketId" element={<Ticket />} />
            <Route path="profile" element={<Profile />} />
            <Route path="status" element={<ServiceStatus />} />
            <Route path="faq" element={<CabinetFaq />} />
            <Route path="download" element={<Navigate to="/cabinet?download=1" replace />} />
          </Route>

          <Route path="/admin" element={<RequireStaff><AdminLayout /></RequireStaff>}>
            <Route index element={<Dashboard />} />
            <Route path="users" element={<Users />} />
            <Route path="users/:userId" element={<UserCard />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="subscriptions/:clientId" element={<SubscriptionAdmin />} />
            <Route path="payments" element={<AdminPayments />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:ticketId" element={<TicketAdmin />} />
            <Route path="partners" element={<Partners />} />
            <Route path="tariffs" element={<Tariffs />} />
            <Route path="coupons" element={<Coupons />} />
            <Route path="servers" element={<Servers />} />
            <Route path="broadcast" element={<Broadcast />} />
            <Route path="site" element={<SiteAdmin />} />
            <Route path="settings" element={<BotSettings />} />
            <Route path="audit" element={<AdminAudit />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </MaintenanceGate>
    </Suspense>
  </ErrorBoundary>;
}

// Service worker нужен для push-уведомлений и установки как приложения.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
