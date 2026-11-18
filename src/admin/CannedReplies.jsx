import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { Button, Empty, ErrorBox, Input, Modal, Spinner, Textarea, useConfirm, useToast } from '../ui/index.jsx';

const serialize = items => JSON.stringify(items.map(({title,body})=>({title,body})));
export default function CannedReplies({ onClose, onSaved, startNew = false, initialBody = '' }) {
  const state=useLoad(signal=>api.get('/portal/canned-replies',null,{signal}),[]);
  const [items,setItems]=useState(null);
  const [baseline,setBaseline]=useState(null);
  const [selected,setSelected]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(null);
  const confirm=useConfirm();
  const toast=useToast();
  useEffect(()=>{
    if(state.data && items===null){
      const initial=state.data.items.map(r=>({...r,id:crypto.randomUUID()}));
      const added=startNew&&initial.length<50?{id:crypto.randomUUID(),title:'',body:initialBody}:null;
      setItems(added?[...initial,added]:initial);setBaseline(serialize(initial));setSelected(added?.id||initial[0]?.id);
    }
  },[state.data,items,startNew,initialBody]);
  const current=items?.find(r=>r.id===selected);
  const dirty=items!==null&&serialize(items)!==baseline;
  const duplicate=items?.some((r,i)=>items.findIndex(other=>other.title.trim().toLocaleLowerCase()===r.title.trim().toLocaleLowerCase())!==i);
  const invalid=items?.some(r=>!r.title.trim()||!r.body.trim()||r.body.length>2000||r.title.length>80)||duplicate;
  const close=async()=>{
    if(busy)return;
    if(dirty&&!await confirm({title:'Закрыть без сохранения?',text:'Изменения быстрых ответов будут потеряны.',confirmText:'Закрыть'}))return;
    onClose();
  };
  const add=()=>{
    const item={id:crypto.randomUUID(),title:'',body:''};
    setItems(previous=>[...previous,item]);setSelected(item.id);
  };
  const patch=values=>setItems(previous=>previous.map(r=>r.id===selected?{...r,...values}:r));
  const remove=async()=>{
    if(!current)return;
    if(!await confirm({title:'Удалить шаблон?',text:current.title||'Новый шаблон',confirmText:'Удалить',danger:true}))return;
    const next=items.filter(r=>r.id!==selected);setItems(next);setSelected(next[0]?.id);
  };
  const save=async()=>{
    if(busy||!dirty||invalid)return;
    setBusy(true);setError(null);
    try{
      const result=await api.put('/portal/canned-replies',{items:items.map(({title,body})=>({title:title.trim(),body:body.trim()}))});
      const next=result.items.map(r=>({...r,id:crypto.randomUUID()}));
      const index=Math.max(0,items.findIndex(r=>r.id===selected));
      setItems(next);setBaseline(serialize(next));setSelected(next[index]?.id);
      onSaved?.(result);toast('Быстрые ответы сохранены');
    }catch(err){setError(err);}finally{setBusy(false);}
  };
  return <Modal open size="lg" title="Быстрые ответы" onClose={close} footer={<>
    <Button variant="ghost" disabled={busy} onClick={close}>Закрыть</Button>
    <Button busy={busy} disabled={!dirty||invalid} onClick={save}>Сохранить</Button>
  </>}>
    <p className="field-hint">Общие шаблоны для сотрудников. В чате нажатие на название только вставит текст — отправку нужно подтвердить отдельно.</p>
    {state.error&&<ErrorBox error={state.error} onRetry={state.reload}/>}
    {error&&<ErrorBox error={error}/>}
    {items===null&&!state.error?<Spinner/>:items!==null&&<div className="quick-replies-editor">
      <div className="stack"><div className="quick-replies-list" role="group" aria-label="Шаблоны">
        {items.map((r,i)=><button type="button" key={r.id} disabled={busy} aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)}>{r.title||`Новый шаблон ${i+1}`}</button>)}
      </div><Button size="sm" variant="secondary" icon="plus" disabled={busy||items.length>=50} onClick={add}>Добавить шаблон</Button>
      <p className="field-hint">{items.length} из 50</p></div>
      {current?<div className="stack">
        <Input label="Название кнопки" maxLength={80} required autoFocus={startNew} value={current.title} disabled={busy} onChange={e=>patch({title:e.target.value})} placeholder="Например: Обновить подписку"/>
        <Textarea label="Текст ответа" maxLength={2000} rows={8} required value={current.body} disabled={busy} onChange={e=>patch({body:e.target.value})} hint={`${current.body.length} из 2000 символов`}/>
        {current.body.length>2000&&<p className="field-hint" role="alert">Сократите сообщение до 2000 символов, чтобы сохранить его как шаблон.</p>}
        {duplicate&&<p className="field-hint" role="alert">Названия шаблонов должны отличаться.</p>}
        <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={remove}>Удалить шаблон</Button>
      </div>:<Empty icon="chat" title="Шаблонов нет" text="Добавьте первый быстрый ответ. Пустой список можно сохранить, чтобы убрать все кнопки шаблонов."/>}
    </div>}
  </Modal>;
}
