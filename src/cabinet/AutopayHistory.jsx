import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime, rub } from '../lib/format.js';
import { Badge, Empty, ErrorBox, Loadable, Pagination, Table } from '../ui/index.jsx';

const STATUS = { prepared:'Подготовка', unknown:'Уточняется', pending:'Ожидает оплаты', succeeded:'Оплачено, обрабатывается', applied:'Продление применено', canceled:'Не выполнено', manual_review:'Проверяется поддержкой' };
export default function AutopayHistory() {
  const [offset,setOffset]=useState(0);
  const state=useLoad(signal=>api.get('/portal/autopay-history',{limit:20,offset},{signal}),[offset]);
  return <section className="stack" aria-label="История автосписаний"><h3>История автосписаний</h3>
    <p className="field-hint">Попытки ЮKassa. Дата следующего списания — текущее расписание подписки. Отказ провайдера и отмена согласия могут иметь общий статус «Не выполнено».</p>
    {state.error && state.data && <ErrorBox error={state.error} onRetry={state.reload}/>}
    <Loadable state={state}>{data=><><Table rows={data.items || []} rowKey={r=>r.id} empty={<Empty icon="card" title="Попыток пока нет" text="После первой попытки списания здесь появится результат."/>} columns={[
      {key:'date',title:'Дата',render:r=>dateTime(r.created_at)},
      {key:'amount',title:'Сумма',render:r=>r.amount == null ? 'Не указана' : rub(r.amount)},
      {key:'status',title:'Результат',render:r=><div className="cell-main"><Badge tone={r.status==='applied'?'ok':r.status==='canceled'||r.status==='manual_review'?'warn':'muted'}>{STATUS[r.status]||r.status}</Badge>{r.reason&&<span>{r.reason}</span>}<span>{r.client_id || 'Подписка удалена'}</span></div>},
      {key:'next',title:'Следующее списание',render:r=>r.next_payment_date?dateTime(r.next_payment_date):'Не запланировано'},
    ]}/><Pagination total={data.total} limit={20} offset={offset} onChange={setOffset}/></>}</Loadable>
  </section>;
}
