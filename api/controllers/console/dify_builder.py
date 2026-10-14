"""Console HTTP surface for Dify Builder sessions and command streams.

Flask-RESTX resources under /console/api/dify-builder/*. Auth + CSRF come from
the console guard stack (CSRF is enforced inside login_required for every
method); RBAC/authz is enforced here at the
boundary — the Celery advance task trusts the Actor. The route LOGIC lives in
undecorated module functions (_create/_get_session/_conversation/_stream/
_action/_message and the real-call consent _prepare_real_call/
_confirm_real_call/_execute_real_call/_get_real_call) so they are unit
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

import dataclasses
import functools
import logging
from collections.abc import Callable, Iterator
from typing import cast

from flask import Flask, Response, current_app, request
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy.orm import scoped_session
from werkzeug.exceptions import BadRequest
from werkzeug.local import LocalProxy

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
from core.dify_builder.real_call_consent import ConsentReceipt
from extensions.ext_database import db
from libs.helper import dump_response
from libs.login import login_required
from services.dify_builder import progress_bus, progress_snapshot
from services.dify_builder.service import resolve_submitted_action
from services.dify_builder.wiring import (
    build_real_call_consent_service,
    build_service,
    dify_builder_error_response,
    real_call_error_response,
    session_view_to_dict,
    stream_advance_frames,
)
from services.feature_service import FeatureService

from . import console_ns
from .dify_builder_fields import (
    DifyBuilderConfirmRealCallPayload,
    DifyBuilderConversationListQuery,
    DifyBuilderConversationPageResponse,
    DifyBuilderCreateBuildSessionPayload,
    DifyBuilderCreateChecklistFixSessionPayload,
    DifyBuilderCreateEditSessionPayload,
    DifyBuilderCreateFixSessionPayload,
    DifyBuilderCreateSessionPayload,
    DifyBuilderErrorResponse,
    DifyBuilderExecuteRealCallPayload,
    DifyBuilderPrepareRealCallPayload,
    DifyBuilderRealCallConsentResponse,
    DifyBuilderRealCallForbiddenResponse,
    DifyBuilderRealCallRefusalResponse,
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
    DifyBuilderPrepareRealCallPayload,
    DifyBuilderConfirmRealCallPayload,
    DifyBuilderExecuteRealCallPayload,
)
register_response_schema_models(
    console_ns,
    DifyBuilderConversationPageResponse,
    DifyBuilderSessionViewResponse,
    DifyBuilderStreamEventResponse,
    DifyBuilderErrorResponse,
    DifyBuilderRealCallConsentResponse,
    DifyBuilderRealCallRefusalResponse,
    DifyBuilderRealCallForbiddenResponse,
)


def dify_builder_required(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(self, current_tenant_id: str, *args, **kwargs):
        if not FeatureService.get_features(current_tenant_id).dify_builder_enabled:
            return {"code": "feature_unavailable"}, 403
        return func(self, current_tenant_id, *args, **kwargs)

    return wrapper


def _require_no_request_sql() -> None:
    """Refuse a real-call request whose request-scoped session holds a transaction.

    The feature check's billing/enterprise calls and, inside the consent owner
    and dispatch coordinator, external metadata reads, the Redis lease and the
    enqueue must not run under an open request transaction. This guard never
    ends one: a transaction it did not begin may hold another owner's flushed
    or Core writes, which neither a rollback nor a commit may decide here.
    """
    session = db.session() if isinstance(db.session, scoped_session) else db.session
    if session.in_transaction() or session.new or session.dirty or session.deleted:
        raise RuntimeError("real-call request holds an open request-scoped transaction")


def real_call_without_request_sql[**P, R](func: Callable[P, R]) -> Callable[P, R]:
    """Require that the authenticated wrappers left no request-scoped SQL before any real-call work."""

    @functools.wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        _require_no_request_sql()
        return func(*args, **kwargs)

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
                derive_app_name=payload.derive_app_name,
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
        kind=resolve_submitted_action(payload.action_id, payload.payload),
        receipt_snapshot=payload.receipt_snapshot.model_dump() if payload.receipt_snapshot is not None else None,
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
    return dump_response(DifyBuilderSessionViewResponse, session_view_to_dict(view))


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
        snapshot = (
            progress_snapshot.read(tenant_id=actor.tenant_id, session_id=session_id)
            if view.run_status == "processing" and not view.interrupted
            else None
        )
    except Exception as exc:  # re-raised below if not a known dify_builder error
        subscription.close()
        mapped = dify_builder_error_response(exc)
        if mapped is None:
            raise
        return mapped

    app = cast(LocalProxy[Flask], current_app)._get_current_object()

    def read_session_view() -> dict[str, object]:
        # Each heartbeat owns a short app context; the authenticated request
        # and its SQL session must not stay open while the stream waits.
        with app.app_context():
            return session_view_to_dict(service.get_session_view(session_id, actor))

    return Response(
        stream_advance_frames(
            session_view_to_dict(view),
            subscription,
            expect_advance=view.run_status == "processing" and not view.interrupted,
            emit_command_finished_when_settled=True,
            emit_command_started=False,
            command_id=view.last_command_id,
            read_session_view=read_session_view,
            initial_progress=snapshot,
        ),
        mimetype="text/event-stream",
        headers=_SSE_HEADERS,
    )


def _real_call_body() -> object:
    """JSON body of a consent POST, or ``None`` for a non-JSON or malformed request.

    ``None`` fails payload validation, so the route answers the fixed 400
    before any consent or dispatch work instead of a framework 415/400 body.
    """
    if not request.is_json:
        return None
    try:
        return console_ns.payload or {}
    except BadRequest:  # malformed JSON; parser text is never echoed
        return None


def _real_call_response(read_receipt: Callable[[], ConsentReceipt], status: int) -> tuple[dict, int]:
    """Serialize only the public receipt; map refusals to fixed codes, re-raise anything else."""
    try:
        receipt = read_receipt()
    except Exception as exc:  # re-raised below if not a known consent/dispatch refusal
        mapped = real_call_error_response(exc)
        if mapped is None:
            raise
        return mapped
    return dump_response(DifyBuilderRealCallConsentResponse, receipt), status


def _prepare_real_call(session_id: str, body: object, actor: Actor) -> tuple[dict, int]:
    """Freeze the binding and disclosure for review. Metadata only: nothing decrypts, refreshes or runs."""
    try:
        payload = DifyBuilderPrepareRealCallPayload.model_validate(body)
    except ValidationError:
        return {"code": "bad_request"}, 400
    return _real_call_response(
        lambda: build_real_call_consent_service().prepare(
            actor=actor,
            session_id=session_id,
            node_id=payload.node_id,
            test_input_id=payload.test_input_id,
            credential_id=payload.credential_id,
            at_version=payload.at_version,
            base_app_revision=payload.base_app_revision,
            idempotency_key=payload.idempotency_key,
        ),
        201,
    )


def _confirm_real_call(session_id: str, consent_id: str, body: object, actor: Actor) -> tuple[dict, int]:
    """Record one human decision; an identical replay returns the saved decision receipt. Never dispatches."""
    try:
        payload = DifyBuilderConfirmRealCallPayload.model_validate(body)
    except ValidationError:
        return {"code": "bad_request"}, 400
    return _real_call_response(
        lambda: build_real_call_consent_service().confirm(
            actor=actor,
            session_id=session_id,
            consent_id=consent_id,
            decision=payload.decision,
            scope_digest=payload.scope_digest,
            at_version=payload.at_version,
            idempotency_key=payload.idempotency_key,
        ),
        200,
    )


def _execute_real_call(session_id: str, consent_id: str, body: object, actor: Actor) -> tuple[dict, int]:
    """Launch a confirmed call through the existing confirmed dispatch coordinator.

    The coordinator holds the session's advance lease before the atomic
    reservation, enqueues the reserved command at most once and answers a
    matching duplicate with the current receipt.
    """
    try:
        payload = DifyBuilderExecuteRealCallPayload.model_validate(body)
    except ValidationError:
        return {"code": "bad_request"}, 400
    return _real_call_response(
        lambda: build_service().execute_confirmed_tool(
            session_id,
            actor,
            consent_id=consent_id,
            scope_digest=payload.scope_digest,
            at_version=payload.at_version,
            idempotency_key=payload.idempotency_key,
        ),
        202,
    )


def _get_real_call(session_id: str, consent_id: str, actor: Actor) -> tuple[dict, int]:
    """Current authorized receipt. Read only: never executes."""
    return _real_call_response(
        lambda: build_real_call_consent_service().get(actor=actor, session_id=session_id, consent_id=consent_id),
        200,
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


@console_ns.route("/dify-builder/sessions/<string:session_id>/real-call-consents")
class DifyBuilderRealCallConsentsApi(Resource):
    @console_ns.expect(console_ns.models[DifyBuilderPrepareRealCallPayload.__name__])
    @console_ns.response(
        201,
        "Real call consent prepared for review",
        console_ns.models[DifyBuilderRealCallConsentResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(403, "Access refused", console_ns.models[DifyBuilderRealCallForbiddenResponse.__name__])
    @console_ns.response(404, "Session not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Real call refused", console_ns.models[DifyBuilderRealCallRefusalResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @real_call_without_request_sql
    @dify_builder_required
    def post(self, current_tenant_id, current_user, session_id):
        return _prepare_real_call(session_id, _real_call_body(), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/real-call-consents/<string:consent_id>")
class DifyBuilderRealCallConsentApi(Resource):
    @console_ns.response(
        200,
        "Current real call consent receipt",
        console_ns.models[DifyBuilderRealCallConsentResponse.__name__],
    )
    @console_ns.response(403, "Access refused", console_ns.models[DifyBuilderRealCallForbiddenResponse.__name__])
    @console_ns.response(404, "Consent not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Real call refused", console_ns.models[DifyBuilderRealCallRefusalResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @real_call_without_request_sql
    @dify_builder_required
    def get(self, current_tenant_id, current_user, session_id, consent_id):
        return _get_real_call(session_id, consent_id, _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/real-call-consents/<string:consent_id>/confirm")
class DifyBuilderRealCallConsentConfirmApi(Resource):
    @console_ns.expect(console_ns.models[DifyBuilderConfirmRealCallPayload.__name__])
    @console_ns.response(
        200,
        "Saved decision receipt",
        console_ns.models[DifyBuilderRealCallConsentResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(403, "Access refused", console_ns.models[DifyBuilderRealCallForbiddenResponse.__name__])
    @console_ns.response(404, "Consent not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Real call refused", console_ns.models[DifyBuilderRealCallRefusalResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @real_call_without_request_sql
    @dify_builder_required
    def post(self, current_tenant_id, current_user, session_id, consent_id):
        return _confirm_real_call(session_id, consent_id, _real_call_body(), _actor(current_user, current_tenant_id))


@console_ns.route("/dify-builder/sessions/<string:session_id>/real-call-consents/<string:consent_id>/execute")
class DifyBuilderRealCallConsentExecuteApi(Resource):
    @console_ns.expect(console_ns.models[DifyBuilderExecuteRealCallPayload.__name__])
    @console_ns.response(
        202,
        "Current receipt of the reserved real call",
        console_ns.models[DifyBuilderRealCallConsentResponse.__name__],
    )
    @console_ns.response(400, "Invalid request", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(403, "Access refused", console_ns.models[DifyBuilderRealCallForbiddenResponse.__name__])
    @console_ns.response(404, "Consent not found", console_ns.models[DifyBuilderErrorResponse.__name__])
    @console_ns.response(409, "Real call refused", console_ns.models[DifyBuilderRealCallRefusalResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @with_current_tenant_id
    @real_call_without_request_sql
    @dify_builder_required
    def post(self, current_tenant_id, current_user, session_id, consent_id):
        return _execute_real_call(session_id, consent_id, _real_call_body(), _actor(current_user, current_tenant_id))


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
