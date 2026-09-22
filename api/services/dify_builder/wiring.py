"""HTTP-facing wiring for the Dify Builder: assemble the usecase with real
dependencies (SQL repo + cross-process lock + Celery enqueue) and the pure
serialize / error-map helpers the console controller uses. Kept out of the
controller module so it is unit-testable without the Flask request stack.
"""

import dataclasses
import json
import time
from collections.abc import Generator, Iterator, Sequence
from typing import Any

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission, enforce_rbac_checks
from core.dify_builder.errors import BadRequestError, BusyError, ConflictError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Action, Actor, ConversationItem
from extensions.ext_database import db
from fields.workflow_stream_fields import WorkflowStreamPayload
from libs.broadcast_channel.exc import SubscriptionClosedError
from models import App, TenantAccountJoin, TenantAccountRole
from services.dify_builder import app_naming, progress_bus, session_lock
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

_HEARTBEAT_SECONDS = 15
_MAX_STREAM_SECONDS = dify_config.DIFY_BUILDER_MAX_ADVANCE_SECONDS + _HEARTBEAT_SECONDS
_TERMINAL_KINDS = ("command_finished", "error")
_PROGRESS_KINDS = frozenset(
    {"workflow", "canvas", "agent_message", "conversation_item_appended", "reasoning", "progress", *_TERMINAL_KINDS}
)
_IGNORED_WORKFLOW_EVENTS = frozenset({"message_end", "message_file", "tts_message", "tts_message_end"})
_WORKFLOW_PAYLOAD_ADAPTER = TypeAdapter(WorkflowStreamPayload)


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
        enforce_rbac_checks(
            tenant_id=actor.tenant_id,
            account_id=actor.account_id,
            checks=[RBACCheck(scene, PlainApp())],
            path_args={"app_id": str(trusted_app_id)},
        )


def _get_app_revision(app_id: str, actor: Actor) -> str:
    _graph, revision = WorkflowServiceDifyPort().read_graph(app_id, actor)
    return revision


def _get_app_name(app_id: str, actor: Actor) -> str:
    return app_naming.current_app_name(app_id=app_id, tenant_id=actor.tenant_id)


def build_service() -> DifyBuilderService:
    repo = SqlDifyBuilderRepository(sessionmaker(bind=db.engine, expire_on_commit=False))
    return DifyBuilderService(
        repo,
        session_lock,
        _enqueue,
        subscribe_fn=progress_bus.subscribe,
        authorize_app_fn=_authorize_app,
        get_app_revision_fn=_get_app_revision,
        get_app_name_fn=_get_app_name,
    )


def _public_actions(actions: object) -> list[dict[str, object]]:
    if not isinstance(actions, list):
        return []
    return [
        {"id": action.get("id", ""), "label": action.get("label", ""), "kind": action.get("kind", "secondary")}
        for action in actions
        if isinstance(action, dict)
    ]


def _public_active_interaction(interaction: object) -> dict[str, object] | None:
    if not isinstance(interaction, dict):
        return None
    card = interaction.get("card")
    if not isinstance(card, dict) or not isinstance(card.get("seq"), int):
        return None
    return {
        "action_id": interaction.get("action_id", ""),
        "card_seq": card["seq"],
        "valid_at_version": interaction.get("valid_at_version", 0),
    }


def _public_app_revision(revision: object) -> dict[str, object] | None:
    if not isinstance(revision, dict):
        return None
    return {
        "current": revision.get("current", ""),
        "conflicted": revision.get("conflicted", False),
    }


def _public_session_view(view: dict[str, Any], *, include_last_command_id: bool) -> dict[str, object]:
    """Project the internal engine view onto the browser-owned UI contract."""
    projected: dict[str, object] = {
        "session_id": view.get("session_id", ""),
        "version": view.get("version", 0),
        "canvas_read_only": view.get("canvas_read_only", False),
        "run_status": view.get("run_status", "failed"),
        "interrupted": view.get("interrupted", False),
        "conversation_last_seq": view.get("conversation_last_seq", -1),
        "phase": view.get("phase", "understand"),
        "actions": _public_actions(view.get("actions")),
    }
    active_interaction = _public_active_interaction(view.get("active_interaction"))
    if active_interaction is not None:
        projected["active_interaction"] = active_interaction
    for key in ("recovery", "model"):
        if view.get(key) is not None:
            projected[key] = view[key]
    app_revision = _public_app_revision(view.get("app_revision"))
    if app_revision is not None:
        projected["app_revision"] = app_revision
    if include_last_command_id:
        projected["last_command_id"] = view.get("last_command_id", "")
    return projected


def session_view_to_dict(view: SessionView) -> dict[str, object]:
    """Serialize only the session fields consumed by the browser."""
    return _public_session_view(dataclasses.asdict(view), include_last_command_id=True)


def dify_builder_error_response(exc: Exception) -> tuple[dict, int] | None:
    if isinstance(exc, ModelUnavailableError):
        return {"code": "model_unavailable", "message": "Builder model is unavailable", "recoverable": True}, 400
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


def _error_event(data: dict[str, Any], fallback: str) -> dict[str, object]:
    message = data.get("message") or data.get("error") or fallback
    event: dict[str, object] = {"message": str(message)}
    for field in ("session_id", "command_id", "code"):
        value = data.get(field)
        if value is not None:
            event[field] = value
    return event


def _public_activity(activity: object) -> dict[str, object] | None:
    if not isinstance(activity, dict):
        return None
    public_activity: dict[str, object] = {
        "id": activity.get("id", ""),
        "label": activity.get("label", ""),
        "state": activity.get("state", "active"),
    }
    if activity.get("parent_id") is not None:
        public_activity["parent_id"] = activity["parent_id"]
    return public_activity


def _public_execution(execution: object) -> dict[str, object] | None:
    if not isinstance(execution, dict):
        return None
    activities = execution.get("activities")
    public_activities: list[dict[str, object]] = []
    if isinstance(activities, list):
        for activity in activities:
            public_activity = _public_activity(activity)
            if public_activity is not None:
                public_activities.append(public_activity)
    return {
        "status": execution.get("status", "running"),
        "activities": public_activities,
    }


def _progress_event(raw: bytes) -> tuple[str, object] | None:
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, ValueError, TypeError):
        return "error", _error_event({}, "invalid Builder progress event")
    if not isinstance(data, dict) or data.get("kind") not in _PROGRESS_KINDS:
        return "error", _error_event({}, "invalid Builder progress event")

    kind = data["kind"]
    if kind == "workflow":
        payload = data.get("payload")
        if isinstance(payload, dict) and payload.get("event") in _IGNORED_WORKFLOW_EVENTS:
            return None
        try:
            public_payload = _WORKFLOW_PAYLOAD_ADAPTER.validate_python(payload).model_dump(
                mode="json", exclude_none=True, exclude_unset=True
            )
        except ValidationError:
            return "error", _error_event(data, "invalid Builder workflow event")
        return kind, {
            "session_id": data.get("session_id", ""),
            "operation_id": data.get("operation_id", ""),
            "at_version": data.get("at_version", 0),
            "revision": data.get("revision", 0),
            "payload": public_payload,
        }
    if kind == "canvas":
        event = {
            "session_id": data.get("session_id", ""),
            "operation_id": data.get("operation_id", ""),
            "at_version": data.get("at_version", 0),
            "revision": data.get("revision", 0),
            "event": data.get("event"),
        }
        if data.get("node_id") is not None:
            event["node_id"] = data["node_id"]
        return kind, event
    if kind == "agent_message":
        event = {
            "session_id": data.get("session_id", ""),
            "command_id": data.get("command_id", ""),
            "operation_id": data.get("operation_id", ""),
            "turn_id": data.get("turn_id", ""),
            "delta": data.get("delta", ""),
            "seq": data.get("seq", 0),
            "at_version": data.get("at_version", 0),
            "revision": data.get("revision", 0),
            "done": data.get("done", False),
            "text_bytes": data.get("text_bytes", 0),
        }
        execution = _public_execution(data.get("execution"))
        if execution is not None:
            event["execution"] = execution
        cards = data.get("cards")
        if cards:
            event["cards"] = cards
        return kind, event
    if kind == "conversation_item_appended":
        return kind, {
            "session_id": data.get("session_id", ""),
            "command_id": data.get("command_id", ""),
            "item": data.get("item"),
        }
    if kind == "reasoning":
        return kind, {
            "session_id": data.get("session_id", ""),
            "operation_id": data.get("operation_id", ""),
            "at_version": data.get("at_version", 0),
            "revision": data.get("revision", 0),
            "delta": data.get("delta", ""),
        }
    if kind == "progress":
        return kind, {
            "session_id": data.get("session_id", ""),
            "operation_id": data.get("operation_id", ""),
            "at_version": data.get("at_version", 0),
            "revision": data.get("revision", 0),
            "status": data.get("status", "running"),
            "activity": _public_activity(data.get("activity")),
        }
    if kind == "command_finished":
        event = {
            **_public_session_view(data, include_last_command_id=False),
            "command_id": data.get("command_id", ""),
        }
        if data.get("post_canvas_action_id") is not None:
            event["post_canvas_action_id"] = data["post_canvas_action_id"]
        return kind, event
    return "error", _error_event(data, "Builder command failed")


class _ClosingFrameStream:
    """Iterator over SSE frames that guarantees ``subscription`` is closed when the
    WSGI server closes the response body -- INCLUDING when the body is never
    iterated. A bare generator cannot: its ``finally`` (which closes the
    subscription) does not run if the generator was never started, so a response
    dropped before its first frame (client aborted, or an after_request/teardown
    error on the streaming response) would leak the eagerly-activated pub/sub
    connection + listener thread. ``close()`` here closes the subscription
    directly (idempotent), so it fires regardless of iteration -- and the WSGI
    spec requires the server to call ``close()`` on the response iterable even on
    an early disconnect."""

    def __init__(self, frames: Generator[str, None, None], subscription) -> None:
        self._frames = frames
        self._subscription = subscription

    def __iter__(self) -> Iterator[str]:
        return self

    def __next__(self) -> str:
        return next(self._frames)

    def close(self) -> None:
        try:
            self._frames.close()  # runs the inner generator's finally when it started
        finally:
            if self._subscription is not None:
                self._subscription.close()  # idempotent; covers the never-started case


def stream_advance_frames(
    view_dict: dict,
    subscription,
    expect_advance: bool,
    *,
    emit_command_finished_when_settled: bool = False,
    emit_command_started: bool = True,
    command_id: str = "",
    initial_items: Sequence[ConversationItem] = (),
) -> Iterator[str]:
    """Emit a bounded command handshake, then relay incremental progress.

    The handshake and terminal projection intentionally exclude conversation
    history. Durable items are relayed one at a time; ``initial_items`` covers
    rows created synchronously before the subscription/worker starts. Clients
    use the JSON conversation endpoint only when the terminal sequence
    watermark exposes a missing event. Settle-only calls yield just the
    handshake unless ``emit_command_finished_when_settled`` is requested. The
    stream is bounded by ``_MAX_STREAM_SECONDS``.

    Returns a ``_ClosingFrameStream`` (not a bare generator) so the eagerly
    activated ``subscription`` is closed even when the WSGI server closes the
    response body without ever iterating it -- see _ClosingFrameStream."""

    def _frames() -> Generator[str, None, None]:
        try:
            if emit_command_started:
                yield _event_frame(
                    "command_started",
                    {
                        "session_id": view_dict.get("session_id", ""),
                        "command_id": command_id,
                        "version": view_dict.get("version", 0),
                        "phase": view_dict.get("phase", "understand"),
                        "run_status": "processing" if expect_advance else view_dict.get("run_status", "processing"),
                    },
                )
            for item in initial_items:
                if item.kind == "assistant_turn":
                    continue
                yield _event_frame(
                    "conversation_item_appended",
                    {
                        "session_id": view_dict.get("session_id", ""),
                        "command_id": command_id,
                        "item": dataclasses.asdict(item),
                    },
                )
            if not expect_advance:
                if emit_command_finished_when_settled:
                    yield _event_frame(
                        "command_finished",
                        {
                            **_public_session_view(view_dict, include_last_command_id=False),
                            "command_id": command_id,
                        },
                    )
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
                progress_event = _progress_event(raw)
                if progress_event is None:
                    continue
                kind, data = progress_event
                yield _event_frame(kind, data)
                if kind in _TERMINAL_KINDS:
                    return
            yield _event_frame(
                "error",
                {
                    "code": "timeout",
                    "message": "Builder operation timed out",
                    "session_id": view_dict.get("session_id"),
                    "command_id": command_id,
                },
            )
        finally:
            if subscription is not None:
                subscription.close()

    return _ClosingFrameStream(_frames(), subscription)
