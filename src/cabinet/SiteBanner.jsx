import { useEffect, useRef, useState } from 'react';
import { useSiteSettings } from '../lib/siteSettings.js';
import { Icon } from '../ui/index.jsx';

// Плашка сверху кабинета (текст задаётся в админке → Сайт). Закрытую плашку
// не показываем, пока админ не поменяет текст.
const KEY = 'portal-banner-hidden';
const hash = (s) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36);

export default function SiteBanner() {
  const site = useSiteSettings();
  const b = site?.banner;
  const id = b?.enabled && b.text ? hash(`${b.text}|${b.link_url}`) : null;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const ref = useRef(null);
  const visible = id && hidden !== id;

  // Высота плашки нужна, чтобы чат поддержки помещался в экран целиком.
  useEffect(() => {
    const root = document.documentElement;
    if (!visible || !ref.current) { root.style.setProperty('--banner-h', '0px'); return undefined; }
    const obs = new ResizeObserver(() => root.style.setProperty('--banner-h', `${ref.current?.offsetHeight || 0}px`));
    obs.observe(ref.current);
    return () => { obs.disconnect(); root.style.setProperty('--banner-h', '0px'); };
  }, [visible]);

  if (!visible) return null;
  const hide = () => { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } setHidden(id); };
  return <div ref={ref} className={`site-banner tone-bg-${b.tone || 'info'} anim-slide-down`} role="status">
    <Icon name={b.tone === 'warn' ? 'bell' : b.tone === 'ok' ? 'gift' : 'megaphone'} size={18} />
    <p>{b.text}{b.link_url && <> <a href={b.link_url} target={b.link_url.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{b.link_text || 'Подробнее'}</a></>}</p>
    <button type="button" aria-label="Скрыть" onClick={hide}><Icon name="x" size={16} /></button>
  </div>;
}
