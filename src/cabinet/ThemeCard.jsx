import { useCabinetTheme } from '../lib/theme.js';
import { Card, Icon } from '../ui/index.jsx';

const OPTIONS = [
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
  { value: 'system', label: 'Как в системе', icon: 'device' },
];

// Выбор темы кабинета. Меняется сразу; переключатель в шапке делает то же самое.
export default function ThemeCard() {
  const { pref, choose } = useCabinetTheme();
  const set = choose;
  return <Card title="Оформление">
    <div className="theme-options" role="radiogroup" aria-label="Тема кабинета">
      {OPTIONS.map((o) => <button key={o.value} type="button" role="radio" aria-checked={pref === o.value} className={`theme-option theme-${o.value}`} onClick={() => set(o.value)}>
        <span className="theme-swatch" aria-hidden="true"><Icon name={o.icon} size={18} /></span>
        <span>{o.label}</span>
      </button>)}
    </div>
  </Card>;
}
