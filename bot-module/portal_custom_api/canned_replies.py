"""Shared quick-insert templates; never sends customer messages."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from api.depends import get_session, verify_identity_admin, verify_identity_agent

SETTING_KEY='PORTAL_CANNED_REPLIES'


class Reply(BaseModel):
    title:str=Field(min_length=1,max_length=80)
    body:str=Field(min_length=1,max_length=2000)

    @field_validator('title','body')
    @classmethod
    def nonempty(cls,value):
        value=value.strip()
        if not value:raise ValueError('Название и текст не могут быть пустыми')
        return value


class Replies(BaseModel):
    items:list[Reply]=Field(max_length=50)

    @field_validator('items')
    @classmethod
    def unique_titles(cls,items):
        titles=[item.title.casefold() for item in items]
        if len(titles)!=len(set(titles)):raise ValueError('Названия шаблонов должны отличаться')
        return items


def get_router():
    router=APIRouter(prefix='/api/portal',tags=['Portal quick replies'])

    @router.get('/canned-replies')
    async def read(identity=Depends(verify_identity_agent),session:AsyncSession=Depends(get_session)):
        from database.settings import get_setting
        raw=await get_setting(session,SETTING_KEY)
        if raw is None:
            from api.v2.routes.tickets import agent_canned_replies
            return await agent_canned_replies(identity=identity)
        return Replies(items=raw).model_dump()

    @router.put('/canned-replies')
    async def save(body:Replies,identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        from database.settings import set_setting
        from audit import safe_record_audit_event
        items=body.model_dump()['items']
        await set_setting(session,SETTING_KEY,items,'Быстрые ответы поддержки Portal')
        await safe_record_audit_event(session,event_type='admin_canned_replies_updated',channel='api',
            path_or_handler='admin:canned-replies',actor_identity_id=identity.id,
            actor_tg_id=getattr(identity,'tg_id',None),entity_type='support_templates',
            entity_id='shared',metadata={'count':len(items)})
        return {'items':items}

    return router
