import { BroadcastText } from '../ui/BroadcastText.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { notificationTarget } from '../lib/notificationTarget.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { relative, rub } from '../lib/format.js';
import { Button, Icon, Spinner } from '../ui/index.jsx';
import { AppBrand, Avatar } from '../ui/shell.jsx';

export function Notifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const load = (limit = 30) => api.get('/notifications', { limit }).then((r) => { setUnread(r?.unread_count || 0); return r; });

  // Счётчик — раз в минуту, пока вкладка активна.
  useEffect(() => {
    load(1).catch(() => {});
    const id = setInterval(() => { if (!document.hidden) load(1).catch(() => {}); }, 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    setData(null);
    load().then(setData).catch(() => setData({ notifications: [] }));
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const readAll = async () => {
    await api.post('/notifications/read-all').catch(() => {});
    setUnread(0);
    setData((d) => d && { ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) });
  };
  const readOne = (n) => {
    if (n.read) return;
    api.post(`/notifications/${n.id}/read`).catch(() => {});
    setUnread((u) => Math.max(0, u - 1));
    setData((d) => d && { ...d, notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
  };

  return <div className="notif" ref={ref}>
    <button type="button" className="top-icon" aria-label={`Уведомления${unread ? `: ${unread} новых` : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <Icon name="bell" />
      {unread > 0 && <span className="top-dot">{unread > 9 ? '9+' : unread}</span>}
    </button>
    <div className="notif-panel popover-motion" data-expanded={open} inert={!open} role="dialog" aria-label="Уведомления">
      <header className="notif-head">
        <strong>Уведомления</strong>
        {unread > 0 && <button type="button" className="btn btn-link" onClick={readAll}>Прочитать все</button>}
      </header>
      <div className="notif-list">
        {!data ? (open && <Spinner />) : data.notifications?.length ? data.notifications.map((n) => <div role="button" tabIndex={0} onKeyDown={e=>{if(e.target===e.currentTarget && ['Enter',' '].includes(e.key)){e.preventDefault();e.currentTarget.click();}}} key={n.id}
          className={`notif-item ${n.read ? '' : 'is-unread'}`} onClick={(e) => { readOne(n); if(e.target.closest('a')) return; const href = n.data?.href || n.href || n.url; if (href) { setOpen(false); navigate(notificationTarget(href)); } }}>
          <span className="notif-dot" aria-hidden="true" />
          <span className="notif-body">
            {n.data?.broadcast_html ? <BroadcastText html={n.data.broadcast_html} /> : <strong>{n.title}</strong>}
            {!n.data?.broadcast_html && n.message && n.message !== n.title && <span>{n.message}</span>}
            <small>{relative(n.created_at)}</small>
          </span>
        </div>) : <div className="notif-empty"><Icon name="bell" size={26} /><span>Новых уведомлений нет</span></div>}
      </div>
    </div>
  </div>;
}

export default function Topbar({ summary, isStaff, theme, onDownload }) {
  const { me } = useAuth();
  const balance = Number(summary?.balance || 0);
  return <header className="topbar">
    <div className="topbar-brand"><AppBrand to="/cabinet" /></div>
    <div className="topbar-right">
      {isStaff && <Button variant="secondary" size="sm" icon="settings" to="/admin" className="hide-sm">Админка</Button>}
      <Link to="/cabinet/payments" className="balance-chip" title="Баланс">
        <Icon name="wallet" size={18} /><span>{summary ? rub(balance) : '…'}</span>
      </Link>
      {onDownload && <button type="button" className="top-icon top-download" onClick={onDownload} aria-label="Скачать приложение" title="Скачать приложение"><Icon name="download" /></button>}
      {theme && <button type="button" className="top-icon theme-toggle" onClick={theme.toggle} aria-label={theme.light ? 'Тёмная тема' : 'Светлая тема'} title={theme.light ? 'Тёмная тема' : 'Светлая тема'}>
        <Icon name={theme.light ? 'moon' : 'sun'} />
      </button>}
      <Notifications />
      <NavLink to="/cabinet/profile" className="top-avatar" aria-label="Профиль"><Avatar me={me} /></NavLink>
    </div>
  </header>;
}
