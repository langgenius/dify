"""Passport-authenticated Human Input v2 forms for the original Web App EndUser.

These routes are separate from the public Email-proof form surface. A delivery
token locates the form; the app passport establishes who may read or submit it.
"""

from flask import request
from pydantic import BaseModel, ConfigDict, JsonValue
from werkzeug.exceptions import NotFound

from controllers.common.human_input_v2_errors import (
    HumanInputV2AlreadySubmittedError,
    HumanInputV2ExpiredError,
    HumanInputV2InvalidInputError,
    HumanInputV2WorkflowNotActiveError,
    form_http_error,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from core.db.session_factory import session_factory
from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import TenantId
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response, extract_remote_ip, to_timestamp
from models.model import App, EndUser
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputSubmissionService,
    WebAppFormActor,
)


class WebAppHumanInputV2SubmitPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    inputs: dict[str, JsonValue]
    action: str


class WebAppHumanInputV2FormDefinitionResponse(ResponseModel):
    resolved_form: ResolvedForm
    expiration_time: int


class WebAppHumanInputV2SubmitResponse(ResponseModel):
    pass


register_schema_models(web_ns, WebAppHumanInputV2SubmitPayload)
register_response_schema_models(web_ns, WebAppHumanInputV2FormDefinitionResponse, WebAppHumanInputV2SubmitResponse)


def _web_app_actor(app_model: App, end_user: EndUser) -> WebAppFormActor:
    # The passport decoder loads App and EndUser independently. Establish their
    # ownership relationship before treating the session as an approval actor.
    if end_user.tenant_id != app_model.tenant_id or end_user.app_id != app_model.id:
        raise NotFound("Form not found")
    return WebAppFormActor(tenant_id=TenantId(app_model.tenant_id), app_id=app_model.id, end_user_id=end_user.id)


@web_ns.route("/form/human-input/v2/<string:form_token>")
class WebAppHumanInputV2FormApi(WebApiResource):
    @error_responses(HumanInputV2AlreadySubmittedError, HumanInputV2ExpiredError)
    @web_ns.doc(
        "get_web_app_human_input_v2_form",
        description="Read a v2 form using the original EndUser's Web App passport.",
        responses={401: "Invalid passport", 404: "Form not found", 409: "Already submitted", 410: "Expired"},
    )
    @web_ns.response(200, "Form retrieved", web_ns.models[WebAppHumanInputV2FormDefinitionResponse.__name__])
    def get(self, app_model: App, end_user: EndUser, form_token: str):
        actor = _web_app_actor(app_model, end_user)
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            form = service.get_web_app_form(
                actor=actor, form_token=form_token, ip_address=extract_remote_ip(request) or None
            )
        except HumanInputFormError as exc:
            raise form_http_error(exc, message="The approval could not be accepted.") from exc
        return dump_response(
            WebAppHumanInputV2FormDefinitionResponse,
            {
                "resolved_form": form.resolved_form,
                "expiration_time": to_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
            },
        )

    @error_responses(
        HumanInputV2AlreadySubmittedError,
        HumanInputV2ExpiredError,
        HumanInputV2WorkflowNotActiveError,
        HumanInputV2InvalidInputError,
    )
    @web_ns.doc(
        "submit_web_app_human_input_v2_form",
        description="Submit a v2 form using the original EndUser's Web App passport.",
        responses={
            400: "Invalid inputs",
            401: "Invalid passport",
            404: "Form not found",
            409: "Already submitted or workflow not active",
            410: "Expired",
            422: "Invalid request body",
        },
    )
    @web_ns.expect(web_ns.models[WebAppHumanInputV2SubmitPayload.__name__])
    @web_ns.response(200, "Approval accepted", web_ns.models[WebAppHumanInputV2SubmitResponse.__name__])
    @model_validate(WebAppHumanInputV2SubmitPayload)
    def post(self, payload: WebAppHumanInputV2SubmitPayload, app_model: App, end_user: EndUser, form_token: str):
        actor = _web_app_actor(app_model, end_user)
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            service.submit_web_app_form(
                actor=actor, form_token=form_token, action=payload.action, inputs=payload.inputs
            )
        except HumanInputFormError as exc:
            raise form_http_error(exc, message="The approval could not be accepted.") from exc
        return WebAppHumanInputV2SubmitResponse().model_dump(mode="json")
