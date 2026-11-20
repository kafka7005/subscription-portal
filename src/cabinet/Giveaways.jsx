import { useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/hooks.js';
import { giveaways, states } from '../lib/giveaways.js';
import { dateTime } from '../lib/format.js';
import { Button, Card, CopyField, Empty, KeyValue, Loadable, PageHead, useToast } from '../ui/index.jsx';

export function GameList({ admin=false }) {
  const [page,setPage]=useState(0);
  const state=useLoad(signal=>api.get(giveaways+(admin?'/admin':''),{page},{signal}),[admin,page]);
  return <Card title={admin?'Все розыгрыши':'Доступные розыгрыши'}><Loadable state={state}>{data=><div className="stack">
    {data.items?.length ? data.items.map(g=><Button key={g.id} variant="secondary" to={`/${admin?'admin':'cabinet'}/giveaways/${g.id}`}>
      {g.title || 'Новый розыгрыш'} · {states[g.state] || g.state}</Button>) : <Empty icon="gift" title="Розыгрышей пока нет" />}
    {(page>0 || data.more) && <div className="row"><Button variant="secondary" disabled={!page || state.loading} onClick={()=>setPage(page-1)}>Назад</Button>
      <Button variant="secondary" disabled={!data.more || state.loading} onClick={()=>setPage(page+1)}>Дальше</Button></div>}
  </div>}</Loadable></Card>;
}

function Detail({ id }) {
  const url=giveaways+'/game/'+encodeURIComponent(id);
  const state=useLoad(signal=>api.get(url,null,{signal}),[url]);
  const toast=useToast();
  const [busy,setBusy]=useState(false);
  async function join() {
    setBusy(true);
    try { await api.post(url+'/join',{}); await state.reload(true); }
    catch(e){toast.error(e);} finally {setBusy(false);}
  }
  return <Loadable state={state}>{g=><div className="stack">
    <PageHead back="/cabinet/giveaways" title={g.title} subtitle={states[g.state]} />
    <Card title="Призы"><p style={{whiteSpace:'pre-line'}}>{g.description}</p><ul>{g.prizes.map((p,i)=><li key={i}>{p.title} × {p.quantity}</li>)}</ul></Card>
    <Card title="Условия участия"><div className="stack"><p style={{whiteSpace:'pre-line'}}>{g.conditions}</p>
      {g.channels.filter(c=>/^https:\/\/t\.me\//i.test(c.url || '')).map(c=><Button key={c.name} variant="secondary" href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</Button>)}
      <KeyValue items={[[ 'До', dateTime(g.deadline)], ['Приглашено',g.invites],['Шансов',g.tickets]]} />
      {g.joined && <strong>{g.admitted?'Условия выполнены':g.reason || 'Осталось пригласить участников: '+Math.max(0,g.required-g.invites)}</strong>}
      {g.can_join && (g.linked ? <Button busy={busy} disabled={busy} onClick={join}>{g.joined?'Проверить ещё раз':'Проверить и участвовать'}</Button>
        : <Button to="/cabinet/profile">Привязать Telegram</Button>)}
      {g.invite_url && <CopyField label="Ссылка для приглашений" value={g.invite_url} />}
      <Button variant="secondary" href={g.bot_url} target="_blank" rel="noopener noreferrer">Открыть в боте</Button>
      <Button variant="ghost" onClick={()=>state.reload(true)}>Обновить</Button>
    </div></Card>
    {g.state==='finished' && <Card title="Ваш результат">{g.win?<div className="stack"><strong>{g.win.rank} место · {g.win.title}</strong>
      {g.win.url ? <Button href={g.win.url} target="_blank" rel="noopener noreferrer">Забрать приз</Button> : <span>{g.win.delivered?'Приз выдан':'Приз выдаст организатор'}</span>}</div>:<p>У вас нет выигрыша в этом розыгрыше.</p>}</Card>}
    <details><summary>Проверка жеребьёвки</summary><div style={{overflowWrap:'anywhere'}}><KeyValue items={[[ 'Хеш до розыгрыша',g.commitment],g.seed && ['Секрет после итогов',g.seed],g.roster_hash && ['Хеш списка',g.roster_hash]]}/></div></details>
  </div>}</Loadable>;
}

export default function Giveaways() {
  const {gid}=useParams();
  const {giveawaysVisible}=useOutletContext();
  return gid ? <Detail key={gid} id={gid}/> : <><PageHead title="Розыгрыши" />{giveawaysVisible ? <GameList /> : <Card><p>Список розыгрышей сейчас недоступен.</p></Card>}</>;
}
