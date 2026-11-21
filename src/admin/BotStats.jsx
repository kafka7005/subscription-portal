import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { Button, Card, ErrorBox, PageHead, Segmented, Select, Spinner } from '../ui/index.jsx';
import { parseBotStats } from './botStatsReport.js';
import './bot-stats.css';

const sections = [
  ['overview', 'Обзор'], ['clients', 'Клиенты'], ['subs', 'Подписки'],
  ['payments', 'Оплаты'], ['tariffs', 'Тарифы'], ['leads', 'Лиды'],
  ['modules', 'Модули'], ['charts', 'Графики'],
];

function MetricCards({ text, section }) {
  const { groups, updated } = parseBotStats(text);
  return <div className="bot-stats-groups">
    {groups.map(({ title, rows }, groupIndex) => {
      const tariffTree = section === 'tariffs' && title === 'По тарифам';
      return <section key={groupIndex}>
        {title && title !== sections.find(([key]) => key === section)?.[1] && <h3>{title}</h3>}
        <dl className={tariffTree ? 'bot-stats-tree' : 'bot-stats-metrics'}>
          {rows.map((row, index) => row.text !== undefined
            ? <div className="bot-stats-note" key={index}><dt className="sr-only">Пояснение</dt><dd>{row.text}</dd></div>
            : <div key={index} className="bot-stats-metric" data-primary={section === 'overview' && row.label === 'Оплаты за месяц' || undefined}
                style={tariffTree ? { '--depth': Math.min(3, row.depth) } : undefined}>
                <dt>{row.label}</dt><dd>{row.value}</dd>
              </div>)}
        </dl>
      </section>;
    })}
    {!groups.length && <p className="muted">Показателей пока нет.</p>}
    {updated && <small className="bot-stats-updated">{updated} МСК</small>}
  </div>;
}

function Report({ section, days }) {
  const chart = section === 'charts';
  const path = '/portal/admin/bot-stats/' + (chart ? 'charts/' + days : section);
  const state = useLoad(signal => api.get(path, null, { signal }), [path]);
  const unavailable = state.error?.status === 404;
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
      </figure> : <MetricCards text={state.data.text} section={section} />}
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
    <div className="bot-stats-picker"><Select label="Раздел статистики" value={section}
      onChange={event => setSection(event.target.value)} options={sections.map(([value,label]) => ({ value, label }))} /></div>
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
