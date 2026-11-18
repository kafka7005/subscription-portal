import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.jsx';
import { Badge, Button, Card, ErrorBox, Input, PageHead, SearchInput, Select, Spinner, Textarea, Toggle, useConfirm, useToast } from '../ui/index.jsx';

// Настройки бота «как в его админке»: схема берётся из GET /api/settings/schema
// (разделы, кассы, кнопки, режимы — с подписями и подсказками бота), сохранение —
// POST /api/settings/configs/{scope} { value: { KEY: значение } }.
// Переключатели сохраняются сразу, текст и числа — кнопкой «Сохранить» в разделе.

function RestartBot() {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  const restart = async () => {
    if (busy || requested) return;
    if (!await confirm({
      title: 'Перезапустить бота?',
      text: 'На время перезапуска бот и API сайта могут быть недоступны. Сначала сохраните изменения настроек.',
      confirmText: 'Перезапустить', danger: true,
    })) return;
    setBusy(true);
    try {
      const result = await api.post('/management/restart');
      if (result?.status !== 'restarting') throw new Error('API не подтвердил команду перезапуска');
      setRequested(true);
      toast('Команда перезапуска принята. После запуска бота обновите страницу.');
    } catch (err) { toast.error(err); }
    finally { setBusy(false); }
  };

  return <Button variant="secondary" icon="refresh" busy={busy} disabled={busy || requested} onClick={restart}>
    {requested ? 'Перезапуск запрошен' : 'Перезапустить бота'}
  </Button>;
}

function flatten(section) {
  // Раздел может содержать подразделы (кассы, режим единой подписки).
  const own = section.fields?.length ? [{ ...section, children: undefined }] : [];
  return [...own, ...(section.children || [])];
}

function Field({ field, value, onChange, onToggle, busy }) {
  const hint = field.hint ? <span className="setting-hint">{field.hint}</span> : null;
  if (field.type === 'bool') {
    return <div className="setting-row">
      <div className="setting-text"><strong>{field.label}</strong>{hint}</div>
      <Toggle checked={Boolean(value)} disabled={busy} onChange={onToggle} label="" />
    </div>;
  }
  if (field.type === 'enum') {
    const options = (field.options || []).map((o) => (typeof o === 'object' ? { value: String(o.value), label: o.label ?? String(o.value) } : { value: String(o), label: String(o) }));
    return <div className="setting-row setting-row-input">
      <div className="setting-text"><strong>{field.label}</strong>{hint}</div>
      <Select aria-label={field.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} options={options} />
    </div>;
  }
  if (field.type === 'text') {
    return <div className="setting-row setting-row-block">
      <div className="setting-text"><strong>{field.label}</strong>{hint}</div>
      <Textarea aria-label={field.label} value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>;
  }
  return <div className="setting-row setting-row-input">
    <div className="setting-text"><strong>{field.label}</strong>{hint}</div>
    <Input aria-label={field.label} type={field.type === 'number' ? 'number' : 'text'} min={field.min} max={field.max}
      value={value ?? ''} onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
  </div>;
}

function SectionCard({ section, onSaved }) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const fields = section.fields || [];
  const valueOf = (f) => (Object.prototype.hasOwnProperty.call(draft, f.key) ? draft[f.key] : f.value);
  const dirty = Object.keys(draft).length > 0;
  const enabledField = section.enabledKey && fields.find((f) => f.key === section.enabledKey);

  const send = async (pairs) => {
    // Поля одного раздела могут храниться в разных scope (например, ЮKassa).
    const byScope = {};
    for (const [field, value] of pairs) {
      const scope = field.scope || section.scope;
      (byScope[scope] ||= {})[field.key] = value;
    }
    for (const [scope, value] of Object.entries(byScope)) await api.post(`/settings/configs/${scope}`, { value });
  };

  const toggle = async (f, v) => {
    setBusy(f.key);
    try { await send([[f, v]]); f.value = v; toast(`${f.label}: ${v ? 'включено' : 'выключено'}`); onSaved(); }
    catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    try {
      await send(Object.entries(draft).map(([k, v]) => [fields.find((f) => f.key === k), v]));
      fields.forEach((f) => { if (f.key in draft) f.value = draft[f.key]; });
      setDraft({}); toast('Сохранено'); onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(null); }
  };

  const on = fields.filter((f) => f.type === 'bool' && valueOf(f)).length;
  const total = fields.filter((f) => f.type === 'bool').length;
  return <Card className="setting-card" title={<span className="row">{section.title}{total > 0 && <Badge tone={on ? 'ok' : 'muted'}>{on} из {total}</Badge>}</span>}
    actions={dirty && <Button size="sm" busy={busy === 'save'} onClick={save}>Сохранить</Button>}>
    {section.description && <p className="setting-desc">{section.description}</p>}
    {!fields.length ? <p className="muted">Нет настроек.</p> : <div className="setting-list">
      {fields.map((f) => <Field key={`${f.scope || ''}${f.key}`} field={f} value={valueOf(f)} busy={busy === f.key || (enabledField && f !== enabledField && !valueOf(enabledField))}
        onToggle={(v) => toggle(f, v)} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />)}
    </div>}
  </Card>;
}

export default function Settings() {
  useDocumentTitle('Настройки бота');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const state = useLoad((signal) => api.get('/settings/schema', null, { signal }), []);
  const { refreshConfig, isAdmin } = useAuth();
  const sections = state.data?.sections || [];
  const current = params.get('s') || sections[0]?.scope;
  const active = sections.find((s) => s.scope === current) || sections[0];

  // Поиск по всем разделам сразу.
  const found = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    return sections.flatMap(flatten).map((s) => ({ ...s, fields: (s.fields || []).filter((f) => `${f.label} ${f.hint || ''} ${f.key}`.toLowerCase().includes(term)) }))
      .filter((s) => s.fields.length);
  }, [q, sections]);

  if (state.loading && !state.data) return <Spinner />;
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;

  return <>
    <PageHead title="Настройки бота" subtitle="Те же переключатели, что в админке бота: кассы, кнопки, режимы, уведомления. Изменения сразу действуют и в боте, и на сайте."
      actions={isAdmin && <RestartBot />} />
    <div className="settings-layout">
      <nav className="settings-nav card">
        <SearchInput value={q} onChange={setQ} placeholder="Найти настройку" />
        <div className="settings-nav-list">
          {sections.map((s) => <button type="button" key={s.scope} aria-current={!found && s.scope === active?.scope}
            onClick={() => { setQ(''); setParams({ s: s.scope }); }}>{s.title}</button>)}
        </div>
      </nav>
      <div className="stack" style={{ gap: 18 }} key={found ? 'search' : active?.scope}>
        {found
          ? (found.length ? found.map((s) => <SectionCard key={`f-${s.scope}`} section={s} onSaved={refreshConfig} />) : <Card><p className="muted">Ничего не найдено.</p></Card>)
          : active && <>
            {!active.fields?.length && active.description && <p className="setting-desc" style={{ margin: 0 }}>{active.description}</p>}
            {flatten(active).map((s) => <SectionCard key={s.scope} section={s} onSaved={refreshConfig} />)}
          </>}
      </div>
    </div>
  </>;
}
