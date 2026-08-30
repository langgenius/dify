"""Console HTTP surface for the Dify Builder (P3c) — JSON routes.

Flask-RESTX resources under /console/api/dify-builder/*, matching the
retired Go enterprise transport byte-for-byte so cutover is a frontend
base-path swap. Auth + CSRF come from the console guard stack (CSRF is enforced
inside login_required for every method); RBAC/authz is enforced here at the
boundary — the Celery advance task trusts the Actor. The route LOGIC lives in
undecorated module functions (_create/_view/_action/_message) so it is unit
testable without the Flask request stack; the Resource methods are thin
auth-wrappers.

Decorator injection contract (verified against controllers/console/wraps.py
and the multi-decorator precedent in controllers/console/app/workflow_comment.py,
e.g. ``def post(self, current_tenant_id, current_user, app_model, comment_id)``):
``@with_current_user`` and ``@with_current_tenant_id`` do NOT inject their
values as keyword arguments. Each calls its wrapped view as
``view(self, injected_value, *args, **kwargs)`` — i.e. it PREPENDS the value
as a positional argument immediately after ``self``. Stacking both means the
decorator closer to the function (here, ``@with_current_tenant_id``, directly
above ``@dify_builder_required``) contributes the positional argument
closest to ``self``; the one above it (``@with_current_user``) contributes
the next one. URL path parameters (e.g. ``session_id``) are untouched by
either decorator and keep arriving as keyword arguments from Flask-RESTX's
routing. ``dify_builder_required`` sits directly below
``@with_current_tenant_id`` in the stack, so it receives ``current_tenant_id``
positionally (as the argument right after ``self``), not as a keyword-only
argument.
"""

import functools
import logging
from collections.abc import Callable
from typing import Any, Literal

from flask import Response
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import EventStreamResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import (
    account_initialization_required,
    model_validate,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.dify_builder.models import Action, Actor
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from services.dify_builder import progress_bus
from services.dify_builder.service import SessionView, resolve_action_kind
from services.dify_builder.wiring import (
    build_service,
    dify_builder_error_response,
    session_view_to_dict,
    stream_frames,
)
from services.feature_service import FeatureService

from . import console_ns

logger = logging.getLogger(__name__)


class DifyBuilderModelConfigPayload(BaseModel):
    provider: str
    name: str
    mode: str = ""
    completion_params: dict[str, Any] = Field(default_factory=dict)


class DifyBuilderChecklistErrorPayload(BaseModel):
    node_id: str = ""
    node_type: str = ""
    title: str = ""
    messages: list[str] = Field(default_factory=list)
    unconnected: bool = False
    plugin_missing: bool = False


class DifyBuilderCreateSessionPayload(BaseModel):
    app_id: str
    scenario: Literal["build", "edit", "fix"] = "fix"
    goal_text: str = ""
    failed_run_id: str | None = None
    checklist_errors: list[DifyBuilderChecklistErrorPayload] = Field(default_factory=list)
    selected_model: DifyBuilderModelConfigPayload | None = Field(default=None, alias="model_config")


class DifyBuilderActionPayload(BaseModel):
    action_id: str | None = None
    kind: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    base_version: int


class DifyBuilderMessagePayload(BaseModel):
    text: str
    base_version: int


class DifyBuilderAgentPingPayload(BaseModel):
    selected_model: DifyBuilderModelConfigPayload | None = Field(default=None, alias="model_config")


class DifyBuilderConversationItemResponse(ResponseModel):
    seq: int
    kind: str
    payload: dict[str, Any]
    at_version: int


class DifyBuilderActionResponse(ResponseModel):
    id: str
    label: str
    kind: str
    payload_kind: str | None = None
    next_state: str | None = None
    canvas_event: str | None = None


class DifyBuilderCheckpointResponse(ResponseModel):
    checkpoint_id: str
    label: str
    created_at: str


class DifyBuilderRecoveryResponse(ResponseModel):
    recovery_class: str
    message: str
    can_continue: bool
    can_restart: bool


class DifyBuilderSessionModelResponse(ResponseModel):
    provider: str
    name: str
    mode: str = ""
    completion_params: dict[str, Any] = Field(default_factory=dict)


class DifyBuilderSessionViewResponse(ResponseModel):
    session_id: str
    app_id: str
    version: int
    state: str
    canvas_read_only: bool
    run_status: str
    interrupted: bool
    conversation: list[DifyBuilderConversationItemResponse]
    entry_mode: str
    phase: str
    actions: list[DifyBuilderActionResponse]
    checkpoint: DifyBuilderCheckpointResponse | None = None
    recovery: DifyBuilderRecoveryResponse | None = None
    model: DifyBuilderSessionModelResponse | None = None


class DifyBuilderAgentPingResponse(ResponseModel):
    ok: bool
    model: dict[str, str] | None = None
    reply: str | None = None
    error: str | None = None


register_schema_models(
    console_ns,
    DifyBuilderCreateSessionPayload,
    DifyBuilderActionPayload,
    DifyBuilderMessagePayload,
    DifyBuilderAgentPingPayload,
)
register_response_schema_models(
    console_ns,
    DifyBuilderSessionViewResponse,
    DifyBuilderAgentPingResponse,
    EventStreamResponse,
)


def dify_builder_required(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(self, current_tenant_id: str, *args, **kwargs):
        if not FeatureService.get_features(current_tenant_id).dify_builder_enabled:
            return {"code": "feature_unavailable"}, 403
        return func(self, current_tenant_id, *args, **kwargs)

    return wrapper


def _actor(current_user, current_tenant_id: str) -> Actor:
    return Actor(account_id=current_user.id, tenant_id=current_tenant_id)


def _respond(fn: Callable[[], SessionView]) -> tuple[dict, int]:
    """Run a usecase call, serialize its SessionView, map known dify_builder errors
    to (body, status). Unknown exceptions propagate to Flask's error handler."""
    try:
        return dump_response(DifyBuilderSessionViewResponse, session_view_to_dict(fn())), 200
    except Exception as exc:  # re-raised below if not a known dify_builder error
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped


def _create(body, actor: Actor) -> tuple[dict, int]:
    if not isinstance(body, dict):
        return {"code": "bad_request"}, 400
    if body.get("scenario") == "build":
        result, status = _respond(
            lambda: build_service().create_build_session(
                app_id=body.get("app_id", ""),
                actor=actor,
                goal_text=body.get("goal_text", ""),
                model_config=body.get("model_config"),
            )
        )
    elif body.get("scenario") == "edit":
        result, status = _respond(
            lambda: build_service().create_edit_session(
                app_id=body.get("app_id", ""),
                actor=actor,
                model_config=body.get("model_config"),
            )
        )
    else:
        result, status = _respond(
            lambda: build_service().create_fix_session(
                app_id=body.get("app_id", ""),
                actor=actor,
                failed_run_id=body.get("failed_run_id") or None,
                checklist_errors=body.get("checklist_errors") or None,
                model_config=body.get("model_config"),
                goal_text=body.get("goal_text", ""),
            )
        )
    # create returns 201 on success; map-through keeps error statuses.
    return result, (201 if status == 200 else status)


def _view(session_id: str, actor: Actor) -> tuple[dict, int]:
    return _respond(lambda: build_service().get_session_view(session_id, actor))


def _action(session_id: str, body, actor: Actor) -> tuple[dict, int]:
    if not isinstance(body, dict):
        return {"code": "bad_request"}, 400
    raw = body.get("action_id") or body.get("kind", "")
    action = Action(
        kind=resolve_action_kind(raw),
        payload=body.get("payload") or {},
        base_version=int(body.get("base_version", 0)),
    )
    return _respond(lambda: build_service().submit_action(session_id, actor, action))


def _message(session_id: str, body, actor: Actor) -> tuple[dict, int]:
    if not isinstance(body, dict):
        return {"code": "bad_request"}, 400
    return _respond(
        lambda: build_service().submit_message(
            session_id, actor, body.get("text", ""), int(body.get("base_version", 0))
        )
    )


def _ping(body, actor: Actor) -> tuple[dict, int]:
    model_config = body.get("model_config") if isinstance(body, dict) else None
    try:
        from services.dify_builder.agent.ping import ping_model

        return ping_model(actor.tenant_id, model_config), 200
    except Exception as exc:  # a health check returns ok:false rather than 500
        logger.warning("dify_builder agent ping failed: %s", exc)
        return {"ok": False, "error": str(exc)}, 200


def _stream(session_id: str, actor: Actor):
    # Subscribe before reading the authoritative snapshot so no progress
    # event can land in the gap between those two operations.
    subscription = progress_bus.subscribe(session_id)
    try:
        view = build_service().get_session_view(session_id, actor)
    except Exception as exc:  # re-raised below if not a known dify_builder error
        subscription.close()
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped
    return Response(
        stream_frames(session_view_to_dict(view), subscription),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@console_ns.route("/dify-builder/sessions")
class DifyBuilderSessionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @model_validate(DifyBuilderCreateSessionPayload)
    @console_ns.expect(console_ns.models[DifyBuilderCreateSessionPayload.__name__])
    @console_ns.response(201, "Session created", console_ns.models[DifyBuilderSessionViewResponse.__name__])
    def post(self, payload, current_tenant_id, current_user):
        return _create(payload.model_dump(mode="json", by_alias=True), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>")
class DifyBuilderSessionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @console_ns.response(200, "Session view", console_ns.models[DifyBuilderSessionViewResponse.__name__])
    def get(self, current_tenant_id, current_user, session_id):
        return _view(session_id, _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/actions")
class DifyBuilderActionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @model_validate(DifyBuilderActionPayload)
    @console_ns.expect(console_ns.models[DifyBuilderActionPayload.__name__])
    @console_ns.response(200, "Session view", console_ns.models[DifyBuilderSessionViewResponse.__name__])
    def post(self, payload, current_tenant_id, current_user, session_id):
        return _action(session_id, payload.model_dump(mode="json"), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/messages")
class DifyBuilderMessagesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @model_validate(DifyBuilderMessagePayload)
    @console_ns.expect(console_ns.models[DifyBuilderMessagePayload.__name__])
    @console_ns.response(200, "Session view", console_ns.models[DifyBuilderSessionViewResponse.__name__])
    def post(self, payload, current_tenant_id, current_user, session_id):
        return _message(session_id, payload.model_dump(mode="json"), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/stream")
class DifyBuilderStreamApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @console_ns.response(200, "SSE event stream", console_ns.models[EventStreamResponse.__name__])
    def get(self, current_tenant_id, current_user, session_id):
        return _stream(session_id, _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/agent/ping")
class DifyBuilderAgentPingApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    @model_validate(DifyBuilderAgentPingPayload)
    @console_ns.expect(console_ns.models[DifyBuilderAgentPingPayload.__name__])
    @console_ns.response(200, "Agent status", console_ns.models[DifyBuilderAgentPingResponse.__name__])
    def post(self, payload, current_tenant_id, current_user):
        return _ping(payload.model_dump(mode="json", by_alias=True), _actor(current_user, current_tenant_id))
