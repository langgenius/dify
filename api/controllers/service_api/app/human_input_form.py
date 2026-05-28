"""
Service API human input form endpoints.

This module exposes app-token authenticated APIs for fetching and submitting
paused human input forms in workflow/chatflow runs.
"""

import json
import logging

from flask import Response
from flask_restx import Resource
from werkzeug.exceptions import BadRequest, NotFound

from controllers.common.human_input import HumanInputFormSubmitPayload, stringify_form_default_values
from controllers.common.schema import register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.workflow.human_input_policy import HumanInputSurface, is_recipient_type_allowed_for_surface
from extensions.ext_database import db
from libs.helper import to_timestamp
from models.model import App, EndUser
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


register_schema_models(service_api_ns, HumanInputFormSubmitPayload)


def _jsonify_form_definition(form: Form) -> Response:
    definition_payload = form.get_definition().model_dump()
    payload = {
        "form_content": definition_payload["rendered_content"],
        "inputs": definition_payload["inputs"],
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


@service_api_ns.route("/form/human_input/<string:form_token>")
class WorkflowHumanInputFormApi(Resource):
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
    @validate_app_token
    def get(self, app_model: App, form_token: str):
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise NotFound("Form not found")

        _ensure_form_belongs_to_app(form, app_model)
        _ensure_form_is_allowed_for_service_api(form)
        service.ensure_form_active(form)
        return _jsonify_form_definition(form)

    @service_api_ns.expect(service_api_ns.models[HumanInputFormSubmitPayload.__name__])
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
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, form_token: str):
        payload = HumanInputFormSubmitPayload.model_validate(service_api_ns.payload or {})

        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise NotFound("Form not found")

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
