# API сайта и фоновая проверка напоминаний; обработчиков сообщений Telegram нет.
from aiogram import Router

router = Router(name="portal_custom_api_module")
async def on_startup(**kwargs):
    from .subscriptions.telegram_rotation import install as install_rotation
    install_rotation()
    from bot import bot
    from .subscriptions.rotation_trace import telegram_result
    if telegram_result not in bot.session.middleware:
        bot.session.middleware.register(telegram_result)
    from .subscriptions.single_subscription import install_completion_guard
    install_completion_guard()
    from .campaigns.broadcast_status import install_tracking
    install_tracking()
    from .support.support_reminders import start_worker
    await start_worker(**kwargs)

async def on_shutdown(**kwargs):
    from .support.support_reminders import stop_worker
    await stop_worker(**kwargs)

router.startup.register(on_startup)
router.shutdown.register(on_shutdown)
