import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { CABINET_SECTIONS, sectionAvailable } from '../cabinet/CabinetLayout.jsx';
import { Badge, Button, Card, Icon, IconButton, Input, Toggle } from '../ui/index.jsx';

const DEFAULT_MOBILE = ['home', 'payments', 'partner', 'support', 'profile'];
const MAX_MOBILE = 5;

function initialRows(nav) {
  const conf = new Map((nav || []).map((n, i) => [n.key, { ...n, order: i }]));
  return CABINET_SECTIONS.map((sec, i) => {
    const c = conf.get(sec.key);
    return {
      key: sec.key, icon: sec.icon, locked: sec.locked, feature: sec.feature, defaultOn: sec.defaultOn, siteFlag: sec.siteFlag,
      baseLabel: sec.label, baseShort: sec.short,
      label: c?.label || '', short: c?.short || '',
      side: sec.locked ? true : c ? c.side !== false : true,
      mobile: c ? Boolean(c.mobile) : DEFAULT_MOBILE.includes(sec.key),
      order: c ? c.order : 100 + i,
    };
  }).sort((a, b) => a.order - b.order);
}

// Админка → Сайт → Меню: порядок разделов кабинета, боковое и нижнее (мобильное) меню.
export default function MenuEditor({ site, onSave, busy }) {
  const { config } = useAuth();
  const features = config?.features || {};
  const [rows, setRows] = useState(() => initialRows(site.nav));
  useEffect(() => { setRows(initialRows(site.nav)); }, [site.nav]);

  const move = (i, d) => setRows((r) => {
    const j = i + d;
    if (j < 0 || j >= r.length) return r;
    const next = r.slice(); [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const patch = (key, p) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const mobileCount = rows.filter((r) => r.mobile).length;

  const save = () => onSave(rows.map((r) => ({
    key: r.key, side: r.side, mobile: r.mobile,
    ...(r.label.trim() ? { label: r.label.trim() } : {}),
    ...(r.short.trim() ? { short: r.short.trim() } : {}),
  })));
  const reset = () => onSave([]);

  return <div className="grid grid-main">
    <Card title="Разделы кабинета" actions={<>
      <Button size="sm" variant="ghost" onClick={reset} disabled={busy}>По умолчанию</Button>
      <Button size="sm" onClick={save} busy={busy}>Сохранить</Button>
    </>}>
      <p className="setting-desc">Порядок одинаковый для бокового меню (компьютер) и нижнего меню (телефон). В нижнем меню помещается не больше {MAX_MOBILE} пунктов. Разделы, выключенные в боте, клиенты не увидят, даже если они отмечены здесь.</p>
      <ul className="menu-rows">
        {rows.map((r, i) => {
          const on = sectionAvailable(r, features, site);
          return <li key={r.key} className={`menu-row ${on ? '' : 'is-off'}`}>
            <div className="menu-move">
              <IconButton icon="back" label="Выше" className="rot-up" disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon="back" label="Ниже" className="rot-down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
            </div>
            <span className="menu-icon"><Icon name={r.icon} /></span>
            <div className="menu-names">
              <Input aria-label="Название в боковом меню" value={r.label} placeholder={r.baseLabel} onChange={(e) => patch(r.key, { label: e.target.value })} />
              <Input aria-label="Короткое название в нижнем меню" value={r.short} placeholder={r.baseShort} maxLength={12} onChange={(e) => patch(r.key, { short: e.target.value })} />
              {!on && <Badge tone="muted">выключено в боте</Badge>}
            </div>
            <div className="menu-flags">
              <Toggle checked={r.side} disabled={r.locked} onChange={(v) => patch(r.key, { side: v })} label="Сбоку" />
              <Toggle checked={r.mobile} disabled={!r.mobile && mobileCount >= MAX_MOBILE} onChange={(v) => patch(r.key, { mobile: v })} label="Внизу" />
            </div>
          </li>;
        })}
      </ul>
    </Card>
    <Card title="Нижнее меню на телефоне">
      <div className="menu-preview">
        {rows.filter((r) => r.mobile && sectionAvailable(r, features, site)).slice(0, MAX_MOBILE).map((r, i) => <span key={r.key} className={`tab-link ${i === 0 ? 'active' : ''}`}>
          <Icon name={r.icon} size={22} /><span>{r.short || r.baseShort}</span>
        </span>)}
      </div>
      <p className="help-text" style={{ marginTop: 12 }}>«Главная» и «Профиль» всегда есть в боковом меню. Изменения появятся у клиентов после сохранения и перезагрузки страницы.</p>
    </Card>
  </div>;
}
