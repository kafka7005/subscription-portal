"""Opt-in staff web/push reminders; no customer messages or native file changes."""
import asyncio
import json
from hashlib import sha256
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.depends import get_session, verify_identity_admin

KEY='PORTAL_SUPPORT_REMINDERS'
_task=None


class Config(BaseModel):
    enabled: bool = False
    wait_minutes: int = Field(30,ge=5,le=10080)
    repeat_minutes: int = Field(120,ge=15,le=10080)


def waiting_query(Ticket,Message,cutoff):
    def latest(author):return select(func.max(Message.created_at)).where(Message.ticket_id==Ticket.id,Message.author==author,Message.deleted_at.is_(None)).correlate(Ticket).scalar_subquery()
    client=latest('client');agent=latest('agent')
    return select(Ticket,client.label('waiting_since')).where(Ticket.status.in_(['open','pending']),client.is_not(None),client<=cutoff,or_(agent.is_(None),client>agent)).order_by(client).limit(200)


async def deliver_reminder(make_session, uid, ticket_id, message_id, minutes, interval):
    from database.models import WebNotification
    from database.web_notifications import notify_web
    from database.access.resolution import UserId
    from sqlalchemy import text
    from logger import logger

    reference = sha256(f'{ticket_id}:{message_id}:{uid}'.encode()).hexdigest()
    async with make_session() as session:
        lock = await session.scalar(text("SELECT pg_try_advisory_xact_lock(hashtextextended(:ref, 0))"), {'ref': reference})
        if not lock:
            return
        since = datetime.now(UTC) - timedelta(minutes=interval)
        prior = await session.scalar(select(WebNotification.id).where(
            WebNotification.user_id == int(uid), WebNotification.created_at >= since,
            WebNotification.data['reminder_ref'].astext == reference).limit(1))
        if prior is not None:
            return
        notification = await notify_web(session, user_ref=UserId(uid), type='system',
            title='Обращение ждёт ответа', message=f'Обращение #{ticket_id[:8]} ожидает ответа {minutes} мин.',
            data={'href':f'/admin/tickets/{ticket_id}', 'reminder_ref':reference})
        if notification is None:
            logger.warning('[Site:Support] reminder skipped')
            return
        await session.commit()
        logger.info('[Site:Support] reminder created')


async def scan_once():
    from core.settings.modes_config import MODES_CONFIG
    if not MODES_CONFIG.get('SUPPORT_TICKETS_ENABLED',False):return
    from database import async_session_maker
    from database.settings import get_setting
    from database.models import Ticket,TicketMessage,Identity,User,Admin
    from core.redis_cache import _get_redis
    async with async_session_maker() as session:
        cfg=Config(**(await get_setting(session,KEY,{}) or {}))
        if not cfg.enabled:return
        redis=await _get_redis()
        if redis is None:return
        if not await redis.set('portal:support:reminders:scan','1',nx=True,ex=55):return
        cutoff=datetime.now(UTC)-timedelta(minutes=cfg.wait_minutes)
        offset=int(await redis.get('portal:support:reminders:offset') or 0)
        rows=(await session.execute(waiting_query(Ticket,TicketMessage,cutoff).offset(offset))).all()
        await redis.set('portal:support:reminders:offset',str(offset+200 if len(rows)==200 else 0),ex=3600)
        recipients=(await session.scalars(select(func.min(User.id)).join(Identity,User.identity_id==Identity.id).outerjoin(Admin,Admin.tg_id==Identity.tg_id).where(or_(Identity.is_admin.is_(True),Admin.role=='moderator'),or_(Admin.role.is_(None),Admin.role!='designer')).group_by(Identity.id))).all()
        for ticket,since in rows:
            # Recheck the current ticket before publishing an old waiting snapshot.
            await session.refresh(ticket)
            if ticket.status not in {'open','pending'}:continue
            last=await session.scalar(select(TicketMessage).where(TicketMessage.ticket_id==ticket.id,TicketMessage.author.in_(['client','agent']),TicketMessage.deleted_at.is_(None)).order_by(TicketMessage.created_at.desc(),TicketMessage.id.desc()).limit(1))
            if not last or last.author!='client' or last.created_at>cutoff:continue
            minutes=max(cfg.wait_minutes,int((datetime.now(UTC)-last.created_at).total_seconds()/60))
            for uid in recipients:
                try:
                    await deliver_reminder(async_session_maker, uid, ticket.id, last.id, minutes, cfg.repeat_minutes)
                except Exception as exc:
                    from logger import logger
                    logger.warning('[Site:Support] reminder failed: {}', type(exc).__name__)
        await session.commit()


async def loop():
    from logger import logger
    while True:
        try:await scan_once()
        except asyncio.CancelledError:raise
        except Exception as exc:logger.warning('[Portal:Support] Reminder scan failed: {}',type(exc).__name__)
        await asyncio.sleep(60)


async def start_worker(**kwargs):
    global _task
    if _task is None or _task.done():
        from logger import logger
        _task=asyncio.create_task(loop(),name='portal-support-reminders')
        logger.info('[Portal:Support] Reminder worker started')


async def stop_worker(**kwargs):
    global _task
    if _task:
        _task.cancel()
        with suppress(asyncio.CancelledError):await _task
        _task=None


def get_router():
    router=APIRouter(prefix='/api/portal/support',tags=['Portal support reminders'])
    @router.get('/reminders')
    async def read(identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        from database.settings import get_setting
        return Config(**(await get_setting(session,KEY,{}) or {})).model_dump()
    @router.put('/reminders')
    async def save(body:Config,identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        from database.settings import set_setting
        from audit import safe_record_audit_event
        await set_setting(session,KEY,body.model_dump(),'Напоминания сотрудникам поддержки Portal')
        await safe_record_audit_event(session,event_type='admin_support_reminders_updated',channel='api',path_or_handler='admin:support-reminders',actor_identity_id=identity.id,actor_tg_id=getattr(identity,'tg_id',None),entity_type='support_settings',entity_id='reminders',metadata=body.model_dump())
        return body.model_dump()
    return router
