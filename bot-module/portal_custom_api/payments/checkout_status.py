"""Receipt for an interactive checkout; native handlers own all payment side effects."""
from datetime import datetime, timezone, timedelta
from hashlib import sha256
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text

from api.depends import get_session, verify_identity_token
from api.ratelimit import enforce_rate_limit
from database.models import AuditEvent
from database.cache_purge import flush_purges

EVENT = 'site_checkout_attempt'


async def receipt(session, identity, reference):
    return await session.scalar(select(AuditEvent).where(
        AuditEvent.event_type == EVENT, AuditEvent.request_id == str(reference),
        AuditEvent.actor_identity_id == identity.id).limit(1))


async def submit(reference, action, body, target, request, session, identity, perform):
    fingerprint = sha256((action + '|' + target + '|' + body.model_dump_json()).encode()).hexdigest()
    await enforce_rate_limit(request, session, bucket='site_checkout_submit', max_per_window=12, window_sec=60)
    await session.execute(text('SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))'),
                          {'key': f'checkout:{identity.id}:{reference}'})
    prior = await receipt(session, identity, reference)
    if prior:
        if (prior.metadata_ or {}).get('fingerprint') != fingerprint:
            # Keep the original receipt available for status reconciliation.
            return {'receipt_state': 'different_parameters'}
        return {'receipt_state': prior.result}
    row = AuditEvent(event_type=EVENT, channel='api', actor_identity_id=identity.id,
                     request_id=str(reference), path_or_handler=action, result='processing', metadata_={'fingerprint':fingerprint})
    session.add(row)
    await session.commit()
    try:
        result = await perform()
        row.result = 'declined' if not result.ok else 'payment_created' if result.payment_url else 'completed'
        if result.payment_url:
            row.metadata_ = {'fingerprint':fingerprint,'payment_id':result.payment_id}
        await session.commit()
        await flush_purges(session)
        return result
    except HTTPException as exc:
        await session.rollback()
        saved = await receipt(session, identity, reference)
        if saved:
            saved.result = 'declined' if exc.status_code in (401, 403, 404, 409, 422, 429) else 'unconfirmed'
            await session.commit()
        raise


def get_router(prefix):
    from api.v2.routes.keys.user.renew import AccountKeyRenewRequest, user_key_renew
    from api.v2.routes.tariffs import TariffPurchaseRequest, purchase_tariff_with_balance
    from ..subscriptions.single_subscription import check_purchase

    router = APIRouter(prefix=prefix+'/checkout')

    @router.get('/{reference}')
    async def status(reference: UUID, identity=Depends(verify_identity_token), session=Depends(get_session)):
        row = await receipt(session, identity, reference)
        if row is None:
            return {'state':'not_found'}
        payment = (row.metadata_ or {}).get('payment_id')
        if payment:
            from api.v2.routes.payment_links import get_link_status
            try:
                info = await get_link_status(payment, session, identity)
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
            else:
                if info.paid:
                    return {'state':'paid'}
                if info.status in ('cancelled', 'canceled', 'expired', 'failed'):
                    return {'state':'declined'}
        created = row.created_at.replace(tzinfo=timezone.utc) if row.created_at.tzinfo is None else row.created_at
        review = row.result in ('processing','unconfirmed') and datetime.now(timezone.utc)-created > timedelta(minutes=10)
        return {'state':row.result, 'manual_review':review}

    @router.post('/{reference}/purchase')
    async def purchase(reference: UUID, body: TariffPurchaseRequest, request: Request,
                       identity=Depends(verify_identity_token), session=Depends(get_session)):
        async def perform():
            await check_purchase(identity, session)
            return await purchase_tariff_with_balance(body=body, request=request, preview=False,
                                                       identity=identity, session=session)
        return await submit(reference, 'checkout:purchase', body, '', request, session, identity, perform)

    @router.post('/{reference}/renew/{client_id}')
    async def renew(reference: UUID, client_id: str, body: AccountKeyRenewRequest, request: Request,
                    identity=Depends(verify_identity_token), session=Depends(get_session)):
        async def perform():
            return await user_key_renew(client_id=client_id, body=body, request=request, preview=False,
                                        force_web=False, identity=identity, session=session)
        return await submit(reference, 'checkout:renew', body, client_id, request, session, identity, perform)

    return router
