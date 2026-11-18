import Disclosure from '../ui/Disclosure.jsx';
import { useMemo, useState } from 'react';
import { Markdown } from '../lib/markdown.jsx';
import { PLATFORMS, PLATFORM_GROUPS, detectPlatform, safeLink, sourceLabel } from '../lib/downloads.js';
import { formatReleaseDate, useLatestRelease, useReachable } from '../lib/release.js';
import { Icon } from '../ui/index.jsx';

// Общие блоки для кабинета и публичных страниц: FAQ и загрузка приложений.

export function FaqContent({ faq }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => (faq?.sections || []).map((s) => ({
    ...s,
    items: (s.items || []).filter((it) => !q || `${it.q} ${it.a}`.toLowerCase().includes(q)),
  })).filter((s) => s.items.length), [faq, q]);

  return <div className="faq">
    <label className="search-input faq-search">
      <Icon name="search" size={18} />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по вопросам" aria-label="Поиск по вопросам" />
      {query && <button type="button" className="icon-btn" aria-label="Очистить" onClick={() => setQuery('')}><Icon name="x" size={16} /></button>}
    </label>
    {!sections.length && <p className="muted faq-empty">Ничего не нашли. Попробуйте другие слова или напишите в поддержку.</p>}
    {sections.map((s, si) => <section key={`${s.title}-${si}`} className="faq-section">
      {s.title && <h2 className="faq-section-title">{s.title}</h2>}
      <div className="faq-list">
        {s.items.map((it, ii) => {
          const id = `${si}-${ii}`;
          const isOpen = q ? true : open === id;
          return <div key={id} className={`faq-item ${isOpen ? 'is-open' : ''}`}>
            <button type="button" className="faq-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
              <span>{it.q}</span>
              <Icon name="plus" size={18} className="faq-chevron" />
            </button>
            <div className="expand-track" data-expanded={isOpen} inert={!isOpen}><div className="expand-clip"><div className="faq-a"><div className="doc-body"><Markdown text={it.a} /></div></div></div></div>
          </div>;
        })}
      </div>
    </section>)}
  </div>;
}

// Плитки загрузки, сгруппированные «для компьютера» / «для телефона и ТВ».
// Плитка с двумя ссылками на один файл (GitHub и зеркало). Если GitHub у клиента
// не открывается, основной кнопкой становится зеркало.
function ChoiceTile({ p, main, mirror, note, mine, version }) {
  const reach = useReachable(main);
  const preferMirror = reach === 'blocked';
  return <div className={`dl-tile has-choice ${mine ? 'is-mine' : ''}`}>
    <span className="dl-tile-head">
      <span className="dl-icon"><Icon name={p.icon} size={24} /></span>
      <span className="dl-text"><strong>{p.label}</strong><small>{note}</small>{version}</span>
    </span>
    <span className="dl-sources">
      {[[main, sourceLabel(main), !preferMirror], [mirror, 'Зеркало', preferMirror]].map(([href, label, primary]) =>
        <a key={href} className={`dl-source ${primary ? 'is-primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer" title={href}>
          {primary && <Icon name="download" size={14} />}<span>{label}</span>
        </a>)}
    </span>
    {preferMirror && <span className="dl-hint">GitHub у вас не открывается — качайте с зеркала, файл тот же.</span>}
  </div>;
}

// «Что нового» в последней версии для Windows (из /download/latest.json).
function ReleaseNews({ release }) {
  if (!release?.notes.length) return null;
  return <Disclosure className="dl-news" label={<> Что нового в версии {release.version}{release.date ? ` · ${formatReleaseDate(release.date)}` : ''}</>}>
    <ul>
      {release.notes.map((n, i) => <li key={i}>{n.title && <strong>{n.title}. </strong>}{n.text}</li>)}
    </ul>
  </Disclosure>;
}

export function DownloadsContent({ downloads }) {
  const links = downloads?.links || {};
  const mirrors = downloads?.mirrors || {};
  const notes = downloads?.notes || {};
  const mine = useMemo(detectPlatform, []);
  // Версию показываем, только когда есть что скачать для Windows: манифест — от приложения для Windows.
  const release = useLatestRelease(!!(safeLink(links.windows) || safeLink(mirrors.windows)));
  const versionLine = release && <small className="dl-version">Версия {release.version}{release.date ? ` от ${formatReleaseDate(release.date)}` : ''}</small>;
  return <div className="dl">
    {PLATFORM_GROUPS.map((g) => {
      const items = PLATFORMS.filter((p) => p.group === g.key);
      return <section key={g.key} className="dl-group">
        <h3 className="dl-group-title">{g.title}</h3>
        <div className="dl-tiles">
          {items.map((p) => {
            const main = safeLink(links[p.key]);
            const mirror = safeLink(mirrors[p.key]);
            const url = main || mirror;
            const note = (notes[p.key] || '').trim() || p.note;
            const version = p.key === 'windows' && url ? versionLine : null;
            if (main && mirror && main !== mirror) {
              return <ChoiceTile key={p.key} p={p} main={main} mirror={mirror} note={note} mine={p.key === mine} version={version} />;
            }
            const body = <>
              <span className="dl-icon"><Icon name={p.icon} size={24} /></span>
              <span className="dl-text"><strong>{p.label}</strong><small>{url ? note : 'Скоро'}</small>{version}</span>
              {url && <Icon name="download" size={18} className="dl-arrow" />}
            </>;
            const cls = `dl-tile ${p.key === mine ? 'is-mine' : ''} ${url ? '' : 'is-soon'}`;
            return url
              ? <a key={p.key} className={cls} href={url} target="_blank" rel="noopener noreferrer" title={p.key === mine ? 'Ваше устройство' : undefined}>{body}</a>
              : <span key={p.key} className={cls} aria-disabled="true">{body}</span>;
          })}
        </div>
        {items.some((p) => p.key === 'windows') && (safeLink(links.windows) || safeLink(mirrors.windows)) && <ReleaseNews release={release} />}
      </section>;
    })}
  </div>;
}
