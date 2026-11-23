"""Staff-only presence, full-history search and optimistic reply protection."""
import json
import time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.depends import get_session, verify_identity_agent


class Presence(BaseModel):
    session_id: UUID
    typing: bool = False


class Reply(BaseModel):
    body: str = Field('',max_length=4000)
    attachments: list[str] | None = Field(None,max_length=10)
    internal: bool = False
    expected_agent_message_id: UUID | None = None


def visible_staff(records, viewer, now):
    people={}
    for record in records:
        if not record or record.get('identity_id')==str(viewer) or now-record.get('seen',0)>45:continue
        key=record['identity_id'];typing=now-record.get('typing_at',0)<8
        existing=people.get(key)
        people[key]={'id':key,'name':record.get('name') or 'Сотрудник','typing':typing or bool(existing and existing['typing'])}
    return list(people.values())


def literal_search(value):return '%'+value.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'


async def require_ticket(session,ticket_id):
    from services.tickets import get_ticket
    ticket=await get_ticket(session,str(ticket_id))
    if ticket is None:raise HTTPException(404,'Обращение не найдено')
    return ticket


def get_router():
    router=APIRouter(prefix='/api/portal/support/tickets',tags=['Portal support workspace'])

    @router.get('/{ticket_id}/related')
    async def related(ticket_id: UUID, identity=Depends(verify_identity_agent),
                      session: AsyncSession = Depends(get_session),
                      limit: int = Query(5, ge=1, le=30), offset: int = Query(0, ge=0, le=100000)):
        from database.models.tickets import Ticket
        current = await require_ticket(session, ticket_id)
        scope = (Ticket.identity_id == current.identity_id, Ticket.id != current.id)
        total = await session.scalar(select(func.count()).select_from(Ticket).where(*scope))
        rows = await session.execute(
            select(Ticket.id, Ticket.subject, Ticket.status, Ticket.created_at).where(*scope)
            .order_by(Ticket.created_at.desc(), Ticket.id.desc()).offset(offset).limit(limit)
        )
        return {"total": total, "items": [dict(row) for row in rows.mappings()]}

    @router.post('/{ticket_id}/presence')
    async def presence(body:Presence,ticket_id:UUID,identity=Depends(verify_identity_agent),session:AsyncSession=Depends(get_session)):
        from core.redis_cache import _get_redis
        await require_ticket(session,ticket_id)
        redis=await _get_redis()
        if redis is None:raise HTTPException(503,'Присутствие сотрудников временно недоступно')
        now=time.time();index=f'portal:support:presence:{ticket_id}'
        key=f'{index}:{identity.id}:{body.session_id}'
        name=getattr(identity,'display_name',None) or getattr(identity,'username',None) or (f'TG {identity.tg_id}' if getattr(identity,'tg_id',None) else 'Сотрудник')
        await redis.set(key,json.dumps({'identity_id':str(identity.id),'name':name,'seen':now,'typing_at':now if body.typing else 0}),ex=45)
        await redis.zadd(index,{key:now});await redis.expire(index,90)
        await redis.zremrangebyscore(index,'-inf',now-45)
        keys=await redis.zrangebyscore(index,now-45,'+inf')
        records=[json.loads(value) for value in await redis.mget(keys) if value] if keys else []
        return {'others':visible_staff(records,identity.id,now)}

    @router.delete('/{ticket_id}/presence/{session_id}')
    async def leave(ticket_id:UUID,session_id:UUID,identity=Depends(verify_identity_agent),session:AsyncSession=Depends(get_session)):
        from core.redis_cache import _get_redis
        redis=await _get_redis()
        if redis is not None:
            index=f'portal:support:presence:{ticket_id}';key=f'{index}:{identity.id}:{session_id}'
            await redis.delete(key);await redis.zrem(index,key)
        return {'ok':True}

    @router.get('/{ticket_id}/search')
    async def search(ticket_id:UUID,q:str=Query(min_length=2,max_length=200),limit:int=Query(30,ge=1,le=100),offset:int=Query(0,ge=0,le=100000),identity=Depends(verify_identity_agent),session:AsyncSession=Depends(get_session)):
        from database.models import TicketMessage
        await require_ticket(session,ticket_id)
        query=q.strip()
        if len(query)<2:return {'items':[],'total':0}
        filters=[TicketMessage.ticket_id==str(ticket_id),TicketMessage.deleted_at.is_(None),TicketMessage.body.ilike(literal_search(query),escape='\\')]
        total=await session.scalar(select(func.count()).select_from(TicketMessage).where(*filters))
        rows=(await session.scalars(select(TicketMessage).where(*filters).order_by(TicketMessage.created_at,TicketMessage.id).limit(limit).offset(offset))).all()
        return {'items':[{'id':r.id,'author':r.author,'body':r.body,'created_at':r.created_at.isoformat()} for r in rows],'total':int(total or 0)}

    @router.post('/{ticket_id}/reply')
    async def reply(body:Reply,ticket_id:UUID,identity=Depends(verify_identity_agent),session:AsyncSession=Depends(get_session)):
        from database.models import Ticket,TicketMessage
        from api.v2.routes.tickets import agent_reply,MessageBody
        ticket=await session.scalar(select(Ticket).where(Ticket.id==str(ticket_id)).with_for_update())
        if ticket is None:raise HTTPException(404,'Обращение не найдено')
        if not body.internal:
            latest=await session.scalar(select(TicketMessage.id).where(TicketMessage.ticket_id==ticket.id,TicketMessage.author=='agent',TicketMessage.deleted_at.is_(None)).order_by(TicketMessage.created_at.desc(),TicketMessage.id.desc()).limit(1))
            expected=str(body.expected_agent_message_id) if body.expected_agent_message_id else None
            if latest!=expected:raise HTTPException(409,'Коллега уже ответил. Переписка обновлена — проверьте ответ перед повторной отправкой')
        return await agent_reply(payload=MessageBody(body=body.body,attachments=body.attachments,internal=body.internal),ticket_id=ticket.id,identity=identity,session=session)

    return router
