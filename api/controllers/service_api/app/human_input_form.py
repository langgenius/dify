"""
Service API human input form endpoints.

This module exposes app-token authenticated APIs for fetching and submitting
paused human input forms in workflow/chatflow runs.
"""

import json
import logging
from collections.abc import Sequence
from typing import Annotated, NoReturn

from flask import Response
from flask_restx import Resource
from pydantic import ConfigDict, WithJsonSchema
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.human_input import HumanInputFormSubmitPayload, stringify_form_default_values
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.service_api import service_api_ns
from controllers.service_api.schema import expect_with_user
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.human_input_v2.shared.values import TenantId
from core.workflow.human_input_policy import HumanInputSurface, is_recipient_type_allowed_for_surface
from core.workflow.nodes.human_input.entities import FormInputConfig, UserActionConfig
from extensions.ext_database import db
from factories.human_input_v2_form_presentation import build_form_presentation
from fields.base import ResponseModel
from libs.helper import to_timestamp
from models.model import App, EndUser
from repositories.human_input_v2.form_repository import Form as V2Form
from services.human_input_service import (
    Form,
    FormExpiredError,
    FormNotFoundError,
    FormSubmittedError,
    HumanInputService,
    InvalidFormDataError,
)
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
    ServiceAPIFormActor,
)

logger = logging.getLogger(__name__)


Int64 = Annotated[int, WithJsonSchema({"format": "int64", "type": "integer"})]


class HumanInputFormDefinitionResponse(ResponseModel):
    form_content: str
    inputs: list[FormInputConfig]
    resolved_default_values: dict[str, str]
    user_actions: list[UserActionConfig]
    expiration_time: Int64 | None = None


class HumanInputFormSubmitResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")


register_schema_models(service_api_ns, HumanInputFormSubmitPayload)
register_response_schema_models(
    service_api_ns,
    HumanInputFormDefinitionResponse,
    HumanInputFormSubmitResponse,
)


def _jsonify_form_definition(form: Form, *, inputs: Sequence[FormInputConfig] = ()) -> Response:
    definition_payload = form.get_definition().model_dump(mode="json")
    payload = {
        "form_content": definition_payload["rendered_content"],
        "inputs": [form_input.model_dump(mode="json") for form_input in inputs],
        "resolved_default_values": stringify_form_default_values(definition_payload["default_values"]),
        "user_actions": definition_payload["user_actions"],
        "expiration_time": to_timestamp(form.expiration_time),
    }
    return Response(json.dumps(payload, ensure_ascii=False), mimetype="application/json")


def _ensure_form_belongs_to_app(form: Form, app_model: App) -> None:
    if form.app_id != app_model.id or form.tenant_id != app_model.tenant_id:
        raise NotFound("Form not found")


def _ensure_form_is_allowed_for_service_api(form: Form) -> None:
    # Keep app-token callers scoped to the public web-form surface; internal HITL
    # routes must continue to flow through console-only authentication.
    if not is_recipient_type_allowed_for_surface(form.recipient_type, HumanInputSurface.SERVICE_API):
        raise NotFound("Form not found")


def _jsonify_v2_form_definition(form: V2Form) -> Response:
    presentation = build_form_presentation(form.resolved_form)
    response = HumanInputFormDefinitionResponse(
        form_content=presentation.form_content,
        inputs=presentation.inputs,
        resolved_default_values=presentation.resolved_default_values,
        user_actions=presentation.user_actions,
        expiration_time=to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
    )
    return Response(response.model_dump_json(), mimetype="application/json")


def _raise_form_error(error: HumanInputFormError) -> NoReturn:
    # Keep the existing Service API errors instead of leaking Web App v2's
    # 409/410 statuses or its transport-specific error codes.
    match error.code:
        case HumanInputFormErrorCode.NOT_FOUND:
            raise NotFound("Form not found") from error
        case HumanInputFormErrorCode.ALREADY_SUBMITTED:
            assert error.form_id is not None
            raise FormSubmittedError(error.form_id) from error
        case HumanInputFormErrorCode.EXPIRED:
            assert error.form_id is not None
            raise FormExpiredError(error.form_id) from error
        case HumanInputFormErrorCode.INVALID_INPUT:
            description = str(error.__cause__) if error.__cause__ is not None else "Invalid form data"
            raise InvalidFormDataError(description) from error
        case HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE:
            raise BadRequest("The workflow is not paused with an active checkpoint.") from error


@service_api_ns.route("/form/human_input/<string:form_token>")
class WorkflowHumanInputFormApi(Resource):
    @service_api_ns.doc(
        summary="Get Human Input Form",
        description=(
            "Retrieve a paused Human Input form's contents using the `form_token` from a "
            "`human_input_required` event. Requires **WebApp** delivery."
        ),
        tags=["Human Input"],
        responses={
            200: "Form contents retrieved successfully.",
            404: "`not_found` : Form not found.",
            412: (
                "- `human_input_form_submitted` : Form already submitted. Forms are one-shot; the first "
                "response wins regardless of which user submits it.\n"
                "- `human_input_form_expired` : The form's expiration time passed before submission arrived."
            ),
        },
    )
    @service_api_ns.doc("get_human_input_form")
    @service_api_ns.doc(description="Get a paused human input form by token")
    @service_api_ns.doc(params={"form_token": "Human input form token"})
    @service_api_ns.doc(
        responses={
            200: "Form retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Form not found",
            412: "Form already submitted or expired",
        }
    )
    @service_api_ns.response(
        200,
        "Form retrieved successfully",
        service_api_ns.models[HumanInputFormDefinitionResponse.__name__],
    )
    @validate_app_token
    def get(self, app_model: App, form_token: str):
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            v2_service = HumanInputSubmissionService(session_factory=sessionmaker(db.engine, expire_on_commit=False))
            try:
                v2_form = v2_service.get_service_api_form(
                    actor=ServiceAPIFormActor(tenant_id=TenantId(app_model.tenant_id), app_id=app_model.id),
                    form_token=form_token,
                )
            except HumanInputFormError as error:
                _raise_form_error(error)
            return _jsonify_v2_form_definition(v2_form)

        _ensure_form_belongs_to_app(form, app_model)
        _ensure_form_is_allowed_for_service_api(form)
        service.ensure_form_active(form)
        inputs = service.resolve_form_inputs(form)
        return _jsonify_form_definition(form, inputs=inputs)

    @service_api_ns.doc(
        summary="Submit Human Input Form",
        description=(
            "Submit the recipient's response to a paused Human Input form. The workflow resumes on "
            "acceptance; use [Stream Workflow Events](/api-reference/chatflows/stream-workflow-events) "
            "to follow subsequent events. Requires **WebApp** delivery."
        ),
        tags=["Human Input"],
        responses={
            200: "Form submitted successfully. The response body is an empty object.",
            400: (
                "- `bad_request` : Form recipient type is invalid.\n"
                "- `invalid_form_data` : Submission failed validation against the form definition."
            ),
            404: "`not_found` : Form not found.",
            412: (
                "- `human_input_form_submitted` : Form already submitted. Forms are one-shot; the first "
                "response wins regardless of which user submits it.\n"
                "- `human_input_form_expired` : The form's expiration time passed before submission arrived."
            ),
        },
    )
    @expect_with_user(service_api_ns, HumanInputFormSubmitPayload)
    @service_api_ns.doc("submit_human_input_form")
    @service_api_ns.doc(description="Submit a paused human input form by token")
    @service_api_ns.doc(params={"form_token": "Human input form token"})
    @service_api_ns.doc(
        responses={
            200: "Form submitted successfully",
            400: "Bad request - invalid submission data",
            401: "Unauthorized - invalid API token",
            404: "Form not found",
            412: "Form already submitted or expired",
        }
    )
    @service_api_ns.response(
        200,
        "Form submitted successfully",
        service_api_ns.models[HumanInputFormSubmitResponse.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    @model_validate(HumanInputFormSubmitPayload)
    def post(self, payload: HumanInputFormSubmitPayload, app_model: App, end_user: EndUser, form_token: str):
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            v2_service = HumanInputSubmissionService(session_factory=sessionmaker(db.engine, expire_on_commit=False))
            try:
                v2_service.submit_service_api_form(
                    actor=ServiceAPIFormActor(tenant_id=TenantId(app_model.tenant_id), app_id=app_model.id),
                    end_user_id=end_user.id,
                    form_token=form_token,
                    action=payload.action,
                    inputs=payload.inputs,
                )
            except HumanInputFormError as error:
                _raise_form_error(error)
            return {}, 200

        _ensure_form_belongs_to_app(form, app_model)
        _ensure_form_is_allowed_for_service_api(form)

        recipient_type = form.recipient_type
        if recipient_type is None:
            logger.warning("Recipient type is None for form, form_id=%s", form.id)
            raise BadRequest("Form recipient type is invalid")

        try:
            service.submit_form_by_token(
                recipient_type=recipient_type,
                form_token=form_token,
                selected_action_id=payload.action,
                form_data=payload.inputs,
                submission_end_user_id=end_user.id,
            )
        except FormNotFoundError:
            raise NotFound("Form not found")

        return {}, 200
