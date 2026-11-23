"""Read-only web view of the bot's own statistics screens."""
import base64
from html.parser import HTMLParser
from types import SimpleNamespace
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response

from api.depends import get_session, verify_identity_admin


class ReportText(HTMLParser):
    """Keep Telegram's visible text, including table spacing, but discard all markup."""

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag == 'br':
            self.parts.append('\n')


class ReportMessage:
    # The bot builds its report inside the Telegram handler. Capture the result
    # locally so this read never needs a Telegram chat or sends a message.
    html_text = text = ''
    reply_markup = None

    async def edit_text(self, *, text, reply_markup):
        self.html_text = text


async def report_error(*args, **kwargs):
    raise HTTPException(503, 'Бот не смог собрать статистику. Попробуйте ещё раз.')


async def stats_access(identity=Depends(verify_identity_admin), session=Depends(get_session)):
    from api.admin_permissions import require_admin_action
    from filters.permissions import PERM_STATS

    await require_admin_action(session, identity, PERM_STATS)
    return session


def get_router(prefix):
    router = APIRouter(prefix=prefix + '/admin/bot-stats')

    @router.get('/charts/{days}')
    async def chart(days: Literal['7', '30', '90'], response: Response, session=Depends(stats_access)):
        from handlers.admin.stats.stats_handler import _build_stats_chart

        image, legend = await _build_stats_chart(session, int(days))
        if image is None:
            raise HTTPException(503, 'Бот не смог построить график')
        response.headers['Cache-Control'] = 'private, no-store'
        return {'png': base64.b64encode(image.getvalue()).decode('ascii'), 'legend': legend}

    @router.get('/{segment}')
    async def report(segment: str, response: Response, session=Depends(stats_access)):
        from handlers.admin.stats.keyboard import STATS_SEGMENTS
        from handlers.admin.stats.stats_handler import handle_stats

        index = next((i for i, item in enumerate(STATS_SEGMENTS) if item[0] == segment), None)
        if index is None:
            raise HTTPException(404, 'Такого раздела статистики в боте нет')
        message = ReportMessage()
        await handle_stats(SimpleNamespace(message=message, answer=report_error),
                           SimpleNamespace(page=index + 1), session)
        if not message.html_text:
            await report_error()
        parser = ReportText()
        parser.feed(message.html_text)
        parser.close()
        response.headers['Cache-Control'] = 'private, no-store'
        return {'text': ''.join(parser.parts)}

    return router
