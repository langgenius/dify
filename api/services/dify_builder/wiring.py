"""HTTP-facing wiring for the Dify Builder: assemble the usecase with real
dependencies (SQL repo + cross-process lock + Celery enqueue) and the pure
serialize / error-map helpers the console controller uses. Kept out of the
controller module so it is unit-testable without the Flask request stack.
"""

import dataclasses
import json
import time
from collections.abc import Iterator

from sqlalchemy.orm import sessionmaker

from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor
from extensions.ext_database import db
from libs.broadcast_channel.exc import SubscriptionClosedError
from services.dify_builder import session_lock
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService, SessionView
from tasks.dify_builder_advance_task import advance_session

__all__ = ["build_service", "dify_builder_error_response", "session_view_to_dict", "stream_frames"]

_MAX_STREAM_SECONDS = 180
_HEARTBEAT_SECONDS = 15


def _enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
    advance_session.delay(session_id, dataclasses.asdict(action), dataclasses.asdict(actor), token)


def build_service() -> DifyBuilderService:
    repo = SqlDifyBuilderRepository(sessionmaker(bind=db.engine, expire_on_commit=False))
    return DifyBuilderService(repo, session_lock, _enqueue)


def session_view_to_dict(view: SessionView) -> dict:
    return dataclasses.asdict(view)


def dify_builder_error_response(exc: Exception) -> tuple[dict, int] | None:
    if isinstance(exc, BadRequestError):
        return {"code": "bad_request"}, 400
    # NotFoundError ALWAYS maps to a generic 404 regardless of message text
    # (owner-mismatch must be indistinguishable from a missing session).
    if isinstance(exc, NotFoundError):
        return {"code": "not_found"}, 404
    if isinstance(exc, ConflictError):
        return {"code": "conflict"}, 409
    if isinstance(exc, BusyError):
        return {"code": "session_busy"}, 409
    return None


def stream_frames(view_dict: dict, subscription) -> Iterator[str]:
    """Yield the snapshot frame, then relay progress events as SSE frames with a
    heartbeat, bounded by _MAX_STREAM_SECONDS. Always closes the subscription.

    Frame format matches the frontend parser + the retired Go transport:
    `event: <name>\ndata: <json>\n\n`.
    """
    deadline = time.monotonic() + _MAX_STREAM_SECONDS
    try:
        # Inside the try so `finally: subscription.close()` runs even if the
        # client disconnects during the snapshot frame.
        yield f"event: snapshot\ndata: {json.dumps(view_dict)}\n\n"
        while time.monotonic() < deadline:
            try:
                raw = subscription.receive(timeout=_HEARTBEAT_SECONDS)
            except SubscriptionClosedError:
                return
            if raw is None:  # receive timed out → heartbeat comment frame
                yield ": keep-alive\n\n"
                continue
            try:
                kind = json.loads(raw).get("kind", "message")
            except (ValueError, TypeError):
                kind = "message"
            yield f"event: {kind}\ndata: {raw.decode()}\n\n"
    finally:
        subscription.close()
