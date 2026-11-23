import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Pricing from './components/Pricing.jsx';
import SubscriptionFaq from './components/SubscriptionFaq.jsx';
import Footer from './components/Footer.jsx';
import { getLayout, useViewportWidth } from './lib/responsive.js';
import { content } from './content.js';
import { useAuth } from '../lib/auth.jsx';
import { links } from '../lib/site.js';
import { hasStoredReferral, rememberReferral } from '../lib/referral.js';
import { LoginModal } from '../pages/Login.jsx';
import { isTelegramWebApp } from '../lib/telegramWebApp.js';
import { useApplyCabinetTheme } from '../lib/theme.js';

// Approved graphite/jungle landing, with the existing login and checkout flow.
export default function Landing() {
  // Keep marketing dark, while giving login dialogs the shared graphite tokens.
  useApplyCabinetTheme(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { me, config } = useAuth();
  const [locale, setLocale] = useState(() => {
    try { return localStorage.getItem('portal-language') === 'en' ? 'en' : 'ru'; } catch { return 'ru'; }
  });
  const [invite, setInvite] = useState(false);
  const [loginNext, setLoginNext] = useState(null);
  const width = useViewportWidth();
  const layout = getLayout(width);
  const copy = content[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = 'dark';
    document.title = copy.pageTitle;
    try { localStorage.setItem('portal-language', locale); } catch { /* Private browsing. */ }
  }, [locale, copy.pageTitle]);

  useEffect(() => {
    rememberReferral(new URLSearchParams(window.location.search).get('ref'));
  }, []);
  // Внутри Telegram главная не нужна: после автоматического входа — сразу кабинет.
  useEffect(() => { if (location.pathname === '/' && me && isTelegramWebApp()) navigate('/cabinet', { replace: true }); }, [me, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  // Пришёл по партнёрской ссылке и ещё не вошёл — подсказываем, что код сохранён.
  useEffect(() => { setInvite(!me && hasStoredReferral()); }, [me]);

  // Sections are visible by default, even if observation is unavailable.
  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('section-arrived');
        observer.unobserve(entry.target);
      }
    });
    document.querySelectorAll('.landing :is(.settings-card, .summary-card, .subscription-faq)').forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const onOpen = ({ type }) => {
    if (type === 'account') { if (me) navigate('/cabinet'); else setLoginNext('/cabinet'); }
    else if (type === 'support') {
      if (me) navigate('/cabinet/support');
      else window.open(links.support, '_blank', 'noopener');
    }
  };

  const onCheckout = ({ tariffId, devices, promo }) => {
    const q = new URLSearchParams({ tariff: tariffId, devices, source: 'landing' });
    if (promo) q.set('promo', promo);
    const target = `/cabinet/buy?${q}`;
    if (me) navigate(target); else setLoginNext(target);
  };

  const frameProps = {
    className: 'page-frame', 'data-layout': layout.name, 'data-stacked': layout.stacked, 'data-phone': layout.phone,
    style: { '--u': '1px', '--art-scale': 1 },
  };

  return <div className="landing landing-graphite" data-coupons={config?.features?.coupon_enabled === false ? "off" : "on"}>
    <a className="skip-link" href="#plans">{copy.skip}</a>
    <Header copy={copy} locale={locale} width={width} onLocaleChange={setLocale} onOpen={onOpen} loggedIn={Boolean(me)} />
    <main>
      <Hero copy={copy} width={width} onOpen={onOpen} />
      <div {...frameProps}>
        <Pricing copy={copy} locale={locale} layout={layout} onCheckout={onCheckout} />
        <SubscriptionFaq copy={copy} />
      </div>
    </main>
    <div {...frameProps}>
      <Footer copy={copy} onOpen={onOpen} />
    </div>
    <LoginModal open={Boolean(loginNext) && !me} next={loginNext || '/cabinet'} onClose={() => setLoginNext(null)} />
    {invite && <div className="invite-toast" role="status">
      <span>{locale === 'en' ? <>You were <b>invited</b> — sign in and the invite is saved.</> : <>Вас <b>пригласили</b> в Service Portal — войдите, приглашение сохранится.</>}</span>
      <button type="button" className="invite-login" onClick={() => { setInvite(false); setLoginNext('/cabinet'); }}>{copy.login}</button>
      <button type="button" aria-label={copy.close} onClick={() => setInvite(false)}>×</button>
    </div>}
  </div>;
}
