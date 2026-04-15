"""WebSocket endpoints for the Web App API.

Provides ``/api/ws/chat-messages`` and ``/api/ws/completion-messages`` that
stream generation events over a persistent WebSocket connection instead of
SSE, enabling long-lived tunnels for messaging-platform integrations.
"""

import logging
from typing import Any

from flask import Blueprint, request
from flask_sock import Sock
from pydantic import ValidationError

from controllers.web.completion import ChatMessagePayload, CompletionMessagePayload
from controllers.web.wraps import decode_jwt_token
from core.app.entities.app_invoke_entities import InvokeFrom
from libs.websocket import stream_events_to_websocket
from models.model import AppMode
from services.app_generate_service import AppGenerateService

logger = logging.getLogger(__name__)

ws_web_bp = Blueprint("web_ws", __name__, url_prefix="/api/ws")
sock = Sock()


def _authenticate_web_ws() -> tuple[Any, Any]:
    """Authenticate a web-app WebSocket connection.

    The passport token can be passed via the ``X-App-Passport`` header or
    the ``passport`` query parameter.  ``X-App-Code`` can likewise be passed
    as a query parameter ``app_code``.
    """
    return decode_jwt_token()


@sock.route("/chat-messages", bp=ws_web_bp)
def ws_web_chat_messages(ws):
    """WebSocket chat endpoint for web applications."""
    try:
        app_model, end_user = _authenticate_web_ws()
    except Exception as exc:
        ws.send(f'{{"error": "{exc}"}}')
        ws.close()
        return

    app_mode = AppMode.value_of(app_model.mode)
    if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
        ws.send('{"error": "This app is not a chat application."}')
        ws.close()
        return

    raw = ws.receive(timeout=30)
    if raw is None:
        ws.close()
        return

    try:
        import json

        data = json.loads(raw)
        payload = ChatMessagePayload.model_validate(data)
    except (ValidationError, Exception) as exc:
        ws.send(f'{{"error": "Invalid payload: {exc}"}}')
        ws.close()
        return

    args = payload.model_dump(exclude_none=True)
    args["auto_generate_name"] = False

    try:
        response = AppGenerateService.generate(
            app_model=app_model,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )
        stream_events_to_websocket(ws, response)
    except Exception as exc:
        logger.exception("WebSocket web chat-messages error")
        ws.send(f'{{"error": "{exc}"}}')
    finally:
        ws.close()


@sock.route("/completion-messages", bp=ws_web_bp)
def ws_web_completion_messages(ws):
    """WebSocket completion endpoint for web applications."""
    try:
        app_model, end_user = _authenticate_web_ws()
    except Exception as exc:
        ws.send(f'{{"error": "{exc}"}}')
        ws.close()
        return

    if app_model.mode != AppMode.COMPLETION:
        ws.send('{"error": "This app is not a completion application."}')
        ws.close()
        return

    raw = ws.receive(timeout=30)
    if raw is None:
        ws.close()
        return

    try:
        import json

        data = json.loads(raw)
        payload = CompletionMessagePayload.model_validate(data)
    except (ValidationError, Exception) as exc:
        ws.send(f'{{"error": "Invalid payload: {exc}"}}')
        ws.close()
        return

    args = payload.model_dump(exclude_none=True)
    args["auto_generate_name"] = False

    try:
        response = AppGenerateService.generate(
            app_model=app_model,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )
        stream_events_to_websocket(ws, response)
    except Exception as exc:
        logger.exception("WebSocket web completion-messages error")
        ws.send(f'{{"error": "{exc}"}}')
    finally:
        ws.close()
