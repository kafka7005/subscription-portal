import { useEffect, useState } from 'react';
import { Button, Empty, ErrorBox, Icon, Loadable, Modal, SearchInput } from '../ui/index.jsx';
import CannedReplies from './CannedReplies.jsx';

export default function TemplatePicker({ state, canManage, onPick, onClose }) {
  const [query,setQuery]=useState('');
  const [editor,setEditor]=useState(null);
  const [error,setError]=useState(null);
  useEffect(()=>{state.reload();},[state.reload]);
  const pick=reply=>{
    if(onPick(reply)===false)setError(new Error('Шаблон не помещается: сократите черновик до 4000 символов вместе с текстом шаблона.'));
  };
  if(editor)return <CannedReplies startNew={editor==='new'} onClose={()=>setEditor(null)} onSaved={result=>{state.setData(result);setQuery('');setError(null);setEditor(null);}}/>;
  const search=query.trim().toLocaleLowerCase();
  return <Modal open size="lg" title="Шаблоны ответов" onClose={onClose}
    footer={<Button variant="ghost" onClick={onClose}>Закрыть</Button>}>
    <div className="stack">
      <p className="field-hint">Нажмите на плитку, чтобы вставить заготовку в черновик. Сообщение не отправится автоматически.</p>
      <div className="reply-template-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Найти по названию или тексту"/>
        {canManage&&<><Button size="sm" variant="secondary" onClick={()=>setEditor('manage')}>Редактировать</Button><Button size="sm" icon="plus" onClick={()=>setEditor('new')}>Добавить шаблон</Button></>}
      </div>
      {error&&<ErrorBox error={error}/>}
      {state.error&&state.data&&<ErrorBox error={state.error} onRetry={state.reload}/>}
      <Loadable state={state}>{data=>{
        const all=data.items||[];
        const items=all.filter(r=>!search||`${r.title}\n${r.body}`.toLocaleLowerCase().includes(search));
        if(!items.length)return <Empty icon="file" title={all.length?'Ничего не найдено':'Шаблонов пока нет'} text={all.length?'Попробуйте другое название или фразу.':canManage?'Добавьте первую заготовку прямо здесь.':'Администратор может добавить заготовки для сотрудников.'}/>;
        return <div className="reply-template-grid" role="group" aria-label="Выберите заготовку ответа">{items.map(r=><button type="button" className="reply-template-tile" key={r.title} title={r.body} onClick={()=>pick(r)}>
          <strong>{r.title}</strong><span className="reply-template-preview">{r.body}</span><span className="reply-template-insert">Вставить в ответ<Icon name="arrow" size={16}/></span>
        </button>)}</div>;
      }}</Loadable>
    </div>
  </Modal>;
}
