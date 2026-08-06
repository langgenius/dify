from __future__ import annotations

from flask import Request
from werkzeug.exceptions import BadRequest

from libs.broadcast_channel.cursor import normalize_stream_cursor


def get_workflow_event_replay_cursor(request: Request) -> str | None:
    """Read the standard SSE cursor, with a query fallback for non-EventSource clients."""

    raw_cursor = (request.headers.get("Last-Event-ID") or "").strip()
    if not raw_cursor:
        raw_cursor = (request.args.get("cursor") or "").strip()
    if not raw_cursor:
        return None
    try:
        return normalize_stream_cursor(raw_cursor)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
