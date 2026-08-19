"""Console HTTP surface for the workflow copilot (P3c) — JSON routes.

Flask-RESTX resources under /console/api/workflow-copilot/*, matching the
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
above ``@workflow_copilot_required``) contributes the positional argument
closest to ``self``; the one above it (``@with_current_user``) contributes
the next one. URL path parameters (e.g. ``session_id``) are untouched by
either decorator and keep arriving as keyword arguments from Flask-RESTX's
routing. ``workflow_copilot_required`` sits directly below
``@with_current_tenant_id`` in the stack, so it receives ``current_tenant_id``
positionally (as the argument right after ``self``), not as a keyword-only
argument.
"""

import functools
from collections.abc import Callable

from flask import Response, request
from flask_restx import Resource

from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.workflow_copilot.models import Action, Actor
from libs.login import login_required
from services.feature_service import FeatureService
from services.workflow_copilot import progress_bus
from services.workflow_copilot.wiring import (
    build_service,
    copilot_error_response,
    session_view_to_dict,
    stream_frames,
)

from . import console_ns


def workflow_copilot_required(func: Callable) -> Callable:
    @functools.wraps(func)
    def wrapper(self, current_tenant_id: str, *args, **kwargs):
        if not FeatureService.get_features(current_tenant_id).workflow_copilot_enabled:
            return {"code": "feature_unavailable"}, 403
        return func(self, current_tenant_id, *args, **kwargs)

    return wrapper


def _actor(current_user, current_tenant_id: str) -> Actor:
    return Actor(account_id=current_user.id, tenant_id=current_tenant_id)


def _respond(fn: Callable[[], object]) -> tuple[dict, int]:
    """Run a usecase call, serialize its SessionView, map known copilot errors
    to (body, status). Unknown exceptions propagate to Flask's error handler."""
    try:
        return session_view_to_dict(fn()), 200
    except Exception as exc:  # re-raised below if not a known copilot error
        mapped = copilot_error_response(exc)
        if mapped is None:
            raise
        return mapped


def _create(body, actor: Actor) -> tuple[dict, int]:
    if not isinstance(body, dict):
        return {"code": "bad_request"}, 400
    result, status = _respond(
        lambda: build_service().create_fix_session(
            app_id=body.get("app_id", ""),
            actor=actor,
            failed_run_id=body.get("failed_run_id") or None,
            checklist_errors=body.get("checklist_errors") or None,
        )
    )
    # create returns 201 on success; map-through keeps error statuses.
    return result, (201 if status == 200 else status)


def _view(session_id: str, actor: Actor) -> tuple[dict, int]:
    return _respond(lambda: build_service().get_session_view(session_id, actor))


def _action(session_id: str, body, actor: Actor) -> tuple[dict, int]:
    if not isinstance(body, dict):
        return {"code": "bad_request"}, 400
    action = Action(
        kind=body.get("kind", ""),
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


@console_ns.route("/workflow-copilot/sessions")
class WorkflowCopilotSessionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @workflow_copilot_required
    def post(self, current_tenant_id, current_user):
        return _create(request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/workflow-copilot/sessions/<string:session_id>")
class WorkflowCopilotSessionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @workflow_copilot_required
    def get(self, current_tenant_id, current_user, session_id):
        return _view(session_id, _actor(current_user, current_tenant_id))


@console_ns.route("/workflow-copilot/sessions/<string:session_id>/actions")
class WorkflowCopilotActionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @workflow_copilot_required
    def post(self, current_tenant_id, current_user, session_id):
        return _action(session_id, request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/workflow-copilot/sessions/<string:session_id>/messages")
class WorkflowCopilotMessagesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @workflow_copilot_required
    def post(self, current_tenant_id, current_user, session_id):
        return _message(session_id, request.get_json(silent=True), _actor(current_user, current_tenant_id))


@console_ns.route("/workflow-copilot/sessions/<string:session_id>/stream")
class WorkflowCopilotStreamApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_current_tenant_id
    @workflow_copilot_required
    def get(self, current_tenant_id, current_user, session_id):
        actor = _actor(current_user, current_tenant_id)
        # owner check + authoritative snapshot; non-owner/missing → NotFoundError → 404 (generic)
        try:
            view = build_service().get_session_view(session_id, actor)
        except Exception as exc:  # re-raised below if not a known copilot error
            mapped = copilot_error_response(exc)
            if mapped is None:
                raise
            return mapped
        subscription = progress_bus.subscribe(session_id)
        return Response(
            stream_frames(session_view_to_dict(view), subscription),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )
