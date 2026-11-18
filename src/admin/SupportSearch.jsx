import { useState } from 'react';
import { api } from '../lib/api.js';
import { useDebounced, useLoad } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { Badge, Button, Empty, Loadable, Modal, Pagination, SearchInput } from '../ui/index.jsx';

function Highlight({text,query}) {
  if(!query)return text;
  const escaped=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return text.split(new RegExp(`(${escaped})`,'gi')).map((part,i)=>i%2?<mark key={i}>{part}</mark>:part);
}
export default function SupportSearch({ticketId,messages,onJump,onClose}) {
  const [value,setValue]=useState(''),[offset,setOffset]=useState(0);
  const query=useDebounced(value.trim(),300);
  const state=useLoad(signal=>query.length>=2?api.get(`/portal/support/tickets/${ticketId}/search`,{q:query,limit:30,offset},{signal}):{items:[],total:0},[ticketId,query,offset]);
  return <Modal open size="lg" title="Поиск в переписке" onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Закрыть</Button>}>
    <div className="stack"><SearchInput value={value} onChange={v=>{setValue(v.slice(0,200));setOffset(0);}} placeholder="Текст, ошибка или номер операции"/>
      {query.length<2?<p className="field-hint">Введите хотя бы два символа. Поиск включает всю историю обращения и заметки сотрудников.</p>:<Loadable state={state}>{data=><>
        {!data.items.length?<Empty icon="search" title="Ничего не найдено"/>:<div className="support-search-results">{data.items.map(m=><article key={m.id} className="support-search-match">
          <div className="row-between"><span><Badge tone="muted">{m.author==='client'?'Клиент':m.author==='note'?'Заметка':'Сотрудник'}</Badge> <span className="muted">{dateTime(m.created_at)}</span></span>
            {messages.some(row=>row.id===m.id)&&<Button size="sm" variant="ghost" onClick={()=>{onJump(m.id);onClose();}}>В переписке</Button>}</div>
          <p><Highlight text={m.body} query={query}/></p>
        </article>)}</div>}
        <Pagination total={data.total} limit={30} offset={offset} onChange={setOffset}/>
      </>}</Loadable>}
    </div>
  </Modal>;
}
