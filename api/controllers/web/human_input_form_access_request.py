"""Public web Human Input v2 form transport.

The versioned public routes are separate from legacy v1 forms and Web App
passport-authenticated forms. Each runtime path must reject tokens owned by the other
version when the service implementation is added.
"""

from __future__ import annotations

from typing import NoReturn

from flask import request
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
    HumanInputV2FormSubmitRequest,
)
from controllers.common.human_input_v2_errors import (
    HumanInputAccessDeliveryError,
    HumanInputAccessRateLimitError,
    HumanInputExpiredChallengeError,
    HumanInputInvalidOtpError,
    HumanInputStaleChallengeError,
    HumanInputV2InvalidInputError,
    HumanInputV2UnavailableError,
    HumanInputV2WorkflowNotActiveError,
    PublicHumanInputV2ExpiredError,
    PublicHumanInputV2NotFoundError,
    PublicHumanInputV2SubmittedError,
    email_otp_http_error,
    public_form_http_error,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.human_input_file_upload import InvalidUploadTokenForbiddenError
from core.db.session_factory import session_factory
from factories.human_input_v2_form_presentation import build_form_presentation
from libs.datetime_utils import to_utc_timestamp
from libs.external_api import error_responses
from libs.helper import dump_response, extract_remote_ip
from services.human_input_file_upload_service import InvalidUploadTokenError
from services.human_input_v2.email_otp_composition import build_email_otp_service
from services.human_input_v2.email_otp_service import EmailOtpError
from services.human_input_v2.file_upload_service import build_file_upload_service
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputSubmissionService,
)

register_schema_models(web_ns, HumanInputV2FormSubmitRequest)
register_response_schema_models(
    web_ns,
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
)


def _raise_public_form_error(error: HumanInputFormError) -> NoReturn:
    raise public_form_http_error(error) from error


@web_ns.route("/form/human-input/v2/public/<string:form_token>")
class HumanInputV2FormApi(Resource):
    """Read or submit a Human Input v2 form without sharing v1 submission logic."""

    @error_responses(PublicHumanInputV2NotFoundError, PublicHumanInputV2SubmittedError, PublicHumanInputV2ExpiredError)
    @web_ns.doc(
        description="Read a public v2 form definition by delivery token without an OTP or login session.",
        security=[],
        responses={404: "Form not found", 412: "Form already submitted or expired"},
    )
    @web_ns.response(200, "Form definition", web_ns.models[FormDefinitionResponse.__name__])
    def get(self, form_token: str):
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            form = service.get_public_form(form_token=form_token, ip_address=extract_remote_ip(request) or None)
        except HumanInputFormError as error:
            _raise_public_form_error(error)
        presentation = build_form_presentation(form.resolved_form)
        return dump_response(
            FormDefinitionResponse,
            {
                "form_content": presentation.form_content,
                "inputs": presentation.inputs,
                "resolved_default_values": presentation.resolved_default_values,
                "user_actions": presentation.user_actions,
                "expiration_time": to_utc_timestamp(min(form.expiration_time, form.global_timeout_deadline)),
            },
        )

    @error_responses(
        PublicHumanInputV2NotFoundError,
        PublicHumanInputV2SubmittedError,
        PublicHumanInputV2ExpiredError,
        HumanInputV2WorkflowNotActiveError,
        HumanInputV2InvalidInputError,
        HumanInputExpiredChallengeError,
        HumanInputInvalidOtpError,
        HumanInputStaleChallengeError,
        HumanInputV2UnavailableError,
    )
    @web_ns.expect(web_ns.models[HumanInputV2FormSubmitRequest.__name__])
    @web_ns.doc(
        description="Submit a form with inputs, an action, and email verification proof.",
        security=[],
        responses={
            400: "Invalid form or email proof",
            404: "Form not found",
            409: "Workflow not active",
            412: "Already submitted or expired",
            422: "Invalid request body",
            503: "Email verification unavailable",
        },
    )
    @web_ns.response(200, "Form submitted", web_ns.models[FormSubmitResponse.__name__])
    @model_validate(HumanInputV2FormSubmitRequest)
    def post(self, payload: HumanInputV2FormSubmitRequest, form_token: str):
        service = HumanInputSubmissionService(session_factory=session_factory.get_session_maker())
        try:
            service.submit_public_form(
                email_otp_service=build_email_otp_service(),
                form_token=form_token,
                action=payload.action,
                inputs=payload.inputs,
                challenge_token=payload.challenge_token,
                otp_code=payload.otp_code,
                ip_address=extract_remote_ip(request) or None,
            )
        except EmailOtpError as error:
            raise email_otp_http_error(error) from error
        except HumanInputFormError as error:
            _raise_public_form_error(error)
        return FormSubmitResponse().model_dump(mode="json")


@web_ns.route("/form/human-input/v2/public/<string:form_token>/upload-token")
class HumanInputV2FormUploadTokenApi(Resource):
    """Issue an upload token for an active Human Input v2 form."""

    @error_responses(
        PublicHumanInputV2NotFoundError,
        PublicHumanInputV2SubmittedError,
        PublicHumanInputV2ExpiredError,
        InvalidUploadTokenForbiddenError,
    )
    @web_ns.response(200, "Success", web_ns.models[FormUploadTokenResponse.__name__])
    @web_ns.doc(security=[], responses={404: "Form not found", 412: "Already submitted or expired"})
    def post(self, form_token: str):
        try:
            grant = build_file_upload_service().issue_public_upload_token(form_token)
        except HumanInputFormError as error:
            _raise_public_form_error(error)
        except InvalidUploadTokenError as error:
            raise InvalidUploadTokenForbiddenError() from error
        return FormUploadTokenResponse(
            upload_token=grant.upload_token, expires_at=to_utc_timestamp(grant.expires_at)
        ).model_dump(mode="json")


@web_ns.route("/form/human-input/v2/public/<string:form_token>/access-request")
class FormAccessRequestApi(Resource):
    @error_responses(
        PublicHumanInputV2NotFoundError,
        PublicHumanInputV2SubmittedError,
        PublicHumanInputV2ExpiredError,
        HumanInputAccessRateLimitError,
        HumanInputAccessDeliveryError,
        HumanInputV2UnavailableError,
    )
    @web_ns.response(200, "Success", web_ns.models[FormAccessRequestResponse.__name__])
    def post(self, form_token: str):
        try:
            challenge = build_email_otp_service().request_access(
                form_token, ip_address=extract_remote_ip(request) or None
            )
        except EmailOtpError as error:
            raise email_otp_http_error(error) from error
        return FormAccessRequestResponse(
            challenge_token=challenge.challenge_token,
            expires_in_seconds=challenge.expires_in_seconds,
            resend_after_seconds=challenge.resend_after_seconds,
        ).model_dump(mode="json")
