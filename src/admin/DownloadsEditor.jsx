import { useEffect, useState } from 'react';
import { PLATFORMS, PLATFORM_GROUPS, safeLink } from '../lib/downloads.js';
import { DownloadsContent } from '../pages/HelpContent.jsx';
import { Badge, Button, Card, Icon, Input, Toggle } from '../ui/index.jsx';

// Админка → Сайт → Загрузка: показывать ли окно «Скачать», ссылки, зеркала и подписи по платформам.
export default function DownloadsEditor({ site, busy, onSave }) {
  const [links, setLinks] = useState(site.downloads.links);
  const [mirrors, setMirrors] = useState(site.downloads.mirrors || {});
  const [notes, setNotes] = useState(site.downloads.notes || {});
  useEffect(() => { setLinks(site.downloads.links); setMirrors(site.downloads.mirrors || {}); setNotes(site.downloads.notes || {}); }, [site.downloads]);

  const enabled = site.downloads.enabled;
  const bad = PLATFORMS.filter((p) => (links[p.key] || '').trim() && !safeLink(links[p.key]));
  const badMirror = PLATFORMS.filter((p) => (mirrors[p.key] || '').trim() && !safeLink(mirrors[p.key]));
  const pack = (obj) => Object.fromEntries(PLATFORMS.map((p) => [p.key, (obj[p.key] || '').trim()]).filter(([, v]) => v));
  const dirty = JSON.stringify(pack(links)) !== JSON.stringify(pack(site.downloads.links))
    || JSON.stringify(pack(mirrors)) !== JSON.stringify(pack(site.downloads.mirrors || {}))
    || JSON.stringify(pack(notes)) !== JSON.stringify(pack(site.downloads.notes || {}));
  const active = PLATFORMS.filter((p) => safeLink(links[p.key]) || safeLink(mirrors[p.key])).length;

  const save = () => onSave({ enabled, links: pack(links), mirrors: pack(mirrors), notes: pack(notes) });
  const toggle = (v) => onSave({ ...site.downloads, enabled: v });

  return <div className="grid grid-main">
    <Card>
      <div className="stack">
        <div className="row-between">
          <div className="cell-main"><strong>Окно «Скачать»</strong><span className="muted">Кнопка внизу бокового меню кабинета и в шапке на телефоне</span></div>
          <Toggle checked={enabled} onChange={toggle} label={enabled ? 'Показывать' : 'Скрыто'} disabled={busy} />
        </div>
        <p className="setting-desc">Показываются все платформы. Скачать можно только там, где указана ссылка (https://…), остальные помечены «Скоро». Зеркало — необязательная вторая ссылка на тот же файл (например, https://example.com/download/portal-vpn-setup.exe): если указаны обе, клиент сам выбирает, откуда качать. Пригодится, когда GitHub не открывается. Подпись — короткая строка под названием, например «Версия x64» или «Google Play, APK».</p>
        {PLATFORM_GROUPS.map((g) => <div key={g.key} className="download-edit">
          <span className="field-label">{g.title}</span>
          {PLATFORMS.filter((p) => p.group === g.key).map((p) => <div key={p.key} className="download-edit-row">
            <span className="menu-icon" title={p.label}><Icon name={p.icon} /></span>
            <Input aria-label={`${p.label}: ссылка`} label={p.label} value={links[p.key] || ''} placeholder="https://…" inputMode="url"
              error={bad.includes(p) ? 'Нужна ссылка https://' : undefined}
              onChange={(e) => setLinks((l) => ({ ...l, [p.key]: e.target.value }))} />
            <Input aria-label={`${p.label}: зеркало`} label="Зеркало" value={mirrors[p.key] || ''} placeholder="https://… (необязательно)" inputMode="url"
              error={badMirror.includes(p) ? 'Нужна ссылка https://' : undefined}
              onChange={(e) => setMirrors((m) => ({ ...m, [p.key]: e.target.value }))} />
            <Input aria-label={`${p.label}: подпись`} label="Подпись" value={notes[p.key] || ''} placeholder={p.note} maxLength={40}
              onChange={(e) => setNotes((n) => ({ ...n, [p.key]: e.target.value }))} />
          </div>)}
        </div>)}
        <Button busy={busy} disabled={!dirty || bad.length > 0 || badMirror.length > 0} onClick={save} className="self-start">Сохранить</Button>
      </div>
    </Card>
    <div className="stack" style={{ gap: 18 }}>
      <Card title="Сейчас">
        <div className="stack">
          <div className="row"><Badge tone={enabled ? 'ok' : 'muted'}>{enabled ? 'Окно включено' : 'Окно скрыто'}</Badge><Badge tone={active ? 'ok' : 'warn'}>Ссылок: {active} из {PLATFORMS.length}</Badge></div>
        </div>
      </Card>
      <Card title="Как увидят клиенты"><DownloadsContent downloads={{ links, mirrors, notes }} /></Card>
    </div>
  </div>;
}
