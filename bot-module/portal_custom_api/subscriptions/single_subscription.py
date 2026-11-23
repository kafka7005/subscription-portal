"""Enforce the bot's single-subscription switch on customer web purchases."""
from functools import wraps

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from api.depends import get_session, verify_identity_token
from api.v2.routes import payment_links, tariffs
from core.settings.runtime_sync import maybe_sync_runtime_configs
from database import identities
from database.models import Key, User
from hooks.single_subscription import is_single_sub_enabled
from services.errors import ValidationError


LIMIT = 'У вас уже есть подписка. В этом режиме можно продлить её в личном кабинете.'


async def has_subscription(session, owner):
    # All three paths take the same owner lock before reading keys. The session
    # that writes the key holds the lock until its transaction finishes.
    await session.execute(select(User.id).where(User.id == owner).with_for_update())
    return await session.scalar(select(Key.client_id).where(Key.user_id == owner).limit(1)) is not None


async def check_purchase(identity=Depends(verify_identity_token), session=Depends(get_session)):
    if is_single_sub_enabled():
        owner = await identities.ensure_billing_user_for_identity(session, identity)
        if await has_subscription(session, owner):
            raise HTTPException(409, detail={'code': 'single_subscription', 'message': LIMIT})


async def check_link(body: payment_links.PaymentLinkCreateRequest, identity=Depends(verify_identity_token),
                     session=Depends(get_session)):
    flow = (body.metadata or {}).get('payment_flow')
    if str(flow or '').strip().lower() in ('tariff_purchase', 'trial_purchase'):
        await check_purchase(identity, session)


def install_completion_guard():
    # Both checkout implementations call these module attributes at runtime,
    # including when provider handlers were imported before this extension.
    from database.temporary_data import get_temporary_data
    from database.payments import resolve_payment_creation_owner
    from services.payments import checkout_intent, pipeline

    create = checkout_intent.create_vpn_key_headless
    if not getattr(create, '_single_subscription_guard', False):
        @wraps(create)
        async def guarded_create(session, tg_id, *args, **kwargs):
            await maybe_sync_runtime_configs()
            if is_single_sub_enabled() and await has_subscription(session, tg_id):
                # Provider handles a ServiceError through its normal paid-review flow.
                raise ValidationError(LIMIT)
            return await create(session, tg_id, *args, **kwargs)

        guarded_create._single_subscription_guard = True
        checkout_intent.create_vpn_key_headless = guarded_create

    notify = pipeline.send_payment_success_notification
    if not getattr(notify, '_single_subscription_guard', False):
        @wraps(notify)
        async def guarded_notify(owner_ref, amount, session, **kwargs):
            if kwargs.get('use_temporary_checkout') and not kwargs.get('completed_checkout_flow'):
                await maybe_sync_runtime_configs()
                if is_single_sub_enabled():
                    owner = await resolve_payment_creation_owner(session, owner_ref)
                    cart = await get_temporary_data(session, owner) or {}
                    if (cart.get('state') == 'waiting_for_payment'
                            and (cart.get('data') or {}).get('payment_flow') != 'gift_create'
                            and await has_subscription(session, owner)):
                        # The pipeline already credited the payment to the balance.
                        kwargs.update(use_temporary_checkout=False, checkout_operation=None)
            return await notify(owner_ref, amount, session, **kwargs)

        guarded_notify._single_subscription_guard = True
        pipeline.send_payment_success_notification = guarded_notify


def get_router(prefix, version):
    router = APIRouter()

    @router.get(prefix + '/subscription-mode')
    async def subscription_mode(session=Depends(get_session), identity=Depends(verify_identity_token)):
        return {'single': is_single_sub_enabled()}

    if version != 2:
        return router
    from utils.modules_manager import manager
    if not manager.is_available(__package__.split('.')[-2]):
        return router

    # Native request/response models, billing, consent and validation stay in use.
    for path, handler, model, guard in (
        ('/api/tariffs/purchase', tariffs.purchase_tariff_with_balance, tariffs.TariffPurchaseResponse, check_purchase),
        ('/api/tariffs/trial', tariffs.activate_trial, tariffs.TariffPurchaseResponse, check_purchase),
        ('/api/payment-links', payment_links.create_link, payment_links.PaymentLinkCreateResponse, check_link),
    ):
        router.add_api_route(path, handler, methods=['POST'], response_model=model, dependencies=[Depends(guard)])
    return router
