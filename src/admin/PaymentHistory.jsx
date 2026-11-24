import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { paymentDateTime, refundDateTime, money, paymentStatusLabel } from '../lib/format.js';
import { KeyValue, Loadable, Modal } from '../ui/index.jsx';

function RefundHistory({ payment }) {
  const state = useLoad(async (signal) => {
    const response = await api.get(`/admin/yookassa/refunds/payments/${payment.id}/history`, null, { signal });
    if (!Array.isArray(response?.items)) throw new Error('API вернул неизвестный формат истории');
    return response.items;
  }, [payment.id]);
  const labels = { id:'Операция', status:'Статус', state:'Состояние', amount:'Сумма', currency:'Валюта', created_at:'Создана', updated_at:'Обновлена', description:'Описание', refund_id:'Номер возврата', payment_record_id:'Платёж', error_message:'Ошибка' };
  return <Loadable state={state}>{(items)=>items.length ? <div className="stack">{items.map((row,index)=><div className="admin-payment-operation" key={row.id || index}>
    <KeyValue items={Object.entries(labels).filter(([key])=>row[key]!=null && typeof row[key]!=='object').map(([key,label])=>[label,key.endsWith('_at')?refundDateTime(row[key]):String(row[key])])}/>
  </div>)}</div> : <p className="muted">Операций возврата нет.</p>}</Loadable>;
}

export default function PaymentHistory({ payment, onClose }) {
  return <Modal open onClose={onClose} title={`История платежа №${payment.id}`} size="lg"><div className="stack">
    <KeyValue items={[
      ['Сумма',money(payment.amount,payment.currency)],['Дата',paymentDateTime(payment.created_at)],
      ['Касса',payment.payment_system],['Статус',paymentStatusLabel[payment.status] || payment.status],
    ]}/>
    <h3>Операции возврата</h3><RefundHistory payment={payment}/>
  </div></Modal>;
}
