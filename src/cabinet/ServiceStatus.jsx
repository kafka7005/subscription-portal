import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import CountryFlag from '../ui/CountryFlag.jsx';
import { countryForNode, nodeName } from '../lib/country.js';
import { api } from '../lib/api.js';
import { useLoad, useDocumentTitle } from '../lib/hooks.js';
import { useSiteSettings } from '../lib/siteSettings.js';
import { dateTime } from '../lib/format.js';
import { Badge, Button, Card, Empty, ErrorBox, Loadable, PageHead } from '../ui/index.jsx';

export default function ServiceStatus() {
  useDocumentTitle('Статус сервиса');
  const site = useSiteSettings();
  const [updated, setUpdated] = useState(null);
  const state = useLoad(async (signal) => {
    const data = await api.get('/web/node-status', null, { signal });
    if (!signal.aborted) setUpdated(new Date().toISOString());
    return data;
  }, []);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) state.reload(true); };
    const id = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(id); window.removeEventListener('focus', refresh); };
  }, [state.reload]);
  const notice = site?.service_notice;
  if (notice?.page_enabled === false) return <Navigate to="/cabinet" replace />;
  return <>
    <PageHead title="Статус сервиса" subtitle="Состояние локаций, доступных по вашим подпискам. Данные из мониторинга бота; обновляем раз в минуту."
      actions={<Button variant="secondary" icon="refresh" busy={state.loading} onClick={() => state.reload()}>Обновить</Button>} />
    {notice?.enabled && notice.text && <Card title={notice.title || 'Объявление сервиса'}><p className="service-notice">{notice.text}</p></Card>}
    {site?.maintenance?.enabled && <Card title={site.maintenance.title}><p className="service-notice">{site.maintenance.text}</p></Card>}
    <Card title="Локации">
      {state.error && state.data && <ErrorBox error={state.error} onRetry={state.reload} />}
      <Loadable state={state}>{(data) => data.nodes?.length ? <ul className="service-node-list">{data.nodes.map((node) => <li key={node.uuid || `${node.name}:${node.position}`}>
        <CountryFlag code={countryForNode(node)}/><strong>{nodeName(node)}</strong><Badge tone={node.online === true ? 'ok' : node.online === false ? 'warn' : 'muted'}>{node.online === true ? 'Доступна' : node.online === false ? 'Недоступна' : 'Нет данных'}</Badge>
      </li>)}</ul> : <Empty icon="server" title="Нет данных о локациях" text="Мониторинг ещё не передал данные либо у аккаунта нет доступных локаций. Это не означает, что VPN не работает." />}</Loadable>
      {updated && <p className="field-hint">Получено: {dateTime(updated)}</p>}
    </Card>
    <Button variant="secondary" to="/cabinet/support">Сообщить о проблеме</Button>
  </>;
}
