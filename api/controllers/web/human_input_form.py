"""
Web App Human Input Form APIs.
"""

import json
import logging
from collections.abc import Sequence
from typing import Any, NotRequired, TypedDict

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.errors import NotFoundError
from controllers.common.human_input import HumanInputFormSubmitPayload, stringify_form_default_values
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.error import WebFormRateLimitExceededError
from controllers.web.site import serialize_app_site_payload
from extensions.ext_database import db
from core.workflow.nodes.human_input.entities import FormInputConfig
from libs.helper import RateLimiter, extract_remote_ip, to_timestamp
from models.account import TenantStatus
from models.model import App, Site
from repositories.factory import DifyAPIRepositoryFactory
from services.human_input_file_upload_service import HumanInputFileUploadService
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


class HumanInputUploadTokenResponse(BaseModel):
    upload_token: str
    expires_at: int


class HumanInputFormDefinitionResponse(BaseModel):
    form_content: Any
    inputs: Any
    resolved_default_values: dict[str, str]
    user_actions: Any
    expiration_time: int
    site: dict[str, Any] | None = Field(default=None)


class HumanInputFormSubmitResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")


register_schema_models(web_ns, HumanInputFormSubmitPayload)
register_response_schema_models(
    web_ns,
    HumanInputUploadTokenResponse,
    HumanInputFormDefinitionResponse,
    HumanInputFormSubmitResponse,
)


_FORM_SUBMIT_RATE_LIMITER = RateLimiter(
    prefix="web_form_submit_rate_limit",
    max_attempts=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS,
    time_window=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS,
)
_FORM_ACCESS_RATE_LIMITER = RateLimiter(
    prefix="web_form_access_rate_limit",
    max_attempts=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS,
    time_window=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS,
)
_FORM_UPLOAD_TOKEN_RATE_LIMITER = RateLimiter(
    prefix="web_form_upload_token_rate_limit",
    max_attempts=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_MAX_ATTEMPTS,
    time_window=dify_config.WEB_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS,
)


def _create_upload_service() -> HumanInputFileUploadService:
    session_factory = sessionmaker(bind=db.engine)
    workflow_run_repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_factory)
    return HumanInputFileUploadService(
        session_factory=session_factory,
        workflow_run_repository=workflow_run_repository,
    )


class FormDefinitionPayload(TypedDict):
    form_content: Any
    inputs: Any
    resolved_default_values: dict[str, str]
    user_actions: Any
    expiration_time: int
    site: NotRequired[dict]


def _jsonify_form_definition(
    form: Form,
    *,
    inputs: Sequence[FormInputConfig] = (),
    site_payload: dict | None = None,
) -> Response:
    """Return the form payload (optionally with site) as a JSON response."""
    definition_payload = form.get_definition().model_dump(mode="json")
    payload: FormDefinitionPayload = {
        "form_content": definition_payload["rendered_content"],
        "inputs": [i.model_dump(mode="json") for i in inputs],
        "resolved_default_values": stringify_form_default_values(definition_payload["default_values"]),
        "user_actions": definition_payload["user_actions"],
        "expiration_time": to_timestamp(form.expiration_time),
    }
    if site_payload is not None:
        payload["site"] = site_payload
    return Response(json.dumps(payload, ensure_ascii=False), mimetype="application/json")


@web_ns.route("/form/human_input/<string:form_token>/upload-token")
class HumanInputFormUploadTokenApi(Resource):
    """API for issuing HITL upload tokens for active human input forms."""

    @web_ns.response(200, "Success", web_ns.models[HumanInputUploadTokenResponse.__name__])
    def post(self, form_token: str):
        """
        Issue an upload token for a human input form.

        POST /api/form/human_input/<form_token>/upload-token
        """
        ip_address = extract_remote_ip(request)
        if _FORM_UPLOAD_TOKEN_RATE_LIMITER.is_rate_limited(ip_address):
            raise WebFormRateLimitExceededError()
        _FORM_UPLOAD_TOKEN_RATE_LIMITER.increment_rate_limit(ip_address)

        try:
            token = _create_upload_service().issue_upload_token(form_token)
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        response = HumanInputUploadTokenResponse(
            upload_token=token.upload_token,
            expires_at=to_timestamp(token.expires_at),
        )
        return response.model_dump(mode="json"), 200


@web_ns.route("/form/human_input/<string:form_token>")
class HumanInputFormApi(Resource):
    """API for getting and submitting human input forms via the web app."""

    # NOTE(QuantumGhost): this endpoint is unauthenticated on purpose for now.

    # def get(self, _app_model: App, _end_user: EndUser, form_token: str):
    @web_ns.response(200, "Success", web_ns.models[HumanInputFormDefinitionResponse.__name__])
    def get(self, form_token: str):
        """
        Get human input form definition by token.

        GET /api/form/human_input/<form_token>
        """
        ip_address = extract_remote_ip(request)
        if _FORM_ACCESS_RATE_LIMITER.is_rate_limited(ip_address):
            raise WebFormRateLimitExceededError()
        _FORM_ACCESS_RATE_LIMITER.increment_rate_limit(ip_address)

        service = HumanInputService(db.engine)
        # TODO(QuantumGhost): forbid submission for form tokens
        # that are only for console.
        form = service.get_form_by_token(form_token)

        if form is None:
            raise NotFoundError("Form not found")

        service.ensure_form_active(form)
        app_model, site = _get_app_site_from_form(form)
        inputs = service.resolve_form_inputs(form)

        return _jsonify_form_definition(
            form,
            inputs=inputs,
            site_payload=serialize_app_site_payload(app_model, site, None),
        )

    # def post(self, _app_model: App, _end_user: EndUser, form_token: str):
    @web_ns.response(200, "Success", web_ns.models[HumanInputFormSubmitResponse.__name__])
    @web_ns.expect(web_ns.models[HumanInputFormSubmitPayload.__name__])
    def post(self, form_token: str):
        """
        Submit human input form by token.

        POST /api/form/human_input/<form_token>

        Request body:
        {
            "inputs": {
                "content": "User input content"
            },
            "action": "Approve"
        }
        """
        payload = HumanInputFormSubmitPayload.model_validate(request.get_json())

        ip_address = extract_remote_ip(request)
        if _FORM_SUBMIT_RATE_LIMITER.is_rate_limited(ip_address):
            raise WebFormRateLimitExceededError()
        _FORM_SUBMIT_RATE_LIMITER.increment_rate_limit(ip_address)

        service = HumanInputService(db.engine)
        form = service.get_form_by_token(form_token)
        if form is None:
            raise NotFoundError("Form not found")

        if (recipient_type := form.recipient_type) is None:
            logger.warning("Recipient type is None for form, form_id=%", form.id)
            raise AssertionError("Recipient type is None")

        try:
            service.submit_form_by_token(
                recipient_type=recipient_type,
                form_token=form_token,
                selected_action_id=payload.action,
                form_data=payload.inputs,
                submission_end_user_id=None,
                # submission_end_user_id=_end_user.id,
            )
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        return {}, 200


def _get_app_site_from_form(form: Form) -> tuple[App, Site]:
    """Resolve App/Site for the form's app and validate tenant status."""
    app_model = db.session.get(App, form.app_id)
    if app_model is None or app_model.tenant_id != form.tenant_id:
        raise NotFoundError("Form not found")

    site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))
    if site is None:
        raise Forbidden()

    if app_model.tenant and app_model.tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden()

    return app_model, site
