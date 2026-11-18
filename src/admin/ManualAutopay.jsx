import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime, rub } from '../lib/format.js';
import { Badge, Button, ErrorBox, KeyValue, Loadable, Modal, Textarea } from '../ui/index.jsx';

const STATUS = {applied:'Продление применено',canceled:'Платёж отменён',pending:'Ожидает завершения',prepared:'Подготовка',unknown:'Результат уточняется',succeeded:'Оплачено, продление обрабатывается',manual_review:'Требуется проверка платежа'};
const REASONS = {insufficient_funds:'Недостаточно средств на карте',permission_revoked:'Разрешение на списание отозвано',card_expired:'Срок карты истёк',fraud_suspected:'Операция отклонена платёжной системой'};

export default function ManualAutopay({ userId, subscription, onClose, onChanged }) {
  const path=`/portal/admin/users/${userId}/autopay/${subscription.id}`;
  const preview=useLoad(()=>api.post(`${path}/preview`),[path]);
  const [reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [submitted,setSubmitted]=useState(false);
  const [result,setResult]=useState(null);
  const [error,setError]=useState(null);
  const [checking,setChecking]=useState(false);
  const quote=preview.data;
  const check = async () => {
    if (!quote || checking || busy) return;
    setChecking(true);setError(null);
    try {setResult(await api.get(`${path}/attempts/${quote.preview_id}`));onChanged();}
    catch(err){setError(err);}finally{setChecking(false);}
  };
  const submit = async () => {
    if (!quote || !confirmed || reason.trim().length<3 || busy || submitted) return;
    setBusy(true);setSubmitted(true);setError(null);
    try {
      const answer=await api.post(`${path}/charge`,{preview_id:quote.preview_id,confirmed:true,reason:reason.trim()});
      setResult(answer);onChanged();
    } catch(err){setError(err);}finally{setBusy(false);}
  };
  const terminal=result?.status==='applied'||result?.status==='canceled';
  return <Modal open title="Списать сейчас" onClose={()=>{if(!busy&&!checking)onClose();}}
    footer={<><Button variant="ghost" disabled={busy||checking} onClick={onClose}>Закрыть</Button>
      {submitted ? !terminal && <Button variant="secondary" busy={checking} disabled={busy} onClick={check}>Проверить статус</Button>
        : <Button busy={busy} disabled={!quote||!confirmed||reason.trim().length<3||preview.loading||Boolean(preview.error)} onClick={submit}>Подтвердить списание</Button>}</>}>
    <Loadable state={preview}>{data=><div className="stack">
      <p className="muted">Досрочное продление подписки клиента. Бот сначала использует баланс аккаунта, остаток списывает с сохранённой карты. Новое согласие вместо клиента не создаётся.</p>
      <KeyValue items={[
        ['Подписка',data.client_id],['Стоимость продления',rub(data.amount)],
        ['С баланса аккаунта',rub(data.from_balance)],['С карты'+(data.card_mask?` · ${data.card_mask}`:''),rub(data.from_card)],
        ['Итого с учётом комиссии',rub(data.gross_amount)],['Продление',`${data.period_days} дней`],
        ['Срок сейчас',dateTime(data.expiry_before)],['После успешной оплаты',dateTime(data.expiry_after)],
      ]}/>
      {!submitted && <>
        <Textarea label="Причина запуска" required minLength={3} maxLength={500} rows={3} value={reason} onChange={e=>setReason(e.target.value)} hint="Сохранится в журнале администратора. Запускайте по просьбе клиента."/>
        <label className="payment-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>Подтверждаю досрочное продление и списание {rub(data.from_card)} с сохранённой карты по просьбе клиента.</span></label>
        <p className="field-hint">Расчёт действует до {dateTime(data.valid_until)}. Если сумма, карта или подписка изменятся, потребуется новый расчёт.</p>
      </>}
      {error && <ErrorBox error={error}/>}
      {result && <div className="stack" role="status">
        <Badge tone={result.status==='applied'?'ok':result.status==='canceled'?'warn':'muted'}>{STATUS[result.status]||result.status}</Badge>
        {result.cancellation_details?.reason && <p>{REASONS[result.cancellation_details.reason]||`Причина отмены: ${result.cancellation_details.reason}`}</p>}
        {result.pipeline_error && <p>{result.pipeline_error}</p>}
      </div>}
      {submitted&&!terminal&&!busy && <p className="notice">Проверка статуса не создаёт новое списание. Если ответ запроса потерялся, сначала проверьте результат этой попытки.</p>}
    </div>}</Loadable>
  </Modal>;
}
