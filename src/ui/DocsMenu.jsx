import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteSettings } from '../lib/siteSettings.js';
import { Icon } from './icons.jsx';

// Кнопка «Документы»: раскрывает список правовых документов (админка → Сайт → Документы).
// Новый документ появляется здесь сам — отдельные ссылки на сайт добавлять не нужно.
// variant: 'landing' — подвал лендинга, 'side' — низ бокового меню кабинета.
export default function DocsMenu({ variant = 'side', label = 'Документы' }) {
  const site = useSiteSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const docs = site?.docs || [];
  return <div className={`docs-menu docs-menu-${variant} ${open ? 'is-open' : ''}`} ref={ref}>
    <button type="button" className="docs-menu-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      {variant === 'side' && <Icon name="file" size={15} />}
      <span>{label}</span>
      <Icon name="plus" size={14} className="docs-menu-chevron" />
    </button>
    <div className="docs-menu-list popover-motion" data-expanded={open} inert={!open} role="menu">
      {docs.map((d) => <Link key={d.slug} role="menuitem" to={`/docs/${d.slug}`} onClick={() => setOpen(false)}>{d.title}</Link>)}
      <Link role="menuitem" to="/docs" className="docs-menu-all" onClick={() => setOpen(false)}>Все документы<Icon name="arrow" size={14} /></Link>
    </div>
  </div>;
}
