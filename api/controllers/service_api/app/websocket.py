"""WebSocket endpoints for the Service API.

Provides ``/v1/ws/chat-messages`` and ``/v1/ws/completion-messages`` that
stream generation events over a persistent WebSocket connection instead of
SSE, enabling long-lived tunnels for messaging-platform integrations such
as WhatsApp, Telegram, Feishu and Slack.
"""

import logging
from typing import Any

from flask import Blueprint, request
from flask_sock import Sock
from pydantic import ValidationError
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from controllers.service_api.app.completion import ChatRequestPayload, CompletionRequestPayload
from core.app.entities.app_invoke_entities import InvokeFrom
from core.helper.trace_id_helper import get_external_trace_id
from extensions.ext_database import db
from libs.websocket import stream_events_to_websocket
from models.model import App, AppMode
from services.app_generate_service import AppGenerateService
from services.end_user_service import EndUserService

logger = logging.getLogger(__name__)

# Dedicated blueprint so that WebSocket routes can be registered with their
# own URL prefix while reusing the same ``/v1`` namespace.
ws_bp = Blueprint("service_api_ws", __name__, url_prefix="/v1/ws")
sock = Sock()


def _authenticate_ws() -> tuple[App, Any]:
    """Validate the API token supplied via the ``Authorization`` query param or header.

    WebSocket clients cannot always set HTTP headers, so the token may be
    passed as ``?token=<bearer_token>`` query parameter as a fallback.

    Returns the resolved ``(app_model, end_user)`` tuple.
    """
    from services.api_token_service import ApiTokenCache, fetch_token_with_single_flight, record_token_usage

    # Try header first, then query param
    auth_token: str | None = None
    auth_header = request.headers.get("Authorization")
    if auth_header and " " in auth_header:
        scheme, token = auth_header.split(None, 1)
        if scheme.lower() == "bearer":
            auth_token = token

    if not auth_token:
        auth_token = request.args.get("token")

    if not auth_token:
        raise Unauthorized("Authorization token must be provided via header or 'token' query param.")

    cached_token = ApiTokenCache.get(auth_token, "app")
    if cached_token is not None:
        record_token_usage(auth_token, "app")
        api_token = cached_token
    else:
        api_token = fetch_token_with_single_flight(auth_token, "app")

    app_model = db.session.query(App).where(App.id == api_token.app_id).first()
    if not app_model:
        raise Forbidden("The app no longer exists.")
    if app_model.status != "normal":
        raise Forbidden("The app's status is abnormal.")
    if not app_model.enable_api:
        raise Forbidden("The app's API service has been disabled.")

    # Resolve end-user from query param or first WS message
    user_id = request.args.get("user")
    if not user_id:
        raise Forbidden("The 'user' query parameter is required.")

    end_user = EndUserService.get_or_create_end_user(app_model, str(user_id))
    return app_model, end_user


@sock.route("/chat-messages", bp=ws_bp)
def ws_chat_messages(ws):
    """WebSocket endpoint for chat message streaming.

    Connect: ``ws://<host>/v1/ws/chat-messages?token=<api_key>&user=<user_id>``

    After the connection is established, send a JSON payload matching the
    ``ChatRequestPayload`` schema.  The server responds with a stream of JSON
    frames identical to the SSE ``data:`` payloads.  The connection closes
    automatically once the terminal event is sent.
    """
    try:
        app_model, end_user = _authenticate_ws()
    except Exception as exc:
        ws.send(f'{{"error": "{exc}"}}')
        ws.close()
        return

    app_mode = AppMode.value_of(app_model.mode)
    if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
        ws.send('{"error": "This app is not a chat application."}')
        ws.close()
        return

    # Receive the chat payload from the client
    raw = ws.receive(timeout=30)
    if raw is None:
        ws.close()
        return

    try:
        import json

        data = json.loads(raw)
        payload = ChatRequestPayload.model_validate(data)
    except (ValidationError, Exception) as exc:
        ws.send(f'{{"error": "Invalid payload: {exc}"}}')
        ws.close()
        return

    external_trace_id = get_external_trace_id(request)
    args = payload.model_dump(exclude_none=True)
    if external_trace_id:
        args["external_trace_id"] = external_trace_id

    try:
        response = AppGenerateService.generate(
            app_model=app_model,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )
        stream_events_to_websocket(ws, response)
    except Exception as exc:
        logger.exception("WebSocket chat-messages error")
        ws.send(f'{{"error": "{exc}"}}')
    finally:
        ws.close()


@sock.route("/completion-messages", bp=ws_bp)
def ws_completion_messages(ws):
    """WebSocket endpoint for completion message streaming.

    Connect: ``ws://<host>/v1/ws/completion-messages?token=<api_key>&user=<user_id>``

    After the connection is established, send a JSON payload matching the
    ``CompletionRequestPayload`` schema.
    """
    try:
        app_model, end_user = _authenticate_ws()
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
        payload = CompletionRequestPayload.model_validate(data)
    except (ValidationError, Exception) as exc:
        ws.send(f'{{"error": "Invalid payload: {exc}"}}')
        ws.close()
        return

    external_trace_id = get_external_trace_id(request)
    args = payload.model_dump(exclude_none=True)
    if external_trace_id:
        args["external_trace_id"] = external_trace_id
    args["auto_generate_name"] = False

    try:
        response = AppGenerateService.generate(
            app_model=app_model,
            user=end_user,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )
        stream_events_to_websocket(ws, response)
    except Exception as exc:
        logger.exception("WebSocket completion-messages error")
        ws.send(f'{{"error": "{exc}"}}')
    finally:
        ws.close()
