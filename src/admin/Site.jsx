import SiteUpdates from './SiteUpdates.jsx';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks.js';
import { DEFAULT_SITE, SITE_SLUG, docSlug, mergeSite, readKzPage, writeKzPage } from '../lib/siteSettings.js';
import { Markdown } from '../lib/markdown.jsx';
import { dateTime } from '../lib/format.js';
import LandingTariffs from './LandingTariffs.jsx';
import MenuEditor from './MenuEditor.jsx';
import FaqEditor from './FaqEditor.jsx';
import DownloadsEditor from './DownloadsEditor.jsx';
import { Badge, Button, Card, ErrorBox, IconButton, Input, PageHead, Segmented, Spinner, Tabs, Textarea, Toggle, useConfirm, useToast } from '../ui/index.jsx';

const TONES = [
  { value: 'info', label: 'Инфо' },
  { value: 'ok', label: 'Хорошее' },
  { value: 'warn', label: 'Важное' },
  { value: 'danger', label: 'Срочное' },
];

function DocEditor({ doc, onSaved, onDelete }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [title, setTitle] = useState(doc.title);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('edit');
  useEffect(() => {
    let alive = true;
    setData(null);
    readKzPage(docSlug(doc.slug)).then((d) => { if (!alive) return; setData(d || {}); setTitle(d?.title || doc.title); setBody(d?.body || ''); })
      .catch(() => alive && setData({}));
    return () => { alive = false; };
  }, [doc.slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const updated_at = new Date().toISOString();
      await writeKzPage(docSlug(doc.slug), { title: title.trim(), body, updated_at }, title.trim());
      setData({ title, body, updated_at });
      toast('Документ опубликован'); onSaved({ ...doc, title: title.trim() });
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  if (!data) return <Spinner />;
  const dirty = title !== (data.title || doc.title) || body !== (data.body || '');
  return <div className="stack">
    <div className="row-between">
      <div className="row">
        <a className="mono muted" href={`/docs/${doc.slug}`} target="_blank" rel="noopener noreferrer">/docs/{doc.slug}</a>
        {data.updated_at ? <Badge tone="ok">Опубликован {dateTime(data.updated_at)}</Badge> : <Badge tone="warn">Не опубликован</Badge>}
      </div>
      <Segmented label="Режим" value={view} onChange={setView} options={[{ value: 'edit', label: 'Текст' }, { value: 'preview', label: 'Просмотр' }]} />
    </div>
    <Input label="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
    {view === 'edit'
      ? <Textarea label="Текст" className="editor-field" value={body} onChange={(e) => setBody(e.target.value)} rows={18}
        hint="Разметка: # Заголовок, ## Подзаголовок, - пункт списка, 1. нумерация, **жирный**, *курсив*, [текст](https://ссылка). Пустая строка — новый абзац." />
      : <div className="preview-box doc-body"><h1 style={{ marginBottom: 12 }}>{title}</h1><Markdown text={body} /></div>}
    <div className="row">
      <Button busy={busy} disabled={!dirty || !title.trim()} onClick={save} icon="check">Опубликовать</Button>
      {onDelete && <Button variant="ghost" icon="trash" onClick={onDelete}>Убрать из списка</Button>}
    </div>
  </div>;
}

import { useAuth } from '../lib/auth.jsx';

export default function SiteAdmin() {
  useDocumentTitle('Сайт');
  const { isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'maintenance';
  const [site, setSite] = useState(null);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [docIdx, setDocIdx] = useState(0);
  const [newDoc, setNewDoc] = useState({ slug: '', title: '' });

  useEffect(() => {
    readKzPage(SITE_SLUG).then((d) => { const m = mergeSite(d); setSite(m); setSaved(JSON.stringify(m)); }).catch(setError);
  }, []);

  const save = async (next = site, msg = 'Сохранено') => {
    setBusy(true);
    try { await writeKzPage(SITE_SLUG, next, 'Portal: настройки сайта'); setSite(next); setSaved(JSON.stringify(next)); toast(msg); }
    catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const set = (section, patch) => setSite((s) => ({ ...s, [section]: { ...s[section], ...patch } }));

  if (error) return <ErrorBox error={error} />;
  if (!site) return <Spinner />;
  const dirty = JSON.stringify(site) !== saved;

  const toggleMaintenance = async (enabled) => {
    if (enabled && !await confirm({ title: 'Включить технические работы?', text: 'Клиенты увидят заглушку вместо сайта и кабинета. Админка, вход и документы продолжат работать. VPN и бот не затрагиваются.', confirmText: 'Включить', danger: true })) return;
    const next = { ...site, maintenance: { ...site.maintenance, enabled } };
    save(next, enabled ? 'Технические работы включены' : 'Сайт снова открыт');
  };

  const addDoc = (e) => {
    e.preventDefault();
    const slug = newDoc.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    if (!slug || site.docs.some((d) => d.slug === slug)) { toast.error(new Error('Укажите уникальный адрес латиницей')); return; }
    const next = { ...site, docs: [...site.docs, { slug, title: newDoc.title.trim() || slug }] };
    setNewDoc({ slug: '', title: '' });
    setDocIdx(next.docs.length - 1);
    save(next, 'Документ добавлен в список');
  };
  const removeDoc = async (i) => {
    if (!await confirm({ title: `Убрать «${site.docs[i].title}»?`, text: 'Документ пропадёт из списка. Его текст сохранится в боте, ссылка /docs/… продолжит открываться.', confirmText: 'Убрать' })) return;
    const next = { ...site, docs: site.docs.filter((_, j) => j !== i) };
    setDocIdx(0);
    save(next, 'Документ убран из списка');
  };

  return <>
    <PageHead title="Сайт" subtitle="Технические работы, плашка и меню кабинета, FAQ, страница загрузки, документы." />
    <Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[...(isAdmin ? [{ value: 'updates', label: 'Обновления' }] : []), { value: 'maintenance', label: 'Технические работы' }, { value: 'banner', label: 'Плашка' }, { value: 'status', label: 'Статус сервиса' }, { value: 'landing', label: 'Лендинг' }, { value: 'menu', label: 'Меню' }, { value: 'faq', label: 'FAQ' }, { value: 'downloads', label: 'Загрузка' }, { value: 'docs', label: 'Документы' }]} />

    {tab === 'updates' && isAdmin && <SiteUpdates />}
    {tab === 'maintenance' && <Card>
      <div className="stack">
        <div className="row-between">
          <div className="cell-main"><strong>Режим технических работ</strong><span className="muted">Заглушка для клиентов на главной и в кабинете</span></div>
          <Toggle checked={site.maintenance.enabled} onChange={toggleMaintenance} label={site.maintenance.enabled ? 'Включён' : 'Выключен'} disabled={busy} />
        </div>
        {site.maintenance.enabled && <div className="notice notice-warn">Сейчас клиенты видят заглушку. Вы как сотрудник видите сайт как обычно.</div>}
        <Input label="Заголовок заглушки" value={site.maintenance.title} onChange={(e) => set('maintenance', { title: e.target.value })} />
        <Textarea label="Текст" value={site.maintenance.text} onChange={(e) => set('maintenance', { text: e.target.value })} rows={3} />
        <Button busy={busy} disabled={!dirty} onClick={() => save()} className="self-start">Сохранить текст</Button>
      </div>
    </Card>}

    {tab === 'status' && <Card title="Статус сервиса"><div className="stack">
      <Toggle checked={site.service_notice.page_enabled !== false} disabled={busy} onChange={(page_enabled) => save({ ...site, service_notice: { ...site.service_notice, page_enabled } }, page_enabled ? 'Страница статуса включена' : 'Страница статуса скрыта')} label="Показывать страницу статуса в кабинете" />
      <p className="field-hint">Скрывает страницу и пункт меню для клиентов. На VPN, выдачу подписок и мониторинг серверов не влияет.</p>
      <Toggle checked={site.service_notice.enabled} onChange={(enabled) => set('service_notice', { enabled })} label="Показывать объявление" />
      <Input label="Заголовок" value={site.service_notice.title} maxLength={160} onChange={(e) => set('service_notice', { title: e.target.value })} placeholder="Например: работы на локации" />
      <Textarea label="Подробности" value={site.service_notice.text} maxLength={4000} rows={5} onChange={(e) => set('service_notice', { text: e.target.value })} hint="Какие локации затронуты, что происходит и когда ожидается восстановление." />
      <Button busy={busy} disabled={!dirty} onClick={() => save()}>Опубликовать</Button>
    </div></Card>}

    {tab === 'banner' && <div className="grid grid-main">
      <Card>
        <div className="stack">
          <div className="row-between">
            <div className="cell-main"><strong>Плашка в кабинете</strong><span className="muted">Показывается сверху всех страниц кабинета. На главной и в админке её нет.</span></div>
            <Toggle checked={site.banner.enabled} onChange={(v) => set('banner', { enabled: v })} label={site.banner.enabled ? 'Показывать' : 'Скрыта'} />
          </div>
          <Textarea label="Текст" value={site.banner.text} onChange={(e) => set('banner', { text: e.target.value })} rows={2} maxLength={300}
            hint="Коротко: одно-два предложения. Клиент может закрыть плашку — новая (с другим текстом) покажется снова." />
          <div className="field"><span className="field-label">Тип</span><Segmented label="Тип" value={site.banner.tone} onChange={(v) => set('banner', { tone: v })} options={TONES} /></div>
          <div className="form-grid">
            <Input label="Текст ссылки" value={site.banner.link_text} onChange={(e) => set('banner', { link_text: e.target.value })} placeholder="Подробнее" />
            <Input label="Ссылка" value={site.banner.link_url} onChange={(e) => set('banner', { link_url: e.target.value })} placeholder="https://… или /cabinet/buy" />
          </div>
          <Button busy={busy} disabled={!dirty} onClick={() => save(site, 'Плашка сохранена')} className="self-start">Сохранить</Button>
        </div>
      </Card>
      <Card title="Как увидят клиенты">
        {site.banner.text
          ? <div className={`site-banner tone-bg-${site.banner.tone}`} style={{ borderRadius: 12 }}><p>{site.banner.text}{site.banner.link_url && <> <a href="#preview" onClick={(e) => e.preventDefault()}>{site.banner.link_text || 'Подробнее'}</a></>}</p></div>
          : <p className="muted">Введите текст, чтобы увидеть плашку.</p>}
        {!site.banner.enabled && <p className="help-text" style={{ marginTop: 10 }}>Сейчас плашка выключена.</p>}
      </Card>
    </div>}

    {tab === 'landing' && <LandingTariffs saved={site.landing_tariff_group} busy={busy}
      onSave={group => save({ ...site, landing_tariff_group: group }, 'Тарифы лендинга сохранены')} />}

    {tab === 'menu' && <MenuEditor site={site} busy={busy} onSave={(nav) => save({ ...site, nav }, nav.length ? 'Меню сохранено' : 'Вернули меню по умолчанию')} />}

    {tab === 'faq' && <FaqEditor />}

    {tab === 'downloads' && <DownloadsEditor site={site} busy={busy}
      onSave={(downloads) => save({ ...site, downloads }, downloads.enabled === site.downloads.enabled ? 'Ссылки сохранены' : downloads.enabled ? 'Страница загрузки включена' : 'Страница загрузки скрыта')} />}

    {tab === 'docs' && <div className="grid grid-main">
      <Card title={site.docs[docIdx]?.title || 'Документ'}>
        {site.docs[docIdx] ? <DocEditor key={site.docs[docIdx].slug} doc={site.docs[docIdx]}
          onSaved={(d) => { if (d.title !== site.docs[docIdx].title) save({ ...site, docs: site.docs.map((x, j) => (j === docIdx ? d : x)) }, 'Документ опубликован'); }}
          onDelete={DEFAULT_SITE.docs.some((d) => d.slug === site.docs[docIdx].slug) ? null : () => removeDoc(docIdx)} />
          : <p className="muted">Документов нет.</p>}
      </Card>
      <div className="stack" style={{ gap: 18 }}>
        <Card title="Документы">
          <div className="action-list">
            {site.docs.map((d, i) => <button type="button" key={d.slug} onClick={() => setDocIdx(i)} aria-current={i === docIdx}>
              <span>{d.title}</span><span className="mono muted" style={{ flex: 'none' }}>{d.slug}</span>
            </button>)}
          </div>
        </Card>
        <Card title="Новый документ">
          <form className="stack" onSubmit={addDoc}>
            <Input label="Название" value={newDoc.title} onChange={(e) => setNewDoc((n) => ({ ...n, title: e.target.value }))} placeholder="Политика возврата" />
            <Input label="Адрес" value={newDoc.slug} onChange={(e) => setNewDoc((n) => ({ ...n, slug: e.target.value }))} placeholder="refund" hint="Латиница, цифры и дефис: /docs/refund" />
            <Button type="submit" variant="secondary" busy={busy} disabled={!newDoc.slug.trim()}>Добавить</Button>
          </form>
        </Card>
      </div>
    </div>}
  </>;
}
