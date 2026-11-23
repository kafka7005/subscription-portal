import { useState } from 'react';
import { useLoad } from '../lib/hooks.js';
import { TARIFF_GROUP, loadPublicTariffs, siteTariffs } from '../lib/tariffs.js';
import { Button, Card, Loadable, Select } from '../ui/index.jsx';

export default function LandingTariffs({ saved, busy, onSave }) {
  const catalog = useLoad(() => loadPublicTariffs({ refresh: true }), []);
  const [group, setGroup] = useState(saved);
  const groups = [...new Set((catalog.data || []).filter(t => t.price_rub > 0 && t.group_code).map(t => t.group_code))].sort();
  const plans = siteTariffs(catalog.data, group || TARIFF_GROUP).slice(0, 4);
  const options = [
    { value: '', label: `По умолчанию (${TARIFF_GROUP})` },
    ...groups.map(value => ({ value, label: value })),
  ];
  if (saved && !groups.includes(saved)) options.push({ value: saved, label: `${saved} · недоступна`, disabled: true });
  return <Card title="Тарифы на лендинге">
    <Loadable state={catalog}>{() => <div className="stack">
      <Select label="Группа тарифов" options={options} value={group} disabled={busy}
        hint="На главной появятся первые четыре платных тарифа группы в порядке, заданном в боте."
        onChange={e => setGroup(e.target.value)} />
      <p className="muted">{plans.length
        ? plans.map(t => `${t.duration_days} дн. · ${t.price_rub} ₽`).join(' / ')
        : 'В этой группе пока нет доступных платных тарифов.'}</p>
      <Button className="self-start" busy={busy} disabled={saved === group || !plans.length} onClick={() => onSave(group)}>Сохранить</Button>
    </div>}</Loadable>
  </Card>;
}
