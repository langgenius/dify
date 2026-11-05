from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Generator, Iterable, Mapping
from enum import StrEnum
from typing import Any, Final, override

from flask import Response
from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, HTTPException

from constants.oauth_bearer import Scope, SubjectType
from controllers.common.human_input import (
    stringify_form_default_values,
    v2_form_definition_response,
    viewer_ip_address,
)
from controllers.common.human_input_v2_errors import legacy_form_http_error
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission
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
    CheckRBACPermission,
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
from extensions.ext_database import db
from libs.helper import to_timestamp
from models.enums import CreatorUserRole
from models.model import App
from repositories.human_input_v2.form_repository import Form as V2Form
from services.human_input_service import FormNotFoundError, HumanInputService
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputSubmissionService,
    WebAppFormActor,
)

logger = logging.getLogger(__name__)


class FormVersion(StrEnum):
    """`form_version` of a `human_input_required` event: the store, and so the lookup, that owns the form."""

    V1 = "1"
    V2 = "2"


PUBLISHED_RUN_FORMS: Final = frozenset(FormVersion)
# A draft run's v1 form carries its console or backstage token, which `CheckFormSurface` refuses.
DRAFT_RUN_FORMS: Final = frozenset({FormVersion.V2})


class CheckFormSurface(Requirement):
    """`/openapi/v1` is allowed only the recipient types `human_input_policy` lists
    for it, so a console-bound form is refused before any handler body runs. It
    lives here rather than in `auth/requirements.py` so the auth layer never has
    to import this feature's domain.

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


class _V2FormCaller(ABC):
    """How one subject kind reads and answers a v2 form, as the recipient its run made of it."""

    @abstractmethod
    def get(self, service: HumanInputSubmissionService, ctx: Context, form_token: str) -> V2Form: ...

    @abstractmethod
    def submit(
        self,
        service: HumanInputSubmissionService,
        ctx: Context,
        form_token: str,
        *,
        action: str,
        inputs: Mapping[str, Any],
    ) -> V2Form: ...


class _AccountV2Caller(_V2FormCaller):
    """An account's run makes it a CONSOLE recipient through its own Contact."""

    @override
    def get(self, service: HumanInputSubmissionService, ctx: Context, form_token: str) -> V2Form:
        return service.get_console_form(
            account_id=AccountId(ctx.account.id),
            form_token=form_token,
            ip_address=viewer_ip_address(),
            app_id=ctx.app.id,
        )

    @override
    def submit(
        self,
        service: HumanInputSubmissionService,
        ctx: Context,
        form_token: str,
        *,
        action: str,
        inputs: Mapping[str, Any],
    ) -> V2Form:
        return service.submit_console_form(
            account_id=AccountId(ctx.account.id), form_token=form_token, action=action, inputs=inputs, app_id=ctx.app.id
        )


class _EndUserV2Caller(_V2FormCaller):
    """An External SSO caller is a WEB_APP recipient as its end user of the app."""

    @override
    def get(self, service: HumanInputSubmissionService, ctx: Context, form_token: str) -> V2Form:
        return service.get_web_app_form(actor=self._actor(ctx), form_token=form_token, ip_address=viewer_ip_address())

    @override
    def submit(
        self,
        service: HumanInputSubmissionService,
        ctx: Context,
        form_token: str,
        *,
        action: str,
        inputs: Mapping[str, Any],
    ) -> V2Form:
        return service.submit_web_app_form(actor=self._actor(ctx), form_token=form_token, action=action, inputs=inputs)

    @staticmethod
    def _actor(ctx: Context) -> WebAppFormActor:
        return WebAppFormActor(tenant_id=TenantId(ctx.app.tenant_id), app_id=ctx.app.id, end_user_id=ctx.end_user.id)


# Keyed like the routes' `CheckSubject(allowed=...)` below.
_V2_FORM_CALLERS: Final[Mapping[SubjectType, _V2FormCaller]] = {
    SubjectType.ACCOUNT: _AccountV2Caller(),
    SubjectType.EXTERNAL_SSO: _EndUserV2Caller(),
}


def _v2_form_error(error: HumanInputFormError) -> HTTPException:
    """The same errors a v1 form answers with on these ops."""
    return legacy_form_http_error(error, not_found=HumanInputFormNotFound())


def _v2_service() -> HumanInputSubmissionService:
    return HumanInputSubmissionService(session_factory=session_factory.get_session_maker())


def _follow_hint(app_id: str, workflow_run_id: str | None) -> FormSubmitResponse:
    if workflow_run_id is None:
        return FormSubmitResponse()
    # `workflow_events` imports this module for `with_form_hints`.
    from controllers.openapi.workflow_events import OpenApiWorkflowEventsApi

    follow = Hint(
        summary="Follow the resumed run",
        op=op_of(OpenApiWorkflowEventsApi.get),
        input={
            "app_id": app_id,
            "run_id": workflow_run_id,
            "include_state_snapshot": True,
            "continue_on_pause": False,
        },
    )
    return FormSubmitResponse(hints=[follow])


@openapi_ns.route("/apps/<string:app_id>/human-input-forms/<string:form_token>")
class OpenApiWorkflowHumanInputFormApi(Resource):
    @endpoint(
        op="describe.run.form",
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
            CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
            CheckAppAccess(),
            CheckFormSurface(),
        ),
        returns=(200, HumanInputFormDefinitionResponse, "Form definition"),
    )
    def get(self, ctx: Context, app_id: str, form_token: str):
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            try:
                v2_form = _V2_FORM_CALLERS[ctx.subject.subject_type].get(_v2_service(), ctx, form_token)
            except HumanInputFormError as error:
                raise _v2_form_error(error) from error
            return v2_form_definition_response(v2_form, HumanInputFormDefinitionResponse)

        _ensure_form_belongs_to_app(form, ctx.app)
        service.ensure_form_active(form)
        return _jsonify_form_definition(form)


@openapi_ns.route("/apps/<string:app_id>/human-input-forms/<string:form_token>:submit")
class OpenApiWorkflowHumanInputFormSubmitApi(Resource):
    @endpoint(
        op="submit.run.form",
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
            CheckRBACPermission(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp())),
            CheckAppAccess(),
            CheckFormSurface(),
        ),
        body=OpenApiFormSubmitPayload,
        returns=(200, FormSubmitResponse, "Form submitted"),
    )
    def post(self, ctx: Context, app_id: str, form_token: str, *, body: OpenApiFormSubmitPayload):
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            inputs = self._inputs(ctx, body)
            try:
                v2_form = _V2_FORM_CALLERS[ctx.subject.subject_type].submit(
                    _v2_service(), ctx, form_token, action=body.action, inputs=inputs
                )
            except HumanInputFormError as error:
                raise _v2_form_error(error) from error
            return _follow_hint(ctx.app.id, v2_form.workflow_run_id)

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

        inputs = self._inputs(ctx, body)

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
        return _follow_hint(ctx.app.id, form.workflow_run_id)

    @staticmethod
    def _inputs(ctx: Context, body: OpenApiFormSubmitPayload) -> dict[str, Any]:
        if body.files:
            end_read_transaction(ctx.session)
        return merge_files(body.inputs, body.files, ctx.caller)


def form_hints(
    *, op: str, app_id: str, response: HumanInputRequiredResponse, forms: frozenset[FormVersion]
) -> list[Hint]:
    """One hint per action button of a paused form whose version is in `forms`, its `inputs`
    blanked to the form's fields."""

    data = response.data
    if not data.form_token:
        return []
    if FormVersion(data.form_version) not in forms:
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


def with_form_hints(events: Iterable[str], *, app_id: str, forms: frozenset[FormVersion]) -> Generator[str]:
    """A run stream whose `human_input_required` events, for forms of a version in `forms`,
    carry hints that target the submit route above."""

    op = op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)

    def build(event: Mapping[str, Any]) -> list[Hint]:
        return form_hints(op=op, app_id=app_id, response=HumanInputRequiredResponse.model_validate(event), forms=forms)

    return attach_stream_hints(events, event=StreamEvent.HUMAN_INPUT_REQUIRED.value, build=build)
