"""
Web App Human Input Form APIs.
"""

import logging
from collections.abc import Sequence
from typing import Self

from flask import request
from flask_restx import Resource
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.errors import NotFoundError
from controllers.common.human_input import HumanInputFormSubmitPayload, stringify_form_default_values
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.error import WebFormRateLimitExceededError
from controllers.web.site import WebAppSiteResponse
from extensions.ext_database import db
from fields.base import ResponseModel
from graphon.nodes.human_input.entities import FormInputConfig, UserActionConfig
from libs.helper import RateLimiter, dump_response, extract_remote_ip, to_timestamp
from models.account import TenantStatus
from models.model import App, Site
from repositories.factory import DifyAPIRepositoryFactory
from services.feature_service import FeatureService
from services.human_input_file_upload_service import HumanInputFileUploadService
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


class HumanInputUploadTokenResponse(ResponseModel):
    upload_token: str
    expires_at: int


class HumanInputFormDefinitionResponse(ResponseModel):
    form_content: str
    inputs: list[FormInputConfig]
    resolved_default_values: dict[str, str]
    user_actions: list[UserActionConfig]
    expiration_time: int
    site: WebAppSiteResponse | None = None

    @classmethod
    def from_form(
        cls,
        form: Form,
        *,
        inputs: Sequence[FormInputConfig] = (),
        site: WebAppSiteResponse | None = None,
    ) -> Self:
        definition_payload = form.get_definition().model_dump(mode="json")
        expiration_time = to_timestamp(form.expiration_time)
        if expiration_time is None:
            raise ValueError("Human input form expiration_time is required")
        return cls(
            form_content=definition_payload["rendered_content"],
            inputs=list(inputs),
            resolved_default_values=stringify_form_default_values(definition_payload["default_values"]),
            user_actions=definition_payload["user_actions"],
            expiration_time=expiration_time,
            site=site,
        )


class HumanInputFormSubmitResponse(ResponseModel):
    pass


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


@web_ns.route("/form/human_input/<string:form_token>/upload-token")
class HumanInputFormUploadTokenApi(Resource):
    """API for issuing HITL upload tokens for active human input forms."""

    @web_ns.doc("create_human_input_form_upload_token")
    @web_ns.doc(description="Issue an upload token for an active human input form")
    @web_ns.doc(params={"form_token": "Human input form token"})
    @web_ns.doc(
        responses={
            200: "Upload token issued successfully",
            404: "Form not found",
            412: "Form already submitted or expired",
            429: "Too many requests",
        }
    )
    @web_ns.response(
        200,
        "Upload token issued successfully",
        web_ns.models[HumanInputUploadTokenResponse.__name__],
    )
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

        return HumanInputUploadTokenResponse(
            upload_token=token.upload_token, expires_at=to_timestamp(token.expires_at)
        ).model_dump(mode="json"), 200


@web_ns.route("/form/human_input/<string:form_token>")
class HumanInputFormApi(Resource):
    """API for getting and submitting human input forms via the web app."""

    # NOTE(QuantumGhost): this endpoint is unauthenticated on purpose for now.

    # def get(self, _app_model: App, _end_user: EndUser, form_token: str):
    @web_ns.doc("get_human_input_form")
    @web_ns.doc(description="Get a human input form definition by token")
    @web_ns.doc(params={"form_token": "Human input form token"})
    @web_ns.doc(
        responses={
            200: "Form retrieved successfully",
            403: "Forbidden",
            404: "Form not found",
            412: "Form already submitted or expired",
            429: "Too many requests",
        }
    )
    @web_ns.response(
        200,
        "Form retrieved successfully",
        web_ns.models[HumanInputFormDefinitionResponse.__name__],
    )
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
        tenant = app_model.tenant
        if tenant is None:
            raise Forbidden()
        inputs = service.resolve_form_inputs(form)

        return dump_response(
            HumanInputFormDefinitionResponse,
            HumanInputFormDefinitionResponse.from_form(
                form,
                inputs=inputs,
                site=WebAppSiteResponse.from_app_site(
                    tenant=tenant,
                    app_model=app_model,
                    site=site,
                    end_user_id=None,
                    can_replace_logo=FeatureService.get_features(
                        app_model.tenant_id, exclude_vector_space=True
                    ).can_replace_logo,
                ),
            ),
        )

    # def post(self, _app_model: App, _end_user: EndUser, form_token: str):
    @web_ns.expect(web_ns.models[HumanInputFormSubmitPayload.__name__])
    @web_ns.doc("submit_human_input_form")
    @web_ns.doc(description="Submit a human input form by token")
    @web_ns.doc(params={"form_token": "Human input form token"})
    @web_ns.doc(
        responses={
            200: "Form submitted successfully",
            400: "Bad request - invalid submission data",
            404: "Form not found",
            412: "Form already submitted or expired",
            429: "Too many requests",
        }
    )
    @web_ns.response(
        200,
        "Form submitted successfully",
        web_ns.models[HumanInputFormSubmitResponse.__name__],
    )
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

        return HumanInputFormSubmitResponse().model_dump(mode="json"), 200


def _get_app_site_from_form(form: Form) -> tuple[App, Site]:
    """Resolve App/Site for the form's app and validate tenant status."""
    app_model = db.session.get(App, form.app_id)
    if app_model is None or app_model.tenant_id != form.tenant_id:
        raise NotFoundError("Form not found")

    site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))
    if site is None:
        raise Forbidden()

    if app_model.tenant is None or app_model.tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden()

    return app_model, site
