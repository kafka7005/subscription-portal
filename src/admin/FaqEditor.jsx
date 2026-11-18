import { useEffect, useState } from 'react';
import { FAQ_SLUG, loadFaq, writeKzPage } from '../lib/siteSettings.js';
import { dateTime } from '../lib/format.js';
import { FaqContent } from '../pages/HelpContent.jsx';
import { Badge, Button, Card, IconButton, Input, Segmented, Spinner, Textarea, useConfirm, useToast } from '../ui/index.jsx';

const clone = (v) => JSON.parse(JSON.stringify(v));
const swap = (arr, i, j) => { if (j < 0 || j >= arr.length) return arr; const n = arr.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; };

// Админка → Сайт → FAQ: группы вопросов, порядок, текст ответов (та же разметка, что в документах).
export default function FaqEditor() {
  const toast = useToast();
  const confirm = useConfirm();
  const [faq, setFaq] = useState(null);
  const [saved, setSaved] = useState('');
  const [meta, setMeta] = useState({ published: false, updated_at: null });
  const [view, setView] = useState('edit');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadFaq().then((d) => {
      const data = { sections: clone(d.sections || []) };
      setFaq(data); setSaved(JSON.stringify(data)); setMeta({ published: d.published, updated_at: d.updated_at || null });
    });
  }, []);

  if (!faq) return <Spinner />;
  const dirty = JSON.stringify(faq) !== saved || !meta.published;
  const setSections = (fn) => setFaq((f) => ({ ...f, sections: fn(f.sections) }));
  const patchSection = (si, p) => setSections((ss) => ss.map((s, i) => (i === si ? { ...s, ...p } : s)));
  const patchItem = (si, ii, p) => setSections((ss) => ss.map((s, i) => (i === si ? { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...p } : it)) } : s)));

  const removeSection = async (si) => {
    const s = faq.sections[si];
    if (s.items.length && !await confirm({ title: `Удалить группу «${s.title || 'без названия'}»?`, text: `Вместе с ней удалятся вопросы: ${s.items.length}.`, confirmText: 'Удалить', danger: true })) return;
    setSections((ss) => ss.filter((_, i) => i !== si));
  };
  const removeItem = async (si, ii) => {
    if (!await confirm({ title: 'Удалить вопрос?', text: faq.sections[si].items[ii].q, confirmText: 'Удалить', danger: true })) return;
    setSections((ss) => ss.map((s, i) => (i === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s)));
  };

  const publish = async () => {
    const clean = {
      sections: faq.sections
        .map((s) => ({ title: s.title.trim(), items: s.items.map((it) => ({ q: it.q.trim(), a: it.a.trim() })).filter((it) => it.q && it.a) }))
        .filter((s) => s.items.length),
    };
    setBusy(true);
    try {
      const updated_at = new Date().toISOString();
      await writeKzPage(FAQ_SLUG, { ...clean, updated_at }, 'Portal: FAQ');
      setFaq(clean); setSaved(JSON.stringify(clean)); setMeta({ published: true, updated_at });
      toast('FAQ опубликован');
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };

  return <div className="stack" style={{ gap: 18 }}>
    <Card>
      <div className="row-between">
        <div className="row">
          <a className="mono muted" href="/faq" target="_blank" rel="noopener noreferrer">/faq</a>
          {meta.published
            ? <Badge tone="ok">{meta.updated_at ? `Опубликован ${dateTime(meta.updated_at)}` : 'Опубликован'}</Badge>
            : <Badge tone="warn">Текст из Teletype, ещё не опубликован</Badge>}
        </div>
        <div className="row">
          <Segmented label="Режим" value={view} onChange={setView} options={[{ value: 'edit', label: 'Редактор' }, { value: 'preview', label: 'Просмотр' }]} />
          <Button busy={busy} disabled={!dirty} onClick={publish} icon="check">Опубликовать</Button>
        </div>
      </div>
      <p className="setting-desc" style={{ marginTop: 10 }}>FAQ виден в кабинете (раздел «Частые вопросы») и по ссылке /faq без входа. Разметка ответа: **жирный**, *курсив*, - пункт списка, 1. нумерация, [текст](https://ссылка), пустая строка — новый абзац.</p>
    </Card>

    {view === 'preview' ? <Card><FaqContent faq={faq} /></Card> : <>
      {faq.sections.map((s, si) => <Card key={si} className="faq-edit-section">
        <div className="faq-edit-head">
          <div className="menu-move">
            <IconButton icon="back" label="Группу выше" className="rot-up" disabled={si === 0} onClick={() => setSections((ss) => swap(ss, si, si - 1))} />
            <IconButton icon="back" label="Группу ниже" className="rot-down" disabled={si === faq.sections.length - 1} onClick={() => setSections((ss) => swap(ss, si, si + 1))} />
          </div>
          <Input aria-label="Название группы" value={s.title} placeholder="Название группы" onChange={(e) => patchSection(si, { title: e.target.value })} />
          <IconButton icon="trash" label="Удалить группу" onClick={() => removeSection(si)} />
        </div>
        <div className="faq-edit-items">
          {s.items.map((it, ii) => <div key={ii} className="faq-edit-item">
            <div className="faq-edit-row">
              <div className="menu-move">
                <IconButton icon="back" label="Выше" className="rot-up" disabled={ii === 0} onClick={() => patchSection(si, { items: swap(s.items, ii, ii - 1) })} />
                <IconButton icon="back" label="Ниже" className="rot-down" disabled={ii === s.items.length - 1} onClick={() => patchSection(si, { items: swap(s.items, ii, ii + 1) })} />
              </div>
              <Input aria-label="Вопрос" value={it.q} placeholder="Вопрос" onChange={(e) => patchItem(si, ii, { q: e.target.value })} />
              <IconButton icon="trash" label="Удалить вопрос" onClick={() => removeItem(si, ii)} />
            </div>
            <Textarea aria-label="Ответ" className="editor-field" rows={Math.min(14, Math.max(4, it.a.split('\n').length + 1))} value={it.a} placeholder="Ответ"
              onChange={(e) => patchItem(si, ii, { a: e.target.value })} />
          </div>)}
          <Button variant="ghost" size="sm" icon="plus" className="self-start" onClick={() => patchSection(si, { items: [...s.items, { q: '', a: '' }] })}>Вопрос</Button>
        </div>
      </Card>)}
      <Button variant="secondary" icon="plus" className="self-start" onClick={() => setSections((ss) => [...ss, { title: '', items: [{ q: '', a: '' }] }])}>Группа вопросов</Button>
    </>}
  </div>;
}
