import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBackdropDismiss } from '../lib/hooks.js';
import { Icon } from './icons.jsx';
import { copyText } from '../lib/format.js';

export { Icon };

/* ---------- Кнопки ---------- */
export function Button({ variant = 'primary', size, busy, icon, iconRight, children, className = '', to, href, ...props }) {
  const cls = `btn btn-${variant}${size ? ` btn-${size}` : ''}${busy ? ' is-busy' : ''} ${className}`;
  const content = <>
    {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : icon && <Icon name={icon} size={18} />}
    {children && <span>{children}</span>}
    {iconRight && !busy && <Icon name={iconRight} size={18} />}
  </>;
  if (to) return <Link className={cls} to={to} {...props}>{content}</Link>;
  if (href) return <a className={cls} href={href} {...props}>{content}</a>;
  return <button type="button" className={cls} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>{content}</button>;
}

export function IconButton({ icon, label, className = '', ...props }) {
  return <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...props}><Icon name={icon} size={18} /></button>;
}

/* ---------- Карточки и раскладка ---------- */
export function Card({ title, actions, children, className = '', padded = true, ...props }) {
  return <section className={`card ${padded ? 'card-padded' : ''} ${className}`} {...props}>
    {(title || actions) && <header className="card-head">
      {title && <h2 className="card-title">{title}</h2>}
      {actions && <div className="card-actions">{actions}</div>}
    </header>}
    {children}
  </section>;
}

export function PageHead({ title, subtitle, back, actions }) {
  return <div className="page-head">
    <div className="page-head-text">
      {back && <Link className="back-link" to={back}><Icon name="back" size={16} />Назад</Link>}
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-head-actions">{actions}</div>}
  </div>;
}

export function Badge({ tone = 'muted', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({ label, value, hint, tone, to }) {
  const inner = <>
    <span className="stat-label">{label}</span>
    <strong className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</strong>
    {hint && <span className="stat-hint">{hint}</span>}
  </>;
  return to ? <Link className="stat stat-link" to={to}>{inner}</Link> : <div className="stat">{inner}</div>;
}

export function KeyValue({ items }) {
  return <dl className="kv">
    {items.filter(Boolean).map(([k, v]) => <div className="kv-row" key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}
  </dl>;
}

/* ---------- Состояния ---------- */
export function Spinner({ label = 'Загрузка' }) {
  return <div className="spinner-wrap" role="status"><span className="spinner" /><span className="sr-only">{label}</span></div>;
}

export function FullPageSpinner() {
  return <div className="full-page-spinner"><span className="spinner" /></div>;
}

export function Empty({ icon = 'search', title, text, action }) {
  return <div className="empty">
    <span className="empty-icon"><Icon name={icon} size={26} /></span>
    <strong>{title}</strong>
    {text && <p>{text}</p>}
    {action}
  </div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return <div className="error-box" role="alert">
    <span>{error.message || String(error)}</span>
    {error.incident && <CopyField label="Код ошибки" value={error.incident} />}
    {onRetry && <Button variant="ghost" size="sm" icon="refresh" onClick={() => onRetry()}>Повторить</Button>}
  </div>;
}

// Обёртка для useLoad: спиннер → ошибка → содержимое.
export function Loadable({ state, children }) {
  if (state.loading && state.data === undefined) return <Spinner />;
  if (state.error && state.data === undefined) return <ErrorBox error={state.error} onRetry={state.reload} />;
  return children(state.data);
}

/* ---------- Формы ---------- */
export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return <div className={`field ${error ? 'has-error' : ''} ${className}`}>
    {label && <label className="field-label" htmlFor={id}>{label}</label>}
    {child}
    {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
  </div>;
}

export function Input({ label, hint, error, className, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <input id={id} className="input" {...props} />}</Field>;
}

export function Textarea({ label, hint, error, className, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <textarea id={id} className="input textarea" {...props} />}</Field>;
}

export function Select({ label, hint, error, options, className, ...props }) {
  return <Field label={label} hint={hint} error={error} className={className}>{(id) => <select id={id} className="input select" {...props}>
    {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
  </select>}</Field>;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return <label className="toggle">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="toggle-track" aria-hidden="true"><span /></span>
    <span>{label}</span>
  </label>;
}

export function Segmented({ value, onChange, options, label }) {
  return <div className="segmented" role="tablist" aria-label={label}>
    {options.map((o) => <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
      onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined && <span className="seg-count" data-tone={o.countTone} data-empty={o.count === 0}>{o.count}</span>}</button>)}
  </div>;
}

export function SearchInput({ value, onChange, placeholder = 'Поиск', autoFocus }) {
  return <label className="search-input">
    <Icon name="search" size={18} />
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
  </label>;
}

/* ---------- Копирование ---------- */
export function CopyField({ value, label, mono = true }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value)) { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  };
  return <div className="copy-field">
    {label && <span className="field-label">{label}</span>}
    <div className="copy-row">
      <code className={mono ? 'mono' : ''}>{value}</code>
      <button type="button" className="copy-btn" onClick={copy} aria-label="Скопировать">
        <Icon name={copied ? 'check' : 'copy'} size={18} />
        <span>{copied ? 'Скопировано' : 'Копировать'}</span>
      </button>
    </div>
  </div>;
}

/* ---------- Модальные окна ---------- */
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const backdrop = useBackdropDismiss(onClose);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (open && !el.open) {
      const active = document.activeElement;
      // Lock the viewport rather than making body a new scrolling ancestor for sticky sidebars.
      const root = document.documentElement;
      const previous = root.style.overflowY;
      root.style.overflowY = 'hidden';
      el.showModal();
      return () => {
        if (el.open) el.close();
        root.style.overflowY = previous;
        if (active instanceof HTMLElement) active.focus({ preventScroll: true });
      };
    }
    return undefined;
  }, [open]);
  if (!open) return null;
  return <dialog ref={ref} className={`modal modal-${size}`} onCancel={(e) => { e.preventDefault(); onClose(); }}
    {...backdrop}>
    <div className="modal-body">
      <header className="modal-head">
        <h2>{title}</h2>
        <IconButton icon="x" label="Закрыть" onClick={onClose} />
      </header>
      <div className="modal-content">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </div>
  </dialog>;
}

const ConfirmContext = createContext(null);
const ToastContext = createContext(null);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'danger' ? 6000 : 3500);
  }, []);
  toast.error = (error) => toast(error?.incident
    ? <>{error.message}<CopyField label="Код ошибки" value={error.incident}/></>
    : error?.message || String(error), 'danger');

  const confirm = useCallback((options) => new Promise((resolve) => {
    setConfirmState({ ...options, resolve });
  }), []);

  const closeConfirm = (result) => { confirmState?.resolve(result); setConfirmState(null); };

  return <ToastContext.Provider value={toast}>
    <ConfirmContext.Provider value={confirm}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={t.tone === 'danger' ? 'x' : 'check'} size={18} /><span>{t.message}</span>
        </div>)}
      </div>
      <Modal open={Boolean(confirmState)} onClose={() => closeConfirm(false)} title={confirmState?.title || 'Подтвердите действие'} size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => closeConfirm(false)}>Отмена</Button>
          <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)}>{confirmState?.confirmText || 'Подтвердить'}</Button>
        </>}>
        {confirmState?.text && <p className="muted">{confirmState.text}</p>}
      </Modal>
    </ConfirmContext.Provider>
  </ToastContext.Provider>;
}

export function useToast() { return useContext(ToastContext); }
export function useConfirm() { return useContext(ConfirmContext); }

/* ---------- Таблицы и пагинация ---------- */
export function Table({ columns, rows, rowKey, onRowClick, empty }) {
  if (!rows?.length) return empty || <Empty title="Ничего не найдено" />;
  return <div className="table-wrap">
    <table className="table">
      <thead><tr>{columns.map((c) => <th key={c.key} className={c.className} style={{ width: c.width }}>{c.title}</th>)}</tr></thead>
      <tbody>
        {rows.map((row, i) => <tr key={rowKey ? rowKey(row, i) ?? i : i} onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={onRowClick ? 'is-clickable' : ''} tabIndex={onRowClick ? 0 : undefined}
          onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}>
          {columns.map((c) => <td key={c.key} className={c.className} data-label={c.title}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export function Pagination({ total, limit, offset, onChange }) {
  if (!total || total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return <div className="pagination">
    <span className="muted">{offset + 1}–{Math.min(total, offset + limit)} из {total}</span>
    <div className="pagination-btns">
      <IconButton icon="back" label="Назад" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))} />
      <span>{page} / {pages}</span>
      <IconButton icon="arrow" label="Вперёд" disabled={page >= pages} onClick={() => onChange(offset + limit)} />
    </div>
  </div>;
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">
    {tabs.map((t) => <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>{t.label}</button>)}
  </div>;
}
