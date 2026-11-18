import { useMemo } from 'react';
import { api } from '../lib/api.js';
import { useDocumentTitle, useLoad } from '../lib/hooks.js';
import { Badge, Card, Loadable, PageHead, Table, Toggle, useConfirm, useToast } from '../ui/index.jsx';

export default function Servers() {
  useDocumentTitle('Серверы');
  const toast = useToast();
  const confirm = useConfirm();
  const servers = useLoad((signal) => api.get('/servers', { limit: 500 }, { signal }), []);
  const stats = useLoad((signal) => api.get('/servers/stats', null, { signal }).catch(() => null), []);
  const nodes = useLoad((signal) => api.get('/web/node-status/admin', null, { signal }).catch(() => null), []);

  const activeBy = useMemo(() => Object.fromEntries((stats.data?.active_by_cluster || []).map((r) => [r.server, r.active])), [stats.data]);
  const nodeList = nodes.data?.nodes || [];

  const toggle = async (s, enabled) => {
    if (!enabled && !await confirm({ title: `Выключить ${s.server_name}?`, text: 'На сервер перестанут выдаваться новые подписки. Уже выданные продолжат работать.', confirmText: 'Выключить', danger: true })) return;
    try { await api.patch(`/servers/${encodeURIComponent(s.server_name)}`, { enabled }); toast(enabled ? 'Сервер включён' : 'Сервер выключен'); servers.reload(true); } catch (err) { toast.error(err); }
  };

  return <>
    <PageHead title="Серверы" subtitle="Серверы из настроек бота. Выключенный сервер не получает новые подписки." />
    {nodeList.length > 0 && <Card title="Ноды Remnawave">
      <div className="chips">{nodeList.map((n) => <span key={n.uuid || n.name} className="chip"><Badge tone={n.online ? 'ok' : 'danger'}>{n.name || n.uuid}</Badge></span>)}</div>
    </Card>}
    <Card>
      <Loadable state={servers}>{(data) => <Table rows={data || []} rowKey={(s) => s.id}
        columns={[
          { key: 'name', title: 'Сервер', className: 'cell-primary', render: (s) => <div className="cell-main"><strong>{s.server_name}</strong><span>{s.cluster_name} · {s.panel_type}</span></div> },
          { key: 'group', title: 'Группа тарифов', render: (s) => s.tariff_group || '—' },
          { key: 'active', title: 'Активных', className: 'num', render: (s) => activeBy[s.cluster_name] ?? activeBy[s.server_name] ?? '—' },
          { key: 'max', title: 'Лимит', className: 'num', render: (s) => s.max_keys ?? '∞' },
          { key: 'enabled', title: 'Выдача', render: (s) => <Toggle checked={s.enabled} onChange={(v) => toggle(s, v)} label={s.enabled ? 'Вкл' : 'Выкл'} /> },
        ]} />}</Loadable>
      <p className="help-text" style={{ marginTop: 14 }}>Добавление серверов и смена адресов панелей — в боте (Админка → Серверы), чтобы бот сразу проверил подключение.</p>
    </Card>
  </>;
}
