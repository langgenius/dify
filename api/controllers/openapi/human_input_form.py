"""
OpenAPI bearer-authed human input form endpoints.

GET  /apps/<app_id>/form/human_input/<form_token>  — fetch paused form definition
POST /apps/<app_id>/form/human_input/<form_token>  — submit form response
"""

from __future__ import annotations

import json
import logging

from flask import Response
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.common.human_input import HumanInputFormSubmitPayload, stringify_form_default_values
from controllers.common.schema import register_schema_models
from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._errors import HumanInputFormNotFound, RecipientSurfaceMismatch
from controllers.openapi._models import FormSubmitResponse, HumanInputFormDefinitionResponse
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, RBACRequirement
from core.workflow.human_input_policy import (
    HumanInputSurface,
    is_recipient_type_allowed_for_surface,
)
from extensions.ext_database import db
from libs.helper import to_timestamp
from libs.oauth_bearer import Scope
from models.model import App
from services.human_input_service import FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)

register_schema_models(openapi_ns, HumanInputFormSubmitPayload)


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


def _ensure_form_is_allowed_for_openapi(form) -> None:
    if not is_recipient_type_allowed_for_surface(form.recipient_type, HumanInputSurface.OPENAPI):
        raise RecipientSurfaceMismatch()


@openapi_ns.route("/apps/<string:app_id>/form/human_input/<string:form_token>")
class OpenApiWorkflowHumanInputFormApi(Resource):
    @openapi_ns.response(200, "Form definition", openapi_ns.models[HumanInputFormDefinitionResponse.__name__])
    @auth_router.guard(
        scope=Scope.APPS_RUN,
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_TEST_AND_RUN),
    )
    def get(self, app_id: str, form_token: str, *, auth_data: AuthData):
        app_model, _caller, _caller_kind = auth_data.require_app_context()
        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise HumanInputFormNotFound()

        _ensure_form_belongs_to_app(form, app_model)
        _ensure_form_is_allowed_for_openapi(form)
        service.ensure_form_active(form)
        return _jsonify_form_definition(form)

    @auth_router.guard(
        scope=Scope.APPS_RUN,
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_TEST_AND_RUN),
    )
    @returns(200, FormSubmitResponse, description="Form submitted")
    @accepts(body=HumanInputFormSubmitPayload)
    def post(self, app_id: str, form_token: str, *, auth_data: AuthData, body: HumanInputFormSubmitPayload):
        app_model, caller, caller_kind = auth_data.require_app_context()

        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise HumanInputFormNotFound()

        _ensure_form_belongs_to_app(form, app_model)
        _ensure_form_is_allowed_for_openapi(form)

        submission_user_id: str | None = None
        submission_end_user_id: str | None = None
        if caller_kind == "account":
            submission_user_id = caller.id
        else:
            submission_end_user_id = caller.id

        if form.recipient_type is None:
            logger.warning("Recipient type is None for form, form_token=%s", form_token)
            raise BadRequest("Form recipient type is invalid")

        try:
            service.submit_form_by_token(
                recipient_type=form.recipient_type,
                form_token=form_token,
                selected_action_id=body.action,
                form_data=body.inputs,
                submission_user_id=submission_user_id,
                submission_end_user_id=submission_end_user_id,
            )
        except FormNotFoundError:
            raise HumanInputFormNotFound()

        return FormSubmitResponse()
