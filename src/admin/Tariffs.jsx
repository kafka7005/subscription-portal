import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { rub } from '../lib/format.js';
import { TARIFF_GROUP, cleanName } from '../lib/tariffs.js';
import { Badge, Button, Card, Input, Loadable, Modal, PageHead, Segmented, Table, Toggle, useToast } from '../ui/index.jsx';

// Таблица доплат за устройства: «2:249, 3:349» ⇄ { "2": 249, "3": 349 }.
const overridesToText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}:${v}`).join(', ');
function textToOverrides(text) {
  const out = {};
  String(text || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).forEach((pair) => {
    const [k, v] = pair.split(':').map((x) => x.trim());
    if (k && v && !Number.isNaN(Number(v))) out[k] = Number(v);
  });
  return out;
}

function EditModal({ tariff, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tariff) setForm({
      name: tariff.name, price_rub: tariff.price_rub, duration_days: tariff.duration_days, is_active: tariff.is_active,
      sort_order: tariff.sort_order ?? 0, device_limit: tariff.device_limit ?? '', traffic_limit: tariff.traffic_limit ?? '',
      device_options: (tariff.device_options || []).join(', '), device_step_rub: tariff.device_step_rub ?? '',
      device_overrides: overridesToText(tariff.device_overrides),
    });
  }, [tariff]);
  if (!tariff || !form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    try {
      const num = (v) => (v === '' || v === null ? null : Number(v));
      const body = {
        name: form.name.trim(), price_rub: Number(form.price_rub), duration_days: Number(form.duration_days), is_active: form.is_active,
        sort_order: Number(form.sort_order), device_limit: num(form.device_limit), traffic_limit: num(form.traffic_limit),
      };
      if (tariff.configurable) {
        body.device_options = form.device_options.split(/[,\s]+/).filter(Boolean).map(Number);
        body.device_step_rub = num(form.device_step_rub);
        body.device_overrides = textToOverrides(form.device_overrides);
      }
      await api.patch(`/tariffs/${tariff.id}`, body);
      toast('Тариф сохранён'); onSaved(); onClose();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title={`Тариф #${tariff.id}`} size="lg"
    footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button busy={busy} onClick={save}>Сохранить</Button></>}>
    <div className="notice notice-warn">Изменения сразу видны клиентам в боте и на сайте. Уже купленные подписки не меняются.</div>
    <div className="form-grid">
      <Input label="Название" value={form.name} onChange={set('name')} className="span-2" />
      <Input label="Цена, ₽" type="number" min="0" value={form.price_rub} onChange={set('price_rub')} hint={tariff.configurable ? 'Цена за минимальное число устройств' : null} />
      <Input label="Срок, дней" type="number" min="1" value={form.duration_days} onChange={set('duration_days')} />
      <Input label="Устройств (базово)" type="number" min="0" value={form.device_limit} onChange={set('device_limit')} hint="Пусто — без ограничения" />
      <Input label="Трафик, ГБ" type="number" min="0" value={form.traffic_limit} onChange={set('traffic_limit')} hint="Пусто — без ограничения" />
      <Input label="Порядок" type="number" value={form.sort_order} onChange={set('sort_order')} hint="Меньше — выше в списке" />
      <div className="field"><span className="field-label">Доступность</span><Toggle checked={form.is_active} onChange={set('is_active')} label={form.is_active ? 'Продаётся' : 'Скрыт'} /></div>
      {tariff.configurable && <>
        <Input label="Варианты устройств" value={form.device_options} onChange={set('device_options')} hint="Через запятую: 1, 2, 3, 5, 10" className="span-2" />
        <Input label="Доплата за устройство, ₽" type="number" min="0" value={form.device_step_rub} onChange={set('device_step_rub')} />
        <Input label="Особые цены" value={form.device_overrides} onChange={set('device_overrides')} hint="устройств:цена, например 2:249, 3:349" />
      </>}
    </div>
  </Modal>;
}

export default function Tariffs() {
  useDocumentTitle('Тарифы');
  const state = useLoad((signal) => api.get('/tariffs', { limit: 500 }, { signal }), []);
  const [group, setGroup] = useState(TARIFF_GROUP);
  const [editing, setEditing] = useState(null);
  const groups = useMemo(() => {
    const map = {};
    (state.data || []).forEach((t) => { map[t.group_code] = (map[t.group_code] || 0) + 1; });
    return Object.entries(map).sort(([a], [b]) => (a === TARIFF_GROUP ? -1 : b === TARIFF_GROUP ? 1 : a.localeCompare(b)));
  }, [state.data]);
  const rows = (state.data || []).filter((t) => t.group_code === group).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return <>
    <PageHead title="Тарифы" subtitle={`Группа «${TARIFF_GROUP}» показывается на главной сайта. Остальные группы — для бота, скидок и подарков.`} />
    <Card>
      <Loadable state={state}>{() => <>
        <div className="toolbar">
          <Segmented label="Группа" value={group} onChange={setGroup} options={groups.map(([g, n]) => ({ value: g, label: g === TARIFF_GROUP ? `${g} · сайт` : g, count: n }))} />
        </div>
        <Table rows={rows} rowKey={(t) => t.id} onRowClick={setEditing}
          columns={[
            { key: 'name', title: 'Тариф', className: 'cell-primary', render: (t) => <div className="cell-main"><strong>{cleanName(t.name)}</strong><span>#{t.id}{t.subgroup_title ? ` · ${t.subgroup_title}` : ''}</span></div> },
            { key: 'days', title: 'Срок', render: (t) => `${t.duration_days} дн` },
            { key: 'price', title: 'Цена', className: 'num', render: (t) => <strong>{rub(t.price_rub)}</strong> },
            { key: 'devices', title: 'Устройства', render: (t) => (t.configurable ? `${(t.device_options || []).join(', ')} · +${rub(t.device_step_rub || 0)}` : t.device_limit ?? '∞') },
            { key: 'active', title: 'Статус', render: (t) => (t.is_active ? <Badge tone="ok">Продаётся</Badge> : <Badge tone="muted">Скрыт</Badge>) },
          ]} />
        <p className="help-text" style={{ marginTop: 14 }}>Создавать новые тарифы и группы удобнее в боте (Админка → Тарифы): там же они привязываются к серверам.</p>
      </>}</Loadable>
    </Card>
    <EditModal tariff={editing} onClose={() => setEditing(null)} onSaved={() => state.reload(true)} />
  </>;
}
