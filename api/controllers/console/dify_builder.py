"""Console HTTP surface for Dify Builder sessions and command streams.

Flask-RESTX resources under /console/api/dify-builder/*. Auth + CSRF come from
the console guard stack (CSRF is enforced inside login_required for every
method); RBAC/authz is enforced here at the
boundary — the Celery advance task trusts the Actor. The route LOGIC lives in
undecorated module functions (_create/_get_session/_conversation/_stream/
_action/_message) so they are unit testable without the Flask request stack;
the Resource methods are thin auth-wrappers.

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

import dataclasses
import functools
import logging
from collections.abc import Callable, Iterator

from flask import Response, request
from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
    typed_event_stream_response,
)
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.dify_builder.models import Action, Actor
from libs.helper import dump_response
from libs.login import login_required
from services.dify_builder import progress_bus
from services.dify_builder.service import resolve_action_kind
from services.dify_builder.wiring import (
    build_service,
    dify_builder_error_response,
    session_view_to_dict,
    stream_advance_frames,
)
from services.feature_service import FeatureService

from . import console_ns
from .dify_builder_fields import (
    DifyBuilderConversationListQuery,
    DifyBuilderConversationPageResponse,
    DifyBuilderCreateBuildSessionPayload,
    DifyBuilderCreateChecklistFixSessionPayload,
    DifyBuilderCreateEditSessionPayload,
    DifyBuilderCreateFixSessionPayload,
    DifyBuilderCreateSessionPayload,
    DifyBuilderErrorResponse,
    DifyBuilderSessionViewResponse,
    DifyBuilderStreamEventResponse,
    DifyBuilderSubmitActionPayload,
    DifyBuilderSubmitMessagePayload,
)

logger = logging.getLogger(__name__)

register_schema_models(
    console_ns,
    DifyBuilderCreateSessionPayload,
    DifyBuilderConversationListQuery,
    DifyBuilderSubmitActionPayload,
    DifyBuilderSubmitMessagePayload,
)
register_response_schema_models(
    console_ns,
    DifyBuilderConversationPageResponse,
    DifyBuilderSessionViewResponse,
    DifyBuilderStreamEventResponse,
    DifyBuilderErrorResponse,
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


_SSE_HEADERS = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}


def _stream_response(make_generator: Callable[[], Iterator[str]]) -> Response | tuple[dict, int]:
    """Call make_generator() (which runs the service's eager validate+subscribe+dispatch
    and returns an SSE generator); map pre-flight errors to an HTTP tuple; else return
    the stream. Unknown exceptions propagate to Flask's error handler."""
    try:
        generator = make_generator()
    except Exception as exc:  # re-raised below if not a known dify_builder error
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped
    return Response(generator, mimetype="text/event-stream", headers=_SSE_HEADERS)


def _create(body, actor: Actor) -> Response | tuple[dict, int]:
    try:
        payload = DifyBuilderCreateSessionPayload.model_validate(body).root
    except ValidationError:
        return {"code": "bad_request"}, 400

    model_config = dataclasses.asdict(payload.model_config_data) if payload.model_config_data else None
    if isinstance(payload, DifyBuilderCreateBuildSessionPayload):
        return _stream_response(
            lambda: build_service().create_build_session_stream(
                app_id=payload.app_id,
                actor=actor,
                goal_text=payload.goal_text,
                model_config=model_config,
            )
        )
    if isinstance(payload, DifyBuilderCreateEditSessionPayload):
        return _stream_response(
            lambda: build_service().create_edit_session_stream(
                app_id=payload.app_id,
                actor=actor,
                model_config=model_config,
                goal_text=payload.goal_text,
            )
        )
    if isinstance(payload, DifyBuilderCreateChecklistFixSessionPayload):
        return _stream_response(
            lambda: build_service().create_fix_session_stream(
                app_id=payload.app_id,
                actor=actor,
                failed_run_id=payload.failed_run_id,
                checklist_errors=[error.model_dump() for error in payload.checklist_errors],
                model_config=model_config,
            )
        )
    if isinstance(payload, DifyBuilderCreateFixSessionPayload):
        return _stream_response(
            lambda: build_service().create_fix_session_stream(
                app_id=payload.app_id,
                actor=actor,
                failed_run_id=payload.failed_run_id,
                model_config=model_config,
            )
        )
    raise AssertionError(f"Unsupported Dify Builder create payload: {type(payload)}")


def _action(session_id: str, body, actor: Actor) -> Response | tuple[dict, int]:
    try:
        payload = DifyBuilderSubmitActionPayload.model_validate(body)
    except ValidationError:
        return {"code": "bad_request"}, 400
    action = Action(
        kind=resolve_action_kind(payload.action_id),
        payload=payload.payload,
        base_version=payload.base_version,
        base_app_revision=payload.base_app_revision,
    )
    return _stream_response(lambda: build_service().submit_action_stream(session_id, actor, action))


def _message(session_id: str, body, actor: Actor) -> Response | tuple[dict, int]:
    try:
        payload = DifyBuilderSubmitMessagePayload.model_validate(body)
    except ValidationError:
        return {"code": "bad_request"}, 400
    return _stream_response(
        lambda: build_service().submit_message_stream(
            session_id,
            actor,
            payload.text,
            payload.base_version,
            payload.client_turn_id,
        )
    )


def _get_session(session_id: str, actor: Actor) -> dict | tuple[dict, int]:
    try:
        view = build_service().get_session_view(session_id, actor)
    except Exception as exc:
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped
    return dump_response(DifyBuilderSessionViewResponse, view)


def _conversation(session_id: str, query_args, actor: Actor) -> dict | tuple[dict, int]:
    try:
        query = DifyBuilderConversationListQuery.model_validate(query_args)
    except ValidationError:
        return {"code": "bad_request"}, 400
    try:
        page = build_service().get_conversation_page(
            session_id,
            actor,
            limit=query.limit,
            before_seq=query.before_seq,
            after_seq=query.after_seq,
        )
    except Exception as exc:
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped
    return dump_response(DifyBuilderConversationPageResponse, page)


def _stream(session_id: str, actor: Actor) -> Response | tuple[dict, int]:
    service = build_service()
    try:
        service.authorize_session(session_id, actor)
    except Exception as exc:
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped

    # Subscribe before reading the bounded state. This closes the race where
    # an advance could settle between the read and subscription. Conversation
    # rows are recovered independently through the JSON pagination endpoint.
    subscription = progress_bus.subscribe(session_id)
    try:
        view = service.get_session_view(session_id, actor)
    except Exception as exc:  # re-raised below if not a known dify_builder error
        subscription.close()
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped

    return Response(
        stream_advance_frames(
            session_view_to_dict(view),
            subscription,
            expect_advance=view.run_status in {"thinking", "executing"} and not view.interrupted,
        ),
        mimetype="text/event-stream",
        headers=_SSE_HEADERS,
    )


def _ping(body, actor: Actor) -> tuple[dict, int]:
    model_config = body.get("model_config") if isinstance(body, dict) else None
    try:
        from services.dify_builder.agent.ping import ping_model

        return ping_model(actor.tenant_id, model_config), 200
    except Exception as exc:  # a health check returns ok:false rather than 500
        logger.warning("dify_builder agent ping failed: %s", exc)
        return {"ok": False, "error": str(exc)}, 200


@console_ns.route("/dify-builder/sessions")
class DifyBuilderSessionsApi(Resource):
    @typed_event_stream_response(console_ns, DifyBuilderStreamEventResponse)
    @console_ns.expect(console_ns.models[DifyBuilderCreateSessionPayload.__name__])
    @console_ns.response(
        200,
        "Dify Builder event stream",
        console_ns.models[DifyBuilderStreamEventResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def post(self, current_tenant_id, current_user):
        return _create(request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>")
class DifyBuilderSessionApi(Resource):
    @console_ns.response(
        200,
        "Dify Builder session state",
        console_ns.models[DifyBuilderSessionViewResponse.__name__],
    )
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def get(self, current_tenant_id, current_user, session_id):
        return _get_session(session_id, _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/conversation")
class DifyBuilderConversationApi(Resource):
    @console_ns.doc(params=query_params_from_model(DifyBuilderConversationListQuery))
    @console_ns.response(
        200,
        "Dify Builder conversation page",
        console_ns.models[DifyBuilderConversationPageResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def get(self, current_tenant_id, current_user, session_id):
        return _conversation(
            session_id,
            request.args.to_dict(flat=True),
            _actor(current_user, current_tenant_id),
        )


@console_ns.route("/dify-builder/sessions/<string:session_id>/stream")
class DifyBuilderSessionStreamApi(Resource):
    @typed_event_stream_response(console_ns, DifyBuilderStreamEventResponse)
    @console_ns.response(
        200,
        "Dify Builder reconnect event stream",
        console_ns.models[DifyBuilderStreamEventResponse.__name__],
    )
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def get(self, current_tenant_id, current_user, session_id):
        return _stream(session_id, _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/actions")
class DifyBuilderActionsApi(Resource):
    @typed_event_stream_response(console_ns, DifyBuilderStreamEventResponse)
    @console_ns.expect(console_ns.models[DifyBuilderSubmitActionPayload.__name__])
    @console_ns.response(
        200,
        "Dify Builder event stream",
        console_ns.models[DifyBuilderStreamEventResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Session conflict", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def post(self, current_tenant_id, current_user, session_id):
        return _action(session_id, request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/messages")
class DifyBuilderMessagesApi(Resource):
    @typed_event_stream_response(console_ns, DifyBuilderStreamEventResponse)
    @console_ns.expect(console_ns.models[DifyBuilderSubmitMessagePayload.__name__])
    @console_ns.response(
        200,
        "Dify Builder event stream",
        console_ns.models[DifyBuilderStreamEventResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Session conflict", console_ns.models[DifyBuilderErrorResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def post(self, current_tenant_id, current_user, session_id):
        return _message(session_id, request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/agent/ping")
class DifyBuilderAgentPingApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @dify_builder_required
    def post(self, current_tenant_id, current_user):
        return _ping(request.get_json(silent=True), _actor(current_user, current_tenant_id))
