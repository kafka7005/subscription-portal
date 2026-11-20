import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { giveaways, states, useGiveawayConfig } from '../lib/giveaways.js';
import { useLoad } from '../lib/hooks.js';
import { dateTime } from '../lib/format.js';
import { Badge, Button, Card, Empty, Icon, Textarea, CopyField, Input, Loadable, PageHead, Select, Toggle, useConfirm, useToast } from '../ui/index.jsx';
import './giveaway-admin.css';

const sections = [
  {key:'main', label:'Основное', icon:'settings'},
  {key:'rules', label:'Условия участия', icon:'users'},
  {key:'prizes', label:'Призы', icon:'gift'},
  {key:'post', label:'Публикация', icon:'send'},
  {key:'results', label:'Участники и итоги', icon:'chart'},
];

function Status({state}) {
  const tone = {active:'ok', finished:'ok', insufficient:'warn', publishing:'warn'}[state] || 'muted';
  return <Badge tone={tone}>{states[state] || state}</Badge>;
}

function AdminGameList() {
  const [page,setPage]=useState(0);
  const state=useLoad(signal=>api.get(giveaways+'/admin',{page},{signal}),[page]);
  return <Card title="Все розыгрыши"><Loadable state={state}>{data=><>
    {data.items.length ? <ul className="gw-list">{data.items.map(g=><li key={g.id}>
      <Link to={'/admin/giveaways/'+g.id}><span className="gw-list-name"><strong>{g.title||'Новый розыгрыш'}</strong>
        <small>Приём до {dateTime(g.deadline)}</small></span><Status state={g.state}/><Icon name="arrow" size={16}/></Link>
    </li>)}</ul> : <Empty icon="gift" title="Розыгрышей пока нет" text="Создайте черновик, чтобы выбрать призы и срок."/>}
    {(page>0 || data.more) && <div className="row"><Button size="sm" variant="secondary" disabled={!page || state.loading} onClick={()=>setPage(page-1)}>Назад</Button>
      <Button size="sm" variant="secondary" disabled={!data.more || state.loading} onClick={()=>setPage(page+1)}>Дальше</Button></div>}
  </>}</Loadable></Card>;
}
const types={balance:'Купон на баланс',days:'Купон на дни',percent:'Купон на скидку',subscription:'Подарочная подписка',manual:'Ручная выдача'};
const textFields={title:'Название',description:'Описание',channel:'Канал публикации',result_channel:'Канал итогов',deadline:'Приём заявок до'};
const numbers={min_invites:'Минимум приглашённых',bonus_every:'Один шанс за каждые N приглашённых',max_bonus:'Максимум бонусных шансов',min_participants:'Минимум участников'};
const deliveryStates={pending:'В очереди',sending:'Отправляется',sent:'Доставлено',delivered:'Доставлено',failed:'Ошибка доставки',unknown:'Доставка не подтверждена',blocked:'Получатель заблокировал бота'};
const auditLabels={created:'Создан черновик',edited:'Изменены настройки',published:'Опубликован пост',cancelled:'Розыгрыш отменён',extended:'Продлён срок',retry_delivery:'Запрошена повторная доставка',manual_delivered:'Отмечена выдача приза',hidden:'Розыгрыш скрыт',publication_reset:'Возвращён в черновики'};

function useDirty(mark,key,dirty) {
  useEffect(()=>{
    mark(key,dirty);
    return ()=>mark(key,false);
  },[mark,key,dirty]);
}
function localDate(epoch) {
  if (!epoch) return '';
  const d=new Date(epoch*1000);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function Stamp({label,value,onChange}) {
  return <Input label={label} type="datetime-local" value={localDate(value)} onChange={e=>onChange(e.target.value?new Date(e.target.value).getTime()/1000:null)} />;
}

function Rules({initial,save,busy,mark}) {
  const [rules,set]=useState(initial);
  const [channels,setChannels]=useState(initial.channels.join(', '));
  const [tariffs,setTariffs]=useState(initial.tariff_ids.join(', '));
  const change=(key,value)=>set(r=>({...r,[key]:value}));
  const parts=text=>text.trim().split(/[\s,]+/).filter(Boolean);
  const values={...rules,subscription_date:rules.subscription_mode==='current'?null:rules.subscription_date,
    channels:parts(channels),tariff_ids:parts(tariffs).map(Number)};
  const rulesChanged=JSON.stringify({...rules,channels:values.channels,tariff_ids:values.tariff_ids})!==JSON.stringify(initial);
  useDirty(mark,"rules",rulesChanged);
  return <div className="gw-form">
    <section><h3>Допуск участников</h3>
      <Toggle label="Исключить администраторов" checked={rules.exclude_admins} onChange={v=>change('exclude_admins',v)}/>
      <Toggle label="Требовать активную подписку" checked={rules.active_subscription} onChange={v=>change('active_subscription',v)} />
      <Input label="Обязательные каналы" hint="Укажите каналы через запятую" value={channels} onChange={e=>setChannels(e.target.value)} />
    </section>
    <details className="gw-fold"><summary>Тарифы и даты регистрации</summary><div className="gw-fields">
      <Select label="Проверка подписки" value={rules.subscription_mode} onChange={e=>change('subscription_mode',e.target.value)}
        options={[{value:'current',label:'На момент проверки'},{value:'created_before',label:'Оформлена до даты'},{value:'continuous',label:'Непрерывна с даты'}]} />
      {rules.subscription_mode!=='current' && <Stamp label="Дата проверки подписки" value={rules.subscription_date} onChange={v=>change('subscription_date',v)} />}
      <Input label="ID допустимых тарифов" hint="Через запятую. Пустое поле разрешает любой тариф." value={tariffs} onChange={e=>setTariffs(e.target.value)} />
      {['registered_after','registered_before'].map((k,i)=><Stamp key={k} label={i?'Регистрация до':'Регистрация с'} value={rules[k]} onChange={v=>change(k,v)} />)}
    </div></details>
    <section><h3>Приглашения и жеребьёвка</h3><div className="gw-fields">
      {Object.entries(numbers).map(([k,label])=><Input key={k} type="number" min={k==='min_participants'?1:0} label={label} value={rules[k]} onChange={e=>change(k,Number(e.target.value))}/>)}
    </div></section>
    <Button disabled={busy} onClick={()=>save('rules',values)}>Сохранить условия</Button>
  </div>;
}

function Prizes({game,save,busy,mark}) {
  const [rows,setRows]=useState(game.prizes);
  const change=(i,patch)=>setRows(rows.map((p,n)=>n===i?{...p,...patch}:p));
  useDirty(mark,"prizes",JSON.stringify(rows)!==JSON.stringify(game.prizes));
  return <div className="gw-form">
    {!rows.length && <p className="muted">Добавьте первый приз и укажите, сколько победителей его получат.</p>}
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
  </div>;
}

function FieldEditor({name,game,save,busy,mark}) {
  const [value,set]=useState(game[name]);
  useDirty(mark,name,value!==game[name]);
  return <div className="stack">{name==='deadline'?<Stamp label={textFields[name]} value={value} onChange={set}/>:name==='description'?
    <Textarea label="Описание" rows={4} value={value} maxLength={1200} onChange={e=>set(e.target.value)} />:
    <Input label={textFields[name]} value={value} onChange={e=>set(e.target.value)} />}
    {value!==game[name] && <Button size="sm" disabled={busy} onClick={()=>save(name,value)} aria-label={'Сохранить: '+textFields[name]}>Сохранить</Button>}</div>;
}

function Editor({id}) {
  const path=giveaways+'/admin/'+encodeURIComponent(id);
  const state=useLoad(signal=>api.get(path,null,{signal}),[path]);
  const [busy,setBusy]=useState(false);
  const [section,setSection]=useState(null);
  const [changed,setChanged]=useState({});
  const mark=useCallback((key,dirty)=>setChanged(prev=>Boolean(prev[key])===dirty?prev:{...prev,[key]:dirty}),[]);
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
    const options=editable ? sections : sections.filter(s=>['post','results'].includes(s.key));
    const initial = g.state==='draft'?'main':['finished','checking','cancelled'].includes(g.state)?'results':'post';
    const current=options.some(s=>s.key===section)?section:initial;
    const command=(a,label,n=0,disabled=false,variant='secondary')=><Button disabled={busy||disabled} variant={variant} onClick={()=>action(a,label,n)}>{label}</Button>;
    const saveReminder=Object.values(changed).some(Boolean);
    const readiness=[
      {key:'main', label:'Название розыгрыша',ok:Boolean(g.title?.trim())},
      {key:'prizes', label:'Хотя бы один приз',ok:g.prizes.length>0},
      {key:'main', label:'До окончания больше двух минут',ok:g.deadline>Date.now()/1000+120},
      {key:'main', label:'Каналы публикации и итогов',ok:Boolean(g.channel&&g.result_channel)},
    ];
    return <div className="stack gw-admin">
      <PageHead back="/admin/giveaways" title={g.title||'Новый розыгрыш'} subtitle={<><Status state={g.state}/> <span>· Приём до {dateTime(g.deadline)}</span></>}
        actions={<Button size="sm" icon="refresh" variant="secondary" disabled={busy} onClick={()=>state.reload(true)}>Обновить</Button>}/>
      <div className="gw-workspace">
        <nav className="gw-nav" aria-label="Разделы розыгрыша">
          {options.map(s=><button key={s.key} type="button" aria-current={s.key===current?'page':undefined} onClick={()=>setSection(s.key)}>
            <Icon name={s.icon} size={17}/><span>{s.label}</span>
            {s.key==='prizes'&&<small>{g.prizes.length}</small>}{s.key==='results'&&<small>{g.total}</small>}
          </button>)}
        </nav>
        <div className="gw-mobile-nav"><Select label="Раздел розыгрыша" value={current} onChange={e=>setSection(e.target.value)}
          options={options.map(s=>({value:s.key,label:s.label}))}/></div>
        <div className="gw-content">
          {editable && <>
            <div hidden={current!=='main'}><Card title="Основное"><div className="gw-form">
              <section><h3>Текст для участников</h3>{['title','description'].map(k=><FieldEditor key={k+String(g[k])} name={k} game={g} save={save} busy={busy} mark={mark}/>)}</section>
              <section><h3>Срок и каналы</h3><div className="gw-fields">{(g.state==='draft'?['deadline','channel','result_channel']:['deadline','result_channel']).map(k=><FieldEditor key={k+String(g[k])} name={k} game={g} save={save} busy={busy} mark={mark}/>)}</div></section>
            </div></Card></div>
            <div hidden={current!=='rules'}><Card title="Условия участия"><Rules key={JSON.stringify(g.rules)} initial={g.rules} save={save} busy={busy} mark={mark}/></Card></div>
            <div hidden={current!=='prizes'}><Card title="Призы"><Prizes key={JSON.stringify(g.prizes)} game={g} save={save} busy={busy} mark={mark}/></Card></div>
          </>}
          {current==='post' && <Card title="Публикация"><div className="gw-form">
            {g.state==='draft' && <section><h3>Перед публикацией</h3><ul className="gw-checks">{readiness.map(r=><li key={r.label}>
              <Icon name={r.ok?'check':'clock'} size={16}/>{r.ok?r.label:<button type="button" onClick={()=>setSection(r.key)}>{r.label} · заполнить</button>}
            </li>)}</ul></section>}
            {!['draft','publishing'].includes(g.state) && <CopyField label="Ссылка для участников" value={window.location.origin+'/cabinet/giveaways/'+g.id} />}
            <section><h3>Предпросмотр поста</h3><span className="field-hint">{g.channel} · сохранённая версия</span><div className="gw-preview">{g.preview}</div></section>
            {g.state==='draft' && <>{saveReminder && <p role="status">Сохраните изменения в редакторе перед публикацией.</p>}
              {command('publish','Опубликовать в канале',0,saveReminder||readiness.some(r=>!r.ok),'primary')}</>}
            {g.state==='publishing' && <section><h3>Восстановление публикации</h3><Input type="number" label="Номер уже опубликованного поста" value={number} onChange={e=>setNumber(e.target.value)}/>
              {command('recover','Привязать пост',Number(number),!(Number(number)>0))}{command('reset','Вернуть в черновики')}</section>}
            {g.state==='insufficient' && <section><h3>Продление приёма заявок</h3><Stamp label="Новый срок" value={deadline} onChange={setDeadline}/>{command('extend','Продлить приём заявок',deadline,!deadline)}</section>}
            {['draft','active','checking','insufficient','finished','cancelled'].includes(g.state)&&<details className="gw-fold"><summary>Другие действия</summary><div className="row">
              {['draft','active','checking','insufficient'].includes(g.state)&&command('cancel','Отменить розыгрыш')}
              {['draft','finished','cancelled'].includes(g.state)&&command('hide','Скрыть из списка')}</div></details>}
          </div></Card>}
          {current==='results' && <Card title="Участники и итоги"><div className="gw-form">
            <div className="gw-count"><div><small>Заявок на участие</small><strong>{g.total}</strong></div><Button variant="secondary" size="sm" href={'/api'+path+'/entries.csv'} download>Скачать CSV</Button></div>
            <section><h3>Победители</h3>{g.winners.length===0 && <p className="muted">{g.state==='cancelled'?'Розыгрыш отменён.':'Список появится после жеребьёвки.'}</p>}
              {g.winners.map(w=><div className="gw-entry" key={w.rank}><div><strong>{w.rank} место · {w.prize.title}</strong><small>Telegram ID {w.tg}</small></div>
                {w.prize.type==='manual' && (w.manual_delivered?<Badge tone="ok">Выдан</Badge>:command('delivered','Отметить выдачу',w.rank))}</div>)}</section>
            <details className="gw-fold"><summary>Доставка сообщений · {g.deliveries.length}</summary>
              {!g.deliveries.length && <p className="muted">Отправок пока нет.</p>}
              {g.deliveries.map(d=><div className="gw-entry" key={d.id}><div><strong>{deliveryStates[d.state]||d.state}</strong><small>Получатель {d.recipient} · №{d.id}</small></div>
                {['failed','unknown','blocked'].includes(d.state)&&command('retry','Повторить доставку',d.id)}</div>)}</details>
            <details className="gw-fold"><summary>Журнал действий</summary>
              {!g.audit.length && <p className="muted">Записей пока нет.</p>}
              {g.audit.map((a,i)=><div className="gw-entry" key={i}><div><strong>{auditLabels[a.action]||a.action}</strong><small>{dateTime(a.at)} · {a.actor} {a.detail}</small></div></div>)}</details>
          </div></Card>}
        </div>
      </div>
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
  return <div className="stack gw-admin"><PageHead title="Розыгрыши" actions={cfg?.manage&&<Button disabled={busy} onClick={()=>update(true)}>Создать черновик</Button>}/>
    <AdminGameList />
    {cfg?.manage&&<Card title="Видимость для участников"><Toggle label="Показывать розыгрыши в профиле бота и меню кабинета" checked={pendingVisibility ?? cfg.enabled} disabled={busy} onChange={v=>update(false,v)}/></Card>}
    </div>;
}
