import { TelegramIcon } from '../../ui/icons.jsx';
import { useEffect, useId, useRef, useState } from 'react';
import Brand from './Brand.jsx';
import { links } from '../../lib/site.js';

function LanguageSwitch({ locale, onChange, label }) {
  const filterId = `liquid-${useId().replace(/:/g, '')}`;
  return <div className="language-switch" role="group" aria-label={label} data-language={locale}>
    <svg className="filter-defs" aria-hidden="true" width="0" height="0"><defs>
      <filter id={filterId} x="-30%" y="-40%" width="160%" height="180%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="blur" />
        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -8" result="liquid" />
        <feComposite in="SourceGraphic" in2="liquid" operator="atop" />
      </filter>
    </defs></svg>
    <span className="liquid-track" style={{ filter: `url(#${filterId})` }} aria-hidden="true"><span className="liquid-drop" /><span className="liquid-body" /></span>
    <button type="button" lang="ru" aria-label="Русский" aria-pressed={locale === 'ru'} onClick={() => onChange('ru')}>RU</button>
    <button type="button" lang="en" aria-label="English" aria-pressed={locale === 'en'} onClick={() => onChange('en')}>EN</button>
  </div>;
}
export default function Header({ copy, locale, width, onLocaleChange, onOpen, loggedIn }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const toggleRef = useRef(null);
  useEffect(() => { if (width >= 1000) setMenuOpen(false); }, [width]);
  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    const previousOverflow = document.body.style.overflow;
    menu.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      menu.close();
      document.body.style.overflow = previousOverflow;
      if (toggleRef.current?.offsetParent) toggleRef.current.focus({ preventScroll: true });
    };
  }, [menuOpen]);
  const open = (type) => { setMenuOpen(false); onOpen({ type }); };
  return <header className="site-header" id="home" data-compact={width < 1000} data-tight={width < 1280} data-small={width < 360}>
    <div className="header-inner">
      <Brand className="site-brand" homeLabel={copy.home} />
      <nav className="site-navigation" aria-label={copy.navigation}>
        <a href="#plans">{copy.plans}</a>
        <a href="#faq">{copy.faq}</a>
        <button type="button" onClick={() => open('support')}>{copy.support}</button>
      </nav>
      <div className="header-actions">
        <a className="telegram-button" href={links.support} target="_blank" rel="noopener noreferrer" aria-label={copy.telegram}><TelegramIcon size={24} /></a>
        <div className="language-slot"><LanguageSwitch locale={locale} onChange={onLocaleChange} label={copy.language} /></div>
        <button className="login-button" type="button" onClick={() => open('account')}>{loggedIn ? copy.cabinet : copy.login}</button>
        <button ref={toggleRef} className="menu-toggle" type="button" aria-label={copy.menu} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(true)}><span /><span /></button>
      </div>
    </div>
    <dialog ref={menuRef} className="mobile-menu" id="mobile-navigation" aria-label={copy.navigation} onCancel={() => setMenuOpen(false)}
      onClick={(event) => { if (event.target === menuRef.current) { const rect = event.target.getBoundingClientRect(); if (event.clientY > rect.bottom || event.clientX < rect.left) setMenuOpen(false); } }}>
      <div className="mobile-menu-heading"><span onClick={() => setMenuOpen(false)}><Brand homeLabel={copy.home} /></span><button className="menu-close" type="button" onClick={() => setMenuOpen(false)} aria-label={copy.close}>×</button></div>
      <nav className="mobile-navigation" aria-label={copy.navigation}>
        <a href="#plans" onClick={() => setMenuOpen(false)}>{copy.plans}</a>
        <a href="#faq" onClick={() => setMenuOpen(false)}>{copy.faq}</a>
        <button type="button" onClick={() => open('support')}>{copy.support}</button>
      </nav>
      <div className="mobile-menu-controls">
        <a className="telegram-button" href={links.support} target="_blank" rel="noopener noreferrer" aria-label={copy.telegram}><TelegramIcon size={24} /></a>
        <div className="language-slot"><LanguageSwitch locale={locale} onChange={onLocaleChange} label={copy.language} /></div>
        <button className="login-button" type="button" onClick={() => open('account')}>{loggedIn ? copy.cabinet : copy.login}</button>
      </div>
    </dialog>
  </header>;
}
