from __future__ import annotations

import json
import logging
from collections.abc import Generator, Iterable, Mapping
from typing import Any, override

from flask import Response, request
from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.oauth_bearer import Scope
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.human_input import stringify_form_default_values
from controllers.common.human_input_v2_errors import (
    HumanInputV2AlreadySubmittedError,
    HumanInputV2ExpiredError,
    HumanInputV2InvalidInputError,
    HumanInputV2WorkflowNotActiveError,
    form_http_error,
)
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import HumanInputFormNotFound, RecipientSurfaceMismatch
from controllers.openapi._files import end_read_transaction, merge_files
from controllers.openapi._hints import attach_stream_hints
from controllers.openapi._models import (
    FormSubmitResponse,
    Hint,
    HumanInputFormDefinitionResponse,
    OpenApiFormSubmitPayload,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import PathParam, load_app
from controllers.openapi.auth.requirements import (
    CheckAppAccess,
    CheckAppApiEnabled,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    Requirement,
)
from controllers.openapi.auth.subjects import AccountSubject, ExternalSsoSubject, Subject
from core.app.entities.task_entities import HumanInputRequiredResponse, StreamEvent
from core.db.session_factory import session_factory
from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.human_input_policy import HumanInputSurface, is_recipient_type_allowed_for_surface
from factories.human_input_v2_form_presentation import build_form_presentation
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import extract_remote_ip, to_timestamp
from models.enums import CreatorUserRole
from models.model import App
from services.human_input_service import FormNotFoundError, HumanInputService
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
    WebAppFormActor,
)

logger = logging.getLogger(__name__)


class CheckFormSurface(Requirement):
    """Keep the legacy recipient-surface policy before a v1 handler runs.

    V2 tokens are absent from the legacy store; their app and exact actor are
    authorized by the v2 submission service. This feature-owned requirement
    keeps the auth layer independent of Human Input storage and semantics.

    A form the caller could not have found anyway — missing, or belonging to
    another app — is left to the handler's own 404: answering 403 here would tell
    an outsider the form token exists.
    """

    @override
    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        form_token = ctx.view_args[PathParam.FORM_TOKEN]
        app = load_app(ctx)
        # `HumanInputService` takes an engine or a maker, never a `Session`, so this
        # read is a separate transaction from the handler's — as it was before the move.
        form = HumanInputService(session_factory.get_session_maker()).get_form_by_token(form_token)
        if form is None or form.app_id != app.id or form.tenant_id != app.tenant_id:
            return
        if not is_recipient_type_allowed_for_surface(form.recipient_type, HumanInputSurface.OPENAPI):
            raise RecipientSurfaceMismatch()


def _jsonify_form_definition(form) -> Response:
    definition_payload = form.get_definition().model_dump()
    payload = {
        "form_content": definition_payload["rendered_content"],
        "inputs": definition_payload["inputs"],
        "resolved_default_values": stringify_form_default_values(definition_payload["default_values"]),
        "user_actions": definition_payload["user_actions"],
        "expiration_time": to_timestamp(form.expiration_time),
    }
    return Response(json.dumps(payload, ensure_ascii=False), mimetype="application/json")


def _ensure_form_belongs_to_app(form, app_model: App) -> None:
    if form.app_id != app_model.id or form.tenant_id != app_model.tenant_id:
        raise HumanInputFormNotFound()


def _v2_actor(ctx: Context) -> AccountId | WebAppFormActor:
    """Project the admitted caller and app into an exact v2 approval identity."""
    if ctx.subject.caller_role is CreatorUserRole.ACCOUNT:
        return AccountId(ctx.account.id)
    return WebAppFormActor(tenant_id=TenantId(ctx.app.tenant_id), app_id=ctx.app.id, end_user_id=ctx.end_user.id)


def _v2_form_error(error: HumanInputFormError) -> BaseHTTPException | HumanInputFormNotFound:
    """Keep OpenAPI's opaque token error while exposing actionable v2 state errors."""
    if error.code is HumanInputFormErrorCode.NOT_FOUND:
        return HumanInputFormNotFound()
    return form_http_error(error, message="The approval could not be accepted.")


def _form_submit_response(*, app_id: str, workflow_run_id: str | None) -> FormSubmitResponse:
    """Return the existing follow-run hint for a committed runtime submission."""
    if workflow_run_id is None:
        return FormSubmitResponse()
    # `workflow_events` imports this module for `with_form_hints`.
    from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi

    return FormSubmitResponse(
        hints=[
            Hint(
                summary="Follow the resumed run",
                op=op_of(OpenApiWorkflowEventsApi.get),
                input={
                    "app_id": app_id,
                    "run_id": workflow_run_id,
                    "include_state_snapshot": True,
                    "continue_on_pause": False,
                },
            )
        ]
    )


@openapi_ns.route("/apps/<string:app_id>/human-input-forms/<string:form_token>")
class OpenApiWorkflowHumanInputFormApi(Resource):
    @endpoint(
        op="describe.run.form",
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        summary="Read a human-input form",
        examples=(
            Example(
                title="Read the form a paused run is waiting on",
                input={"app_id": "<app_id>", "form_token": "<form_token>"},
            ),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_RUN),
            CheckAppAccess(),
            CheckFormSurface(),
        ),
        returns=(200, HumanInputFormDefinitionResponse, "Form definition"),
    )
    @error_responses(HumanInputV2AlreadySubmittedError, HumanInputV2ExpiredError)
    def get(self, ctx: Context, app_id: str, form_token: str):
        service = HumanInputService(session_factory.get_session_maker())
        form = service.get_form_by_token(form_token)
        if form is None:
            v2_service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
            try:
                v2_form = v2_service.get_openapi_form(
                    actor=_v2_actor(ctx), form_token=form_token, ip_address=extract_remote_ip(request) or None
                )
            except HumanInputFormError as error:
                raise _v2_form_error(error) from error
            _ensure_form_belongs_to_app(v2_form, ctx.app)
            presentation = build_form_presentation(v2_form.resolved_form)
            return HumanInputFormDefinitionResponse(
                form_content=presentation.form_content,
                inputs=presentation.inputs,
                resolved_default_values=presentation.resolved_default_values,
                user_actions=presentation.user_actions,
                expiration_time=to_timestamp(min(v2_form.expiration_time, v2_form.global_timeout_deadline)),
            )

        _ensure_form_belongs_to_app(form, ctx.app)
        service.ensure_form_active(form)
        return _jsonify_form_definition(form)


@openapi_ns.route("/apps/<string:app_id>/human-input-forms/<string:form_token>:submit")
class OpenApiWorkflowHumanInputFormSubmitApi(Resource):
    @endpoint(
        op="submit.run.form",
        pat_policy=PersonalAccessTokenPolicy.RESOURCE_CALLS,
        kind=Kind.OBJECT,
        summary="Submit a human-input form",
        examples=(
            Example(
                title="Approve a paused run with a written comment",
                input={
                    "app_id": "<app_id>",
                    "form_token": "<form_token>",
                    "action": "approve",
                    "inputs": {"comment": "Looks good"},
                },
            ),
            Example(
                title="Submit a form answer that includes a local file",
                input={
                    "app_id": "<app_id>",
                    "form_token": "<form_token>",
                    "action": "submit",
                    "inputs": {},
                    "files": {"evidence": "./scan.png"},
                },
            ),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject, ExternalSsoSubject)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_RUN),
            CheckAppAccess(),
            CheckFormSurface(),
        ),
        body=OpenApiFormSubmitPayload,
        returns=(200, FormSubmitResponse, "Form submitted"),
    )
    @error_responses(
        HumanInputV2AlreadySubmittedError,
        HumanInputV2ExpiredError,
        HumanInputV2InvalidInputError,
        HumanInputV2WorkflowNotActiveError,
    )
    def post(self, ctx: Context, app_id: str, form_token: str, *, body: OpenApiFormSubmitPayload):
        service = HumanInputService(session_factory.get_session_maker())
        form = service.get_form_by_token(form_token)
        if form is None:
            v2_service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
            actor = _v2_actor(ctx)
            try:
                v2_form = v2_service.authorize_openapi_form(actor=actor, form_token=form_token)
                _ensure_form_belongs_to_app(v2_form, ctx.app)
                if body.files:
                    end_read_transaction(ctx.session)
                inputs = merge_files(body.inputs, body.files, ctx.caller)
                submitted_form = v2_service.submit_openapi_form(
                    actor=actor, form_token=form_token, action=body.action, inputs=inputs
                )
            except HumanInputFormError as error:
                raise _v2_form_error(error) from error
            return _form_submit_response(app_id=ctx.app.id, workflow_run_id=submitted_form.workflow_run_id)

        _ensure_form_belongs_to_app(form, ctx.app)

        submission_user_id: str | None = None
        submission_end_user_id: str | None = None
        if ctx.subject.caller_role is CreatorUserRole.ACCOUNT:
            submission_user_id = ctx.account.id
        else:
            submission_end_user_id = ctx.end_user.id

        if form.recipient_type is None:
            logger.warning("Recipient type is None for form, form_token=%s", form_token)
            raise BadRequest("Form recipient type is invalid")

        if body.files:
            end_read_transaction(ctx.session)
        inputs = merge_files(body.inputs, body.files, ctx.caller)

        try:
            service.submit_form_by_token(
                recipient_type=form.recipient_type,
                form_token=form_token,
                selected_action_id=body.action,
                form_data=inputs,
                submission_user_id=submission_user_id,
                submission_end_user_id=submission_end_user_id,
            )
        except FormNotFoundError as caught_error:
            raise HumanInputFormNotFound() from caught_error

        return _form_submit_response(app_id=ctx.app.id, workflow_run_id=form.workflow_run_id)


def form_hints(*, op: str, app_id: str, response: HumanInputRequiredResponse) -> list[Hint]:
    """One hint per action button of a paused form, its `inputs` blanked to the form's fields."""

    data = response.data
    if not data.form_token:
        return []
    fields = [field.model_dump(mode="json") for field in data.inputs]
    blank = {field.output_variable_name: None for field in data.inputs}
    return [
        Hint(
            summary=action.title or action.id,
            op=op,
            input={"app_id": app_id, "form_token": data.form_token, "action": action.id, "inputs": dict(blank)},
            form=fields,
        )
        for action in data.actions
    ]


def with_form_hints(events: Iterable[str], *, app_id: str) -> Generator[str]:
    """A run stream whose `human_input_required` events carry hints that target the submit route above."""

    op = op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)

    def build(event: Mapping[str, Any]) -> list[Hint]:
        return form_hints(op=op, app_id=app_id, response=HumanInputRequiredResponse.model_validate(event))

    return attach_stream_hints(events, event=StreamEvent.HUMAN_INPUT_REQUIRED.value, build=build)
