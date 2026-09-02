"""HTTP-facing wiring for the Dify Builder: assemble the usecase with real
dependencies (SQL repo + cross-process lock + Celery enqueue) and the pure
serialize / error-map helpers the console controller uses. Kept out of the
controller module so it is unit-testable without the Flask request stack.
"""

import dataclasses
import json
import time
from collections.abc import Iterator

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.wraps import RBACPermission, RBACResourceScope, enforce_rbac_access
from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor
from extensions.ext_database import db
from libs.broadcast_channel.exc import SubscriptionClosedError
from models import App, TenantAccountJoin, TenantAccountRole
from services.dify_builder import progress_bus, session_lock
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import AppAccess, DifyBuilderService, SessionView
from tasks.dify_builder_advance_task import advance_session

__all__ = [
    "build_service",
    "dify_builder_error_response",
    "session_view_to_dict",
    "stream_advance_frames",
]

_MAX_STREAM_SECONDS = 180
_HEARTBEAT_SECONDS = 15
_TERMINAL_KINDS = ("state", "error")
_PROGRESS_KINDS = frozenset({"node", "canvas", "agent_message", "commit", *_TERMINAL_KINDS})


def _enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
    advance_session.delay(session_id, dataclasses.asdict(action), dataclasses.asdict(actor), token)


def _authorize_app(actor: Actor, app_id: str, access: AppAccess) -> None:
    """Resolve a tenant-owned normal App, then enforce Builder permissions.

    Legacy workspaces use the same owner/admin/editor rule as
    ``edit_permission_required``. RBAC workspaces always require APP_EDIT;
    test/run and release operations additionally require their dedicated
    permission point, matching the existing workflow run/publish routes.
    """
    trusted_app_id = db.session.scalar(
        select(App.id).where(App.id == app_id, App.tenant_id == actor.tenant_id, App.status == "normal")
    )
    if trusted_app_id is None:
        raise NotFoundError("app not found")

    role = db.session.scalar(
        select(TenantAccountJoin.role).where(
            TenantAccountJoin.tenant_id == actor.tenant_id,
            TenantAccountJoin.account_id == actor.account_id,
        )
    )
    if role is None or (not dify_config.RBAC_ENABLED and not TenantAccountRole.is_editing_role(role)):
        raise Forbidden()

    scenes = [RBACPermission.APP_EDIT]
    if access == AppAccess.TEST_AND_RUN:
        scenes.append(RBACPermission.APP_TEST_AND_RUN)
    elif access == AppAccess.RELEASE:
        scenes.append(RBACPermission.APP_RELEASE_AND_VERSION)
    for scene in scenes:
        enforce_rbac_access(
            tenant_id=actor.tenant_id,
            account_id=actor.account_id,
            resource_type=RBACResourceScope.APP,
            scene=scene,
            path_args={"app_id": str(trusted_app_id)},
        )


def _get_app_revision(app_id: str, actor: Actor) -> str:
    _graph, revision = WorkflowServiceDifyPort().read_graph(app_id, actor)
    return revision


def build_service() -> DifyBuilderService:
    repo = SqlDifyBuilderRepository(sessionmaker(bind=db.engine, expire_on_commit=False))
    return DifyBuilderService(
        repo,
        session_lock,
        _enqueue,
        subscribe_fn=progress_bus.subscribe,
        authorize_app_fn=_authorize_app,
        get_app_revision_fn=_get_app_revision,
    )


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


def _event_frame(event: str, data: object) -> str:
    """Encode one oRPC-compatible SSE message.

    The SSE protocol-level event is always ``message``. oRPC's event-iterator
    decoder consumes that explicit event name; the Builder discriminant belongs
    in the JSON data envelope so even Builder ``error`` events remain typed
    values instead of becoming transport exceptions.
    """
    return f"event: message\ndata: {json.dumps({'event': event, 'data': data})}\n\n"


def _progress_event(raw: bytes) -> tuple[str, object]:
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, ValueError, TypeError):
        return "error", {"kind": "error", "error": "invalid Builder progress event"}
    if not isinstance(data, dict) or data.get("kind") not in _PROGRESS_KINDS:
        return "error", {"kind": "error", "error": "invalid Builder progress event"}
    return data["kind"], data


def stream_advance_frames(
    view_dict: dict,
    subscription,
    expect_advance: bool,
    *,
    emit_state_when_settled: bool = False,
) -> Iterator[str]:
    """Snapshot, then (if an advance is in flight) relay progress frames until this
    advance's terminal frame (`state` or `error`), inclusive, then close. Settle-only
    calls (no advance) yield just the snapshot. Bounded by _MAX_STREAM_SECONDS."""
    try:
        yield _event_frame("snapshot", view_dict)
        if not expect_advance:
            if emit_state_when_settled:
                yield _event_frame("state", {"kind": "state", **view_dict})
            return
        if subscription is None:
            return
        deadline = time.monotonic() + _MAX_STREAM_SECONDS
        while time.monotonic() < deadline:
            try:
                raw = subscription.receive(timeout=_HEARTBEAT_SECONDS)
            except SubscriptionClosedError:
                return
            if raw is None:
                yield ": keep-alive\n\n"
                continue
            kind, data = _progress_event(raw)
            yield _event_frame(kind, data)
            if kind in _TERMINAL_KINDS:
                return
    finally:
        if subscription is not None:
            subscription.close()
