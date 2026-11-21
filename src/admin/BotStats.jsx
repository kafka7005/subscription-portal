import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { Button, Card, ErrorBox, PageHead, Segmented, Spinner } from '../ui/index.jsx';
import './bot-stats.css';

const sections = [
  ['overview', 'Обзор'], ['clients', 'Клиенты'], ['subs', 'Подписки'],
  ['payments', 'Оплаты'], ['tariffs', 'Тарифы'], ['leads', 'Лиды'],
  ['modules', 'Модули'], ['charts', 'Графики'],
];

function Report({ section, days }) {
  const chart = section === 'charts';
  const path = '/portal/admin/bot-stats/' + (chart ? 'charts/' + days : section);
  const state = useLoad(signal => api.get(path, null, { signal }), [path]);
  const unavailable = state.error?.status === 404;
  const reportLines = state.data?.text?.split('\n') || [];
  // The bot puts its title and a rule before the actual report.
  const rule = reportLines.findIndex(line => /^_{3,}$/.test(line.trim()));
  const body = reportLines.slice(rule === 1 ? 2 : 0).join('\n').trim();
  return <Card title={sections.find(([key]) => key === section)[1]}
    actions={<Button size="sm" variant="secondary" icon="refresh" busy={state.loading}
      onClick={() => state.reload()}>Обновить</Button>}>
    {unavailable ? <p role="status">Для этого отчёта нужен модуль API версии 1.3.0 или новее и совместимая версия бота.</p>
      : state.error ? <ErrorBox error={state.error} onRetry={state.reload} />
      : !state.data ? <Spinner />
      : chart ? <figure className="bot-stats-chart">
        <div tabIndex={0} role="region" aria-label="График с горизонтальной прокруткой">
          <img src={'data:image/png;base64,' + state.data.png} alt={'Динамика показателей бота за ' + days + ' дней'} />
        </div><figcaption>{state.data.legend}</figcaption>
      </figure> : <pre className="bot-stats-report">{body}</pre>}
  </Card>;
}

export default function BotStats() {
  useDocumentTitle('Статистика бота');
  const { isAdmin } = useAuth();
  const [section, setSection] = useState('overview');
  const [days, setDays] = useState(30);
  if (!isAdmin) return <PageHead title="Требуются права администратора" />;
  return <div className="stack">
    <PageHead title="Статистика бота" subtitle="Календарные периоды рассчитываются по московскому времени." />
    <div className="bot-stats-menu" role="group" aria-label="Раздел статистики">
      {sections.map(([key, label]) => <Button key={key} size="sm"
        variant={key === section ? 'primary' : 'secondary'} aria-pressed={key === section}
        onClick={() => setSection(key)}>{label}</Button>)}
    </div>
    {section === 'charts' && <Segmented label="Период графика" value={days} onChange={setDays}
      options={[7, 30, 90].map(value => ({ value, label: value + ' дн.' }))} />}
    <Report key={section === 'charts' ? section + days : section} section={section} days={days} />
  </div>;
}
