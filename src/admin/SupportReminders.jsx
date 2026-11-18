import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Button, ErrorBox, Input, Modal, Spinner, Toggle, useToast } from '../ui/index.jsx';

export default function SupportReminders({onClose}) {
  const state=useLoad(signal=>api.get('/portal/support/reminders',null,{signal}),[]);
  const [draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  const toast=useToast();
  useEffect(()=>{if(state.data&&!draft)setDraft(state.data);},[state.data,draft]);
  const valid=draft&&Number.isInteger(Number(draft.wait_minutes))&&Number(draft.wait_minutes)>=5&&Number(draft.wait_minutes)<=10080&&Number.isInteger(Number(draft.repeat_minutes))&&Number(draft.repeat_minutes)>=15&&Number(draft.repeat_minutes)<=10080;
  const save=async()=>{
    if(busy||!valid)return;setBusy(true);setError(null);
    try{await api.put('/portal/support/reminders',{enabled:draft.enabled,wait_minutes:Number(draft.wait_minutes),repeat_minutes:Number(draft.repeat_minutes)});toast('Настройки напоминаний сохранены');onClose();}
    catch(err){setError(err);}finally{setBusy(false);}
  };
  return <Modal open title="Напоминания поддержки" onClose={()=>{if(!busy)onClose();}} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Закрыть</Button><Button busy={busy} disabled={!valid} onClick={save}>Сохранить</Button></>}>
    {state.error&&<ErrorBox error={state.error} onRetry={state.reload}/>}{error&&<ErrorBox error={error}/>}
    {!draft&&!state.error?<Spinner/>:draft&&<div className="stack">
      <Toggle checked={draft.enabled} disabled={busy} onChange={enabled=>setDraft(d=>({...d,enabled}))} label="Напоминать сотрудникам об ожидании ответа"/>
      <Input label="Первое напоминание через, минут" type="number" min={5} max={10080} value={draft.wait_minutes} disabled={busy} onChange={e=>setDraft(d=>({...d,wait_minutes:e.target.value}))}/>
      <Input label="Повторять не чаще, чем раз в, минут" type="number" min={15} max={10080} value={draft.repeat_minutes} disabled={busy} onChange={e=>setDraft(d=>({...d,repeat_minutes:e.target.value}))}/>
      <p className="field-hint">Проверка раз в минуту. Колокольчик и push получат администраторы и модераторы сайта, в том числе по уже ожидающим обращениям. Клиентам и в Telegram напоминания не отправляются. После ответа сотрудника они прекращаются.</p>
    </div>}
  </Modal>;
}
