"""Rotate subscription credentials using the same panel operations as the Telegram editor."""
from html import escape

from fastapi import HTTPException


async def rotate_link(session, key):
    from database.servers import get_servers
    from database.keys import invalidate_key_details, invalidate_key_email

    servers = await get_servers(session)
    nodes = servers.get(key.server_id) or [s for cluster in servers.values() for s in cluster
        if (s.get('server_name') or '').lower() == str(key.server_id).lower()]
    if not nodes:
        raise HTTPException(409, 'Кластер подписки недоступен.')
    old_email = key.email
    remna = next((s for s in nodes if s.get('panel_type', '').lower() == 'remnawave'), None)
    if remna:
        from panels.remnawave import RemnawaveAPI
        from settings.config import REMNAWAVE_TOKEN_LOGIN_ENABLED, REMNAWAVE_LOGIN, REMNAWAVE_PASSWORD

        if not remna.get('api_url'):
            raise HTTPException(409, 'У кластера отсутствует адрес панели.')
        api = RemnawaveAPI(remna['api_url'])
        try:
            if not REMNAWAVE_TOKEN_LOGIN_ENABLED:
                await api.login(REMNAWAVE_LOGIN, REMNAWAVE_PASSWORD)
            result = await api.revoke_user_subscription(key.client_id, username=old_email)
        finally:
            await api.aclose()
        link = (result or {}).get('subscriptionUrl')
        if not link:
            raise HTTPException(502, 'Панель не подтвердила новую ссылку. Проверьте подписку перед повтором.')
        key.remnawave_link = link
    else:
        from database.access.resolution import subscription_owner_ref
        from handlers.utils import generate_random_email
        from panels._3xui import change_client_email, get_xui_instance
        from settings.config import PUBLIC_LINK, SUPERNODE

        new_email = await generate_random_email(session=session)
        link = f"{PUBLIC_LINK.rstrip('/')}/{new_email}/{await subscription_owner_ref(session, key.user_id)}"
        if not all(s.get('api_url') and s.get('inbound_id') for s in nodes):
            raise HTTPException(409, 'В конфигурации 3x-ui отсутствует адрес или inbound.')
        changed = []
        try:
            for server in nodes:
                panel = await get_xui_instance(server['api_url'])
                suffix = '_' + server['server_name'].lower() if SUPERNODE else ''
                inbound = int(server['inbound_id'])
                if not await change_client_email(panel, inbound, old_email + suffix, new_email + suffix, new_email, key.client_id):
                    raise RuntimeError('rename not confirmed')
                changed.append((panel, inbound, suffix))
        except Exception:
            for panel, inbound, suffix in reversed(changed):
                try:
                    await change_client_email(panel, inbound, new_email + suffix, old_email + suffix, old_email, key.client_id)
                except Exception:
                    continue
            raise HTTPException(502, 'Смена ссылки не подтверждена всеми узлами. Проверьте состояние панелей.') from None
        key.email = new_email
        key.remnawave_link = None
        await invalidate_key_email(key.client_id)
        await invalidate_key_details(new_email)
    key.key = link
    await session.flush()
    await invalidate_key_details(old_email)
    return link


async def notify_owner(session, user_id, link):
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    from bot import bot
    from database.access.resolution import chat_id_for_user

    try:
        chat = await chat_id_for_user(session, user_id)
        if chat is None:
            return False
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text='📱 Мои подписки', callback_data='view_keys')],
            [InlineKeyboardButton(text='👤 Личный кабинет', callback_data='profile')],
        ])
        # Match the notification in SoloBot's admin key lifecycle handler.
        text = (
            "🔄 <b>Ваша подписка была перевыпущена</b>\n\n"
            f"🔗 <b>Новая ссылка подписки:</b>\n<code>{escape(link)}</code>\n\n"
            "<i>Старая ссылка больше не работает.</i>"
        )
        await bot.send_message(chat_id=chat, parse_mode='HTML', reply_markup=keyboard, text=text)
        return True
    except Exception:
        return False
