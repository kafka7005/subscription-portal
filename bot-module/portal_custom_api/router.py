# API сайта и фоновая проверка напоминаний; обработчиков сообщений Telegram нет.
from aiogram import Router

router = Router(name="portal_custom_api_module")
async def on_startup(**kwargs):
    from .broadcast_status import install_tracking
    install_tracking()
    from .support_reminders import start_worker
    await start_worker(**kwargs)

async def on_shutdown(**kwargs):
    from .support_reminders import stop_worker
    await stop_worker(**kwargs)

router.startup.register(on_startup)
router.shutdown.register(on_shutdown)
