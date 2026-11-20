import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { giveaways, states, useGiveawayConfig } from '../lib/giveaways.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { Button, Card, CopyField, Input, Loadable, PageHead, Select, Toggle, useConfirm, useToast } from '../ui/index.jsx';
import { GameList } from '../cabinet/Giveaways.jsx';

const types={balance:'Купон на баланс',days:'Купон на дни',percent:'Купон на скидку',subscription:'Подарочная подписка',manual:'Ручная выдача'};
const textFields={title:'Название',description:'Описание',channel:'Канал публикации',result_channel:'Канал итогов',deadline:'Приём заявок до'};
const numbers={min_invites:'Минимум приглашённых',bonus_every:'Один шанс за каждые N приглашённых',max_bonus:'Максимум бонусных шансов',min_participants:'Минимум участников'};
function localDate(epoch) {
  if (!epoch) return '';
  const d=new Date(epoch*1000);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function Stamp({label,value,onChange}) {
  return <Input label={label} type="datetime-local" value={localDate(value)} onChange={e=>onChange(e.target.value?new Date(e.target.value).getTime()/1000:null)} />;
}

function Rules({initial,save,busy}) {
  const [rules,set]=useState(initial);
  const [channels,setChannels]=useState(initial.channels.join(', '));
  const [tariffs,setTariffs]=useState(initial.tariff_ids.join(', '));
  const change=(key,value)=>set(r=>({...r,[key]:value}));
  const parts=text=>text.trim().split(/[\s,]+/).filter(Boolean);
  return <details><summary>Условия и дополнительные шансы</summary><div className="stack">
    <Input label="Обязательные каналы через запятую" value={channels} onChange={e=>setChannels(e.target.value)} />
    <Toggle label="Исключить администраторов" checked={rules.exclude_admins} onChange={v=>change('exclude_admins',v)}/>
    <Toggle label="Нужна активная подписка" checked={rules.active_subscription} onChange={v=>change('active_subscription',v)} />
    <Select label="Проверка подписки" value={rules.subscription_mode} onChange={e=>change('subscription_mode',e.target.value)}
      options={[{value:'current',label:'Текущая'},{value:'created_before',label:'Оформлена до даты'},{value:'continuous',label:'Непрерывна с даты'}]} />
    {rules.subscription_mode!=='current' && <Stamp label="Дата проверки подписки" value={rules.subscription_date} onChange={v=>change('subscription_date',v)} />}
    <Input label="ID допустимых тарифов через запятую" value={tariffs} onChange={e=>setTariffs(e.target.value)} />
    {['registered_after','registered_before'].map((k,i)=><Stamp key={k} label={i?'Регистрация до':'Регистрация с'} value={rules[k]} onChange={v=>change(k,v)} />)}
    {Object.entries(numbers).map(([k,label])=><Input key={k} type="number" min={k==='min_participants'?1:0} label={label} value={rules[k]} onChange={e=>change(k,Number(e.target.value))}/>)}
    <Button disabled={busy} onClick={()=>save('rules',{...rules,subscription_date:rules.subscription_mode==='current'?null:rules.subscription_date,
      channels:parts(channels),tariff_ids:parts(tariffs).map(Number)})}>Сохранить условия</Button>
  </div></details>;
}

function Prizes({game,save,busy}) {
  const [rows,setRows]=useState(game.prizes);
  const change=(i,patch)=>setRows(rows.map((p,n)=>n===i?{...p,...patch}:p));
  return <details><summary>Призы · {rows.length}</summary><div className="stack">
    {rows.map((p,i)=><fieldset key={i} className="stack"><legend>Приз {i+1}</legend>
      <Input label="Название приза" maxLength={160} value={p.title} onChange={e=>change(i,{title:e.target.value})}/>
      <Select label="Тип приза" value={p.type} options={Object.entries(types).map(([value,label])=>({value,label}))}
        onChange={e=>change(i,{type:e.target.value,value:e.target.value==='manual'?0:1,tariff_snapshot:undefined})}/>
      <Input label="Количество победителей" type="number" min={1} value={p.quantity} onChange={e=>change(i,{quantity:Number(e.target.value)})}/>
      {p.type==='subscription'?<Select label="Подарочный тариф" value={p.value} options={[{value:'',label:'Выберите тариф'},...game.tariffs.map(t=>({value:t.id,label:t.name}))]}
        onChange={e=>change(i,{value:Number(e.target.value),tariff_snapshot:undefined})}/>:p.type!=='manual'&&<Input label={{balance:'Сумма, ₽',days:'Дней',percent:'Скидка, %'}[p.type]} type="number" min={1} value={p.value} onChange={e=>change(i,{value:Number(e.target.value)})}/>}
      <Button variant="ghost" onClick={()=>setRows(rows.filter((_,n)=>i!==n))}>Убрать приз</Button>
    </fieldset>)}
    <Button variant="secondary" disabled={rows.length>=10} onClick={()=>setRows([...rows,{type:'manual',title:'',value:0,quantity:1}])}>Добавить приз</Button>
    <Button disabled={busy} onClick={()=>save('prizes',rows)}>Сохранить призы</Button>
  </div></details>;
}

function FieldEditor({name,game,save,busy}) {
  const [value,set]=useState(game[name]);
  return <div className="stack">{name==='deadline'?<Stamp label={textFields[name]} value={value} onChange={set}/>:name==='description'?
    <label className="field">Описание<textarea value={value} maxLength={1200} onChange={e=>set(e.target.value)} /></label>:
    <Input label={textFields[name]} value={value} onChange={e=>set(e.target.value)} />}
    {value!==game[name] && <Button size="sm" disabled={busy} onClick={()=>save(name,value)}>Сохранить поле</Button>}</div>;
}

function Editor({id}) {
  const path=giveaways+'/admin/'+encodeURIComponent(id);
  const state=useLoad(signal=>api.get(path,null,{signal}),[path]);
  const [busy,setBusy]=useState(false);
  const [number,setNumber]=useState('');
  const [deadline,setDeadline]=useState(null);
  const toast=useToast(), confirm=useConfirm(),navigate=useNavigate();
  async function perform(call,hide=false) {
    setBusy(true);
    try { await call(); toast('Готово'); if(hide)navigate('/admin/giveaways'); else await state.reload(true); }
    catch(e){toast.error(e); if(e.status===409) await state.reload(true);}
    finally{setBusy(false);}
  }
  return <Loadable state={state}>{g=>{
    const editable=g.state==='draft'||(g.state==='active'&&g.deadline>Date.now()/1000);
    const save=(field,value)=>perform(()=>api.patch(path,{field,value,version:g.version}));
    async function action(action,label,number=0) {
      if(!await confirm({title:label+'?',text:action==='retry'?'При неизвестном статусе клиент мог уже получить сообщение. Проверьте доставку.':
        action==='reset'?'Сначала убедитесь, что пост не появился в канале.':g.title,confirmText:label}))return;
      await perform(()=>api.post(path+'/action',{action,number,version:g.version}),action==='hide');
    }
    const command=(a,label,n=0,disabled=false)=><Button disabled={busy||disabled} variant="secondary" onClick={()=>action(a,label,n)}>{label}</Button>;
    return <div className="stack">
      <PageHead back="/admin/giveaways" title={g.title||'Черновик розыгрыша'} subtitle={states[g.state]+' · Участников: '+g.total} actions={<Button variant="secondary" disabled={busy} onClick={()=>state.reload(true)}>Обновить</Button>}/>
      {editable && <Card title="Настройки"><div className="stack">
        {Object.keys(textFields).filter(k=>k!=='channel'||g.state==='draft').map(k=><FieldEditor key={k+String(g[k])} name={k} game={g} save={save} busy={busy}/>)}
        <Rules key={JSON.stringify(g.rules)} initial={g.rules} save={save} busy={busy}/><Prizes key={JSON.stringify(g.prizes)} game={g} save={save} busy={busy}/>
      </div></Card>}
      <Card title="Публикация"><div className="stack">
        {!['draft','publishing'].includes(g.state) && <CopyField label="Ссылка на розыгрыш в кабинете" value={window.location.origin+'/cabinet/giveaways/'+g.id} />}
        <details><summary>Предпросмотр текста поста</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{g.preview}</p></details>
        {g.state==='draft' && command('publish','Опубликовать в канале')}
        {g.state==='publishing' && <><Input type="number" label="Номер уже опубликованного поста" value={number} onChange={e=>setNumber(e.target.value)}/>{command('recover','Привязать пост',Number(number),!(Number(number)>0))}{command('reset','Вернуть в черновики')}</>}
        {g.state==='insufficient' && <><Stamp label="Новый срок" value={deadline} onChange={setDeadline}/>{command('extend','Продлить приём заявок',deadline,!deadline)}</>}
        {['draft','active','checking','insufficient'].includes(g.state)&&command('cancel','Отменить розыгрыш')}
        {['draft','finished','cancelled'].includes(g.state)&&command('hide','Скрыть из списка')}
      </div></Card>
      <Card title="Участники и итоги"><div className="stack">
        <Button variant="secondary" href={'/api'+path+'/entries.csv'} download>Скачать участников в CSV</Button>
        {g.winners.map(w=><div key={w.rank}><strong>{w.rank} место · {w.prize.title}</strong> · {w.tg}
          {w.prize.type==='manual' && (w.manual_delivered?' · Выдан':command('delivered','Отметить выдачу',w.rank))}</div>)}
        <details><summary>Доставка · {g.deliveries.length}</summary>{g.deliveries.map(d=><p key={d.id}>№{d.id} · {d.recipient} · {d.state}
          {['failed','unknown','blocked'].includes(d.state)&&command('retry','Повторить доставку',d.id)}</p>)}</details>
        <details><summary>Журнал действий</summary>{g.audit.map((a,i)=><p key={i}>{dateTime(a.at)} · {a.action} · {a.actor} {a.detail}</p>)}</details>
      </div></Card>
    </div>;
  }}</Loadable>;
}

export default function GiveawaysAdmin() {
  const {gid}=useParams(), navigate=useNavigate(), toast=useToast();
  const cfg=useGiveawayConfig();
  const [busy,setBusy]=useState(false);
  const [pendingVisibility,setPendingVisibility]=useState(null);
  async function update(make,enabled) {
    if (!make) setPendingVisibility(enabled);
    setBusy(true);
    try{
      if(make){const g=await api.post(giveaways+'/admin',{});navigate('/admin/giveaways/'+g.id);}
      else {await api.put(giveaways+'/config',{enabled});window.dispatchEvent(new CustomEvent('giveaway-config',{detail:{enabled}}));}
    }catch(e){toast.error(e);}finally{setPendingVisibility(null);setBusy(false);}
  }
  if(gid)return <Editor key={gid} id={gid}/>;
  return <div className="stack"><PageHead title="Розыгрыши" actions={cfg?.manage&&<Button disabled={busy} onClick={()=>update(true)}>Создать розыгрыш</Button>}/>
    {cfg?.manage&&<Card><Toggle label="Показывать розыгрыши в профиле бота и меню кабинета" checked={pendingVisibility ?? cfg.enabled} disabled={busy} onChange={v=>update(false,v)}/></Card>}
    <GameList admin/></div>;
}
