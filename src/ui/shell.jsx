import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from './icons.jsx';
import { IconButton } from './index.jsx';
import { useAuth } from '../lib/auth.jsx';

export function AppBrand({ to = '/', badge }) {
  return <Link className="app-brand" to={to} aria-label="Service Portal">
    <img src="/icons/logo.svg" alt="" width="40" height="40" />
    <span>Service Portal</span>
    {badge && <small>{badge}</small>}
  </Link>;
}

export function Avatar({ me }) {
  const name = me?.display_name || me?.username || me?.email || '?';
  return <span className="avatar">{me?.avatar_url ? <img src={me.avatar_url} alt="" /> : name.slice(0, 1).toUpperCase()}</span>;
}

export function identityLabel(me) {
  if (!me) return '';
  return me.display_name || (me.username ? `@${me.username}` : '') || me.email || (me.tg_id ? `Telegram ${me.tg_id}` : 'Аккаунт');
}

function SideLink({ item, onNavigate }) {
  return <NavLink to={item.to} end={item.end} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`} onClick={onNavigate}>
    <Icon name={item.icon} />
    <span>{item.label}</span>
    {item.count ? <span className="count">{item.count}</span> : null}
  </NavLink>;
}

export function Sidebar({ items, brandBadge, brandTo, footer, onNavigate }) {
  const { me } = useAuth();
  return <aside className="sidebar">
    <AppBrand to={brandTo} badge={brandBadge} />
    <nav className="side-nav">
      {items.map((item) => item.group
        ? <div className="side-nav-group" key={item.group}>{item.group}</div>
        : <SideLink key={item.to} item={item} onNavigate={onNavigate} />)}
    </nav>
    <div className="sidebar-foot">
      {footer}
      <div className="user-chip">
        <Avatar me={me} />
        <div className="user-chip-text"><strong>{identityLabel(me)}</strong><span>{me?.email || (me?.tg_id ? `TG ${me.tg_id}` : '')}</span></div>
      </div>
    </div>
  </aside>;
}

// Выдвижное меню для узких экранов (используется админкой).
export function Drawer({ open, onClose, children }) {
  const location = useLocation();
  useEffect(() => { onClose(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="drawer" role="dialog" aria-modal="true" aria-label="Меню">
    <div className="drawer-backdrop" onClick={onClose} />
    {children}
  </div>;
}

export function useDrawer() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return { open, show, hide };
}

export function MenuButton({ onClick }) {
  return <IconButton icon="menu" label="Открыть меню" onClick={onClick} />;
}
