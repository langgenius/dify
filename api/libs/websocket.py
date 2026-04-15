"""WebSocket utilities for streaming app generation responses.

Bridges the existing Redis pub/sub event streaming infrastructure to WebSocket
connections, enabling persistent bidirectional communication for messaging
platform integrations (Slack, Telegram, WhatsApp, Feishu/Lark, etc.).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Generator, Mapping
from typing import Any

from libs.orjson import orjson_dumps

logger = logging.getLogger(__name__)


def stream_events_to_websocket(
    ws: Any,
    generator: Mapping | Generator[Mapping | str, None, None],
) -> None:
    """Stream SSE events over a WebSocket connection.

    Consumes the same generator that ``compact_generate_response`` uses for
    SSE and forwards each event as a JSON text frame over *ws*.

    For blocking (dict) responses the payload is sent as a single frame and
    the connection is closed.

    :param ws: A ``flask_sock`` / ``simple_websocket.Server`` object.
    :param generator: Either a blocking dict response or a streaming generator
        yielding ``Mapping`` (JSON event) or ``str`` (event-name-only) items.
    """
    if isinstance(generator, dict):
        ws.send(json.dumps(generator))
        return

    try:
        for message in generator:
            if isinstance(message, Mapping | dict):
                ws.send(orjson_dumps(message))
            else:
                # Event-name-only messages (e.g. "ping")
                ws.send(json.dumps({"event": message}))
    except Exception:
        logger.debug("WebSocket connection closed by client")
