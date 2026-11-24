import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Button, Input, Loadable, Modal, Select, useConfirm, useToast } from '../ui/index.jsx';

const apiRoot = '/portal/admin/subscriptions/';
const baseFields = ['base_devices', 'extra_devices', 'base_traffic', 'extra_traffic'];
const label = n => Number(n) === 0 ? 'Без лимита' : String(n);
const valid = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647;

function LimitsForm({ data, sub, path, finish }) {
  const [form, setForm] = useState(() => Object.fromEntries(baseFields.map(k => [k, String(data[k])])));
  const [totals, setTotals] = useState({ device_limit: String(sub.device_limit ?? 0), traffic_limit: String(sub.traffic_limit ?? 0) });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const configurable = data.configurable;
  const values = configurable ? form : totals;
  const changed = configurable ? baseFields.some(k => Number(form[k]) !== data[k])
    : Object.keys(totals).some(k => Number(totals[k]) !== (sub[k] ?? 0));
  function pair(unit, title, options) {
    const base = 'base_' + unit, extra = 'extra_' + unit;
    const counts = [...new Set([data[base], ...options])].sort((a,b) => a-b);
    return <fieldset className="stack"><legend>{title}</legend>
      <Select label="База подписки" value={form[base]}
        options={counts.map(n => ({ value:String(n), label:label(n) }))}
        onChange={e => setForm({ ...form, [base]:e.target.value, [extra]:Number(e.target.value) ? form[extra] : '0' })} />
      <Input type="number" min="0" step="1" label={unit === 'devices' ? 'Докуплено устройств' : 'Докуплено, ГБ'}
        value={form[extra]} disabled={Number(form[base]) === 0} onChange={e => setForm({ ...form, [extra]:e.target.value })} />
      <span className="field-hint">Итого после сохранения · {valid(form[extra]) ? label(Number(form[base]) ? Number(form[base])+Number(form[extra]) : 0) : '—'}</span>
    </fieldset>;
  }
  const save = async () => {
    setBusy(true);
    try {
      if (configurable) {
        const body = Object.fromEntries(baseFields.map(k => [k, Number(form[k])]));
        await api.put(path + '/configuration', { ...body, revision:data.revision });
      } else {
        const body = Object.fromEntries(Object.entries(totals).filter(([k,v]) => Number(v) !== (sub[k] ?? 0)).map(([k,v]) => [k,Number(v)]));
        await api.post('/admin/subscriptions/' + encodeURIComponent(sub.client_id) + '/set-limits', body);
      }
      toast('Лимиты сохранены'); finish();
    } catch (error) { toast.error(error); } finally { setBusy(false); }
  };
  return <div className="stack">
    {configurable ? <>{pair('devices','Устройства',data.device_options)}{pair('traffic','Трафик, ГБ',data.traffic_options)}</>
      : <><p className="muted">У этого тарифа фиксированная конфигурация. Доступны общие лимиты.</p>
        {Object.keys(totals).map(k => <Input key={k} type="number" min="0" step="1" label={k === 'device_limit' ? 'Устройств' : 'Трафик, ГБ'} hint="0 — без ограничения"
          value={totals[k]} onChange={e => setTotals({ ...totals, [k]:e.target.value })} />)}</>}
    <Button busy={busy} disabled={!changed || !Object.values(values).every(valid)} onClick={save}>Сохранить</Button>
  </div>;
}

function ReissueForm({ data, sub, path, finish }) {
  const [mode,setMode] = useState('full');
  const targets = useLoad(signal => api.get(path+'/reissue-targets', null, {signal}), [path]);
  const [picked,setPicked] = useState('');
  const [node,setNode] = useState('');
  const catalog = targets.data?.clusters || {};
  const clusters = Object.keys(catalog);
  const original = clusters.find(name => name === sub.server_id || catalog[name].includes(sub.server_id));
  const cluster = picked || original || clusters[0] || '';
  const nodes = catalog[cluster] || [];
  const selectedNode = nodes.includes(node) ? node : nodes.includes(sub.server_id) ? sub.server_id : nodes[0];
  const [busy,setBusy] = useState(false);
  const confirm = useConfirm(), toast = useToast(), navigate = useNavigate();
  const rotate = mode === 'link';
  const submit = async () => {
    if (!await confirm({ title: rotate ? 'Заменить ссылку подписки?' : 'Пересоздать подписку на кластере?',
      text: rotate ? 'Старая ссылка перестанет работать. Бот отправит новую владельцу в Telegram.' : 'Подписка будет пересоздана на кластере «' + cluster + '».',
      confirmText: rotate ? 'Заменить ссылку' : 'Перевыпустить', danger:true })) return;
    setBusy(true);
    try {
      const result = await api.post(path + (rotate ? '/rotate-link' : '/rebuild'),
        {revision:data.link_revision, ...(rotate ? {} : {cluster, node:targets.data?.select_node ? selectedNode : undefined})});
      if (rotate && !result.notified) toast.error(new Error('Ссылка заменена. Отправка в Telegram не подтверждена.'));
      else toast(rotate ? 'Новая ссылка отправлена в Telegram' : 'Подписка перевыпущена');
      finish();
      if (!rotate && result.client_id !== sub.client_id) navigate(result.client_id ? '/admin/subscriptions/'+encodeURIComponent(result.client_id) : '/admin/subscriptions', {replace:true});
    } catch (error) { toast.error(error); } finally { setBusy(false); }
  };
  return <div className="stack"><Select label="Действие" value={mode} onChange={e => setMode(e.target.value)}
    options={[{value:'full',label:'Полный перевыпуск'},{value:'link',label:'Сменить ссылку и уведомить клиента'}]} />
    {rotate && <Button variant="ghost" busy={busy} onClick={async () => {
      if (!await confirm({title:'Отправить текущую ссылку в Telegram?', confirmText:'Отправить'})) return;
      setBusy(true);
      try {
        const result = await api.post(path+'/resend-link', {revision:data.link_revision});
        if (result.notified) toast('Telegram принял сообщение с текущей ссылкой');
        else toast.error(new Error('Отправить ссылку не удалось.'));
      } catch (err) { toast.error(err); } finally {setBusy(false);}
    }}>Повторить только уведомление</Button>}
    {rotate ? <p className="muted">Срок и лимиты сохранятся. Клиенту потребуется добавить новую ссылку в приложение.</p>
      : <Loadable state={targets}>{() => <div className="stack">
        <Select label="Кластер" value={cluster} onChange={e => {setPicked(e.target.value);setNode('');}} options={clusters.map(value => ({value,label:value}))} />
        {targets.data.select_node && <Select label="Сервер" value={selectedNode || ''} onChange={e => setNode(e.target.value)} options={nodes.map(value => ({value,label:value}))} />}
      </div>}</Loadable>}
    <Button busy={busy} disabled={!rotate && (!cluster || !nodes.length)} onClick={submit}>{rotate ? 'Сменить ссылку' : 'Полный перевыпуск'}</Button>
  </div>;
}

export default function SubscriptionManagement({ mode, sub, onClose, onDone }) {
  const path = apiRoot + encodeURIComponent(sub.client_id);
  const state = useLoad(signal => api.get(path+'/configuration', null, {signal}), [path]);
  const Form = mode === 'limits' ? LimitsForm : ReissueForm;
  return <Modal open onClose={onClose} size="sm" title={mode === 'limits' ? 'Лимиты устройств и трафика' : 'Перевыпуск подписки'}>
    {state.error?.status === 404 ? <p className="notice">Проверьте, что подписка существует и на сервере бота установлен модуль API версии 1.5.0 или новее.</p>
      : <Loadable state={state}>{data => <Form data={data} sub={sub} path={path} finish={() => {onDone();onClose();}} />}</Loadable>}
  </Modal>;
}
