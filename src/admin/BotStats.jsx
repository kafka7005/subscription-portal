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

const highlights = {
  overview: ['Оплаты за месяц', 'Оплаты за месяц'],
  clients: ['Всего', 'Всего клиентов'],
  subs: ['Активных', 'Активные подписки'],
  payments: ['Месяц', 'Оплаты за месяц'],
  leads: ['Горячие', 'Горячие лиды'],
};

function MetricList({ rows, tree = false }) {
  return <dl className={tree ? 'bot-stats-list bot-stats-tree' : 'bot-stats-list'}>
    {rows.map((row, index) => row.text !== undefined
      ? <div className="bot-stats-note" key={index}><dt className="sr-only">Пояснение</dt><dd>{row.text}</dd></div>
      : <div key={index} className="bot-stats-row"
          style={tree ? { '--depth': Math.min(3, row.depth) } : undefined}>
          <dt>{row.label}</dt><dd>{row.value}</dd>
        </div>)}
  </dl>;
}

function MetricCards({ text, section }) {
  const { groups, updated } = parseBotStats(text);
  const [label, heading] = highlights[section] || [];
  const sectionName = sections.find(([key]) => key === section)?.[1];
  const first = groups[0];
  const main = label && first?.rows.find(row => row.label === label);
  const secondaryGroups = main ? groups.slice(1) : groups;
  return <div className="bot-stats-groups">
    {main && <div className="bot-stats-summary">
      <dl className="bot-stats-key"><dt>{heading}</dt><dd>{main.value}</dd></dl>
      <div>
        {first.title && first.title !== sectionName && <h3>{first.title}</h3>}
        <MetricList rows={first.rows.filter(row => row !== main)} />
      </div>
    </div>}
    {secondaryGroups.length > 0 && <div className="bot-stats-breakdown">
      {secondaryGroups.map(({ title, rows }, index) => {
        const tree = section === 'tariffs' && title === 'По тарифам';
        const groupTitle = title || sectionName;
        return <section key={index} aria-label={groupTitle} className={tree ? 'bot-stats-section is-tree' : 'bot-stats-section'}>
          {title && <h3>{title}</h3>}
          <MetricList rows={rows} tree={tree} />
        </section>;
      })}
    </div>}
    {!groups.length && <p className="muted">Показателей пока нет.</p>}
    {updated && <small className="bot-stats-updated">{updated} МСК</small>}
  </div>;
}

function ChartLegend({ legend }) {
  if (!legend?.startsWith('Сверху вниз: ')) return <figcaption>{legend}</figcaption>;
  return <figcaption>Показатели сверху вниз
    <ol className="bot-stats-legend">{legend.slice('Сверху вниз: '.length).split(' · ').map((name, i) =>
      <li key={i}>{name}</li>)}</ol>
  </figcaption>;
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
        </div><ChartLegend legend={state.data.legend} />
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
