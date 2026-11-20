"""Web adapter for the optional giveaways module. Draws and payouts stay in the bot."""
import csv
import io
import re
import time
from html.parser import HTMLParser
from importlib.util import find_spec
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, StrictBool
from api.depends import get_session, verify_identity_admin, verify_identity_token


class Visibility(BaseModel):
    enabled: StrictBool


class Edit(BaseModel):
    field: Literal['title', 'description', 'channel', 'result_channel', 'deadline', 'prizes', 'rules']
    value: str | int | float | list[dict] | dict
    version: int = Field(ge=0)


class Action(BaseModel):
    action: Literal['publish', 'cancel', 'hide', 'reset', 'recover', 'extend', 'retry', 'delivered']
    version: int = Field(ge=0)
    number: int = Field(default=0, ge=0, le=10**12)


def available():
    from utils.modules_manager import manager
    if not manager.is_enabled('giveaways') or find_spec('modules.giveaways') is None:
        return False
    from modules.giveaways import storage
    return callable(getattr(storage, 'profile_button_enabled', None))


def require_module():
    if not available():
        raise HTTPException(404, 'Модуль розыгрышей выключен')


async def superuser(identity):
    from filters.admin import IsSuperAdminFilter
    return bool(identity.tg_id and await IsSuperAdminFilter()(SimpleNamespace(from_user=SimpleNamespace(id=identity.tg_id))))


async def staff(identity=Depends(verify_identity_admin)):
    require_module()
    if not await superuser(identity):
        raise HTTPException(403, 'Требуются права суперадминистратора бота')
    return identity.tg_id


class Plain(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ('br', 'p', 'details'):
            self.parts.append('\n')


def plain(markup):
    parser = Plain()
    parser.feed(markup)
    return ''.join(parser.parts).strip()


def pick(row, keys):
    return {k: row[k] for k in keys}


async def checked(call):
    from modules.giveaways.eligibility import CheckUnavailable
    from modules.giveaways.public import error
    from aiogram.exceptions import TelegramAPIError
    try:
        return await call
    except CheckUnavailable:
        raise HTTPException(503, 'Проверка условий временно недоступна')
    except (TelegramAPIError, TimeoutError):
        raise HTTPException(503, 'Telegram временно недоступен. Обновите состояние розыгрыша.')
    except ValueError as exc:
        raise HTTPException(409, plain(error(exc)))


async def game(gid):
    from modules.giveaways import storage
    data = await storage.get(gid)
    if not data:
        raise HTTPException(404, 'Розыгрыш не найден')
    return data


def get_router(prefix):
    async def guard(request: Request, response: Response):
        response.headers['Cache-Control']='private, no-store'
        response.headers['Vary']='Cookie, Authorization'
        if request.method not in ('GET', 'HEAD') and request.headers.get('content-type','').split(';')[0] != 'application/json':
            raise HTTPException(415, 'Требуется JSON')
    router = APIRouter(prefix=prefix+'/giveaways', dependencies=[Depends(guard)])

    @router.get('/config')
    async def config(identity=Depends(verify_identity_token), session=Depends(get_session)):
        if not available():
            return {'enabled': False, 'manage': False}
        from modules.giveaways import storage
        return {'enabled': await storage.profile_button_enabled(session), 'manage': await superuser(identity)}

    @router.put('/config')
    async def visibility(body: Visibility, actor=Depends(staff)):
        from modules.giveaways import storage
        await storage.set_profile_button(body.enabled)
        return {'enabled': body.enabled}

    @router.get('')
    async def listing(page: int = Query(0, ge=0, le=99999), identity=Depends(verify_identity_token), session=Depends(get_session)):
        require_module()
        from modules.giveaways import storage
        if not await storage.profile_button_enabled(session):
            raise HTTPException(404, 'Список розыгрышей скрыт')
        rows = await storage.list_public_games(identity.tg_id, page)
        return {'items': [dict(r) for r in rows[:10]], 'more': len(rows)>10}

    @router.get('/game/{gid}')
    async def detail(gid: int, identity=Depends(verify_identity_token), session=Depends(get_session)):
        require_module()
        from bot import bot
        from modules.giveaways import storage, service, render
        from modules.giveaways.core import bonus_chances
        from modules.giveaways.public import error
        g = await game(gid)
        tg = identity.tg_id
        if g['state'] in ('draft','publishing'):
            raise HTTPException(404, 'Розыгрыш не найден')
        entry = await storage.entry(gid, tg) if tg else None
        if g['deleted_at'] and not (g['state']=='finished' and entry):
            raise HTTPException(404, 'Розыгрыш скрыт')
        r = g['rules']
        invites = (await storage.partner_invite_counts(session, g, tg)).get(tg, 0) if tg else 0
        admitted = bool(entry and entry['base_ok'] and invites >= r['min_invites'])
        result = pick(g, ('id','title','description','state','deadline','commitment'))
        result.update(prizes=[pick(p, ('title','quantity')) for p in g['prizes']], conditions=plain(render.conditions(r)),
                      channels=[{'name':k,'url':r['channel_links'].get(k)} for k in r['channels']],
                      bot_url=f'https://t.me/{await service.username(bot)}?start=gw_{gid}', linked=bool(tg), joined=bool(entry), admitted=admitted, invites=invites, required=r['min_invites'],
                      tickets=1+bonus_chances(invites,r) if admitted else 0,
                      reason=plain(error(ValueError(entry['reason']))) if entry and not entry['base_ok'] else '',
                      can_join=g['state']=='active' and time.time()<g['deadline'])
        if tg and (r['min_invites'] or r['bonus_every']):
            from database.models import User
            from database.partners import get_partner_profile
            from sqlalchemy import select
            uid=await session.scalar(select(User.id).where(User.tg_id==tg))
            profile=await get_partner_profile(session,uid) if uid else None
            code=(profile or {}).get('partner_code') or str(tg)
            result['invite_url']=f'https://t.me/{await service.username(bot)}?start=partner_{code}'
        if g['state']=='finished':
            result.update(seed=g['seed'], roster_hash=g['roster_hash'])
            wins=(await storage.sql(session,'SELECT rank,prize,coupon,gift,manual_delivered FROM gw_winners WHERE game=:g AND tg=:t',g=gid,t=tg)).mappings().first() if tg else None
            if wins:
                keys=service.prize_keyboard(wins,await service.username(bot))
                result['win']={'title':wins['prize']['title'],'rank':wins['rank'],'delivered':wins['manual_delivered'],
                               'url':keys.inline_keyboard[0][0].url if keys else None}
        return result

    @router.post('/game/{gid}/join')
    async def join(gid: int, identity=Depends(verify_identity_token), session=Depends(get_session)):
        require_module()
        from bot import bot
        from modules.giveaways import service
        if not identity.tg_id:
            raise HTTPException(403, 'Сначала привяжите Telegram в профиле')
        from core.rate_limit import rate_limit_hit
        from handlers.legal import is_legal_enabled, legal_accepted
        _, exceeded = await rate_limit_hit(f'giveaway_join:{identity.tg_id}',12,60)
        if exceeded: raise HTTPException(429,'Слишком много проверок. Попробуйте через минуту')
        if is_legal_enabled() and not await legal_accepted(session,identity.tg_id):
            raise HTTPException(403,'Завершите регистрацию и примите условия в боте')
        actor = SimpleNamespace(id=identity.tg_id, is_bot=False, username=identity.username,
                                full_name=identity.display_name or identity.username or 'Участник')
        ok, reason = await checked(service.join(bot,gid,actor))
        return {'base_ok':ok}

    @router.get('/admin')
    async def admin_list(page: int = Query(0, ge=0, le=99999), actor=Depends(staff)):
        from modules.giveaways import storage
        rows=await storage.list_games(page)
        return {'items':[dict(r) for r in rows[:20]],'more':len(rows)>20}

    @router.post('/admin')
    async def create(actor=Depends(staff)):
        from modules.giveaways import storage
        return {'id':await checked(storage.create(actor))}

    @router.get('/admin/{gid}')
    async def editor(gid:int, actor=Depends(staff)):
        from modules.giveaways import service,storage,render
        g=await game(gid)
        if g['deleted_at']: raise HTTPException(404,'Розыгрыш скрыт')
        data=pick(g,('id','title','description','deadline','channel','result_channel','prizes','rules','state','version'))
        stats=await storage.stats(gid)
        data.update(total=stats['total'], deliveries=[dict(x) for x in stats['deliveries']],
                    winners=[pick(x,('rank','tg','prize','manual_delivered')) for x in stats['winners']],
                    audit=[dict(x) for x in await storage.audit_log(gid)], preview=plain(render.post(g,'')),
                    tariffs=[{'id':x.id,'name':x.name} for x in await service.gift_tariffs()])
        return data

    @router.patch('/admin/{gid}')
    async def edit(gid:int, body:Edit, actor=Depends(staff)):
        from bot import bot
        from modules.giveaways import service
        from modules.giveaways.config import validate_rules
        f,v=body.field,body.value
        if f in ('title','description','channel','result_channel'):
            if not isinstance(v,str) or len(v) > {'title':128,'description':1200}.get(f,100):
                raise HTTPException(422,'Недопустимая длина поля')
            if f=='title' and not v.strip() or f.endswith('channel') and not re.fullmatch(r'@[\w]+|-?\d+',v):
                raise HTTPException(422,'Проверьте значение поля')
        elif f=='deadline' and (type(v) not in (int,float) or not time.time()+120<v<10**11):
            raise HTTPException(422,'Укажите будущий срок')
        elif f=='rules':
            try:
                if not isinstance(v,dict):raise ValueError()
                v=validate_rules(dict(v,channel_links={}))
            except (ValueError,TypeError):raise HTTPException(422,'Проверьте условия участия')
        elif f=='prizes':
            if not isinstance(v,list):raise HTTPException(422,'Ожидается список призов')
            if v:
                v=await checked(service.validate_rewards(v))
        await checked(service.update_game(bot,gid,actor,f,v,body.version))
        return {'ok':True}

    @router.post('/admin/{gid}/action')
    async def action(gid:int,body:Action,actor=Depends(staff)):
        from bot import bot
        from modules.giveaways import service,storage,render,ui
        from aiogram.exceptions import TelegramBadRequest
        g=await game(gid)
        if g['deleted_at'] or g['version']!=body.version: raise HTTPException(409,'Обновите данные розыгрыша')
        a,n=body.action,body.number
        if a=='publish': await checked(service.publish(bot,gid,actor,body.version))
        elif a=='cancel': await checked(service.cancel(gid,actor,body.version))
        elif a=='hide': await checked(storage.hide(gid,actor,body.version))
        elif a=='reset': await checked(storage.reset_publish(gid,actor,body.version))
        elif a=='extend': await checked(service.extend(bot,gid,actor,n))
        elif a=='retry': await checked(storage.retry_message(gid,n,actor))
        elif a=='delivered': await checked(storage.manual_delivered(gid,n,actor))
        elif a=='recover':
            if g['state']!='publishing' or not g['channel_id'] or not n:raise HTTPException(409,'Проверьте состояние и номер поста')
            name=await service.username(bot)
            try: await ui.edit_to(bot,g['channel_id'],n,render.post(g,name),service.post_keyboard(name,gid))
            except TelegramBadRequest as exc:
                if 'message is not modified' not in str(exc).lower():raise HTTPException(409,'Не удалось привязать пост')
            await checked(storage.attach_post(gid,actor,n))
        return {'ok':True}

    @router.get('/admin/{gid}/entries.csv')
    async def export(gid:int,actor=Depends(staff)):
        from modules.giveaways import storage
        rows=await storage.export_entries(gid)
        out=io.StringIO()
        writer=csv.writer(out)
        fields=('tg','username','name','joined','inviter','base_ok','verified','reason')
        writer.writerow(fields)
        for row in rows:
            cells=[str(row[k]) if row[k] is not None else '' for k in fields]
            writer.writerow(["'"+s if s.lstrip().startswith(('=','+','-','@')) or s.startswith(('\t','\r','\n')) else s for s in cells])
        return Response('\ufeff'+out.getvalue(),media_type='text/csv',headers={'Content-Disposition':f'attachment; filename="giveaway-{gid}.csv"','Cache-Control':'no-store'})
    return router
