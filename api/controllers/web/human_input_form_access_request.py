"""Public web Human Input v2 form transport.

The versioned public routes are separate from legacy v1 forms and Web App
passport-authenticated forms. Each runtime path must reject tokens owned by the other
version when the service implementation is added.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import override

from flask import abort, request
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
    HumanInputV2FormSubmitRequest,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from core.db.session_factory import session_factory
from libs.exception import BaseHTTPException
from libs.helper import extract_remote_ip
from services.human_input_v2.email_otp_composition import build_email_otp_service
from services.human_input_v2.email_otp_service import EmailOtpError, OtpFailure
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
)


class _EmailOtpHTTPError(BaseHTTPException):
    def __init__(self, error: EmailOtpError) -> None:
        self.error_code = error.reason.value
        self.code = {
            OtpFailure.NOT_FOUND: 404,
            OtpFailure.EXPIRED: 412,
            OtpFailure.SUBMITTED: 412,
            OtpFailure.RATE_LIMIT: 429,
            OtpFailure.DELIVERY: 503,
            OtpFailure.UNAVAILABLE: 503,
        }.get(error.reason, 400)
        super().__init__(description="Unable to complete email verification.")
        self._retry_after = error.retry_after

    @override
    def get_headers(self, environ=None, scope=None):
        headers = super().get_headers(environ, scope)
        if self._retry_after is not None:
            headers.append(("Retry-After", str(self._retry_after)))
        return headers


register_schema_models(web_ns, HumanInputV2FormSubmitRequest)
register_response_schema_models(
    web_ns,
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
)


def _raise_stub_not_implemented() -> None:
    abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 form stub endpoint is not implemented yet.")


@web_ns.route("/form/human-input/v2/public/<string:form_token>")
class HumanInputV2FormApi(Resource):
    """Read or submit a Human Input v2 form without sharing v1 submission logic."""

    @web_ns.response(200, "Success", web_ns.models[FormDefinitionResponse.__name__])
    def get(self, form_token: str):
        _raise_stub_not_implemented()

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
                ip_address=extract_remote_ip(request),
            )
        except EmailOtpError as error:
            raise _EmailOtpHTTPError(error) from None
        except HumanInputFormError as error:
            code, status = {
                HumanInputFormErrorCode.NOT_FOUND: (OtpFailure.NOT_FOUND.value, 404),
                HumanInputFormErrorCode.ALREADY_SUBMITTED: (OtpFailure.SUBMITTED.value, 412),
                HumanInputFormErrorCode.EXPIRED: (OtpFailure.EXPIRED.value, 412),
                HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE: (HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE.value, 409),
                HumanInputFormErrorCode.INVALID_INPUT: (HumanInputFormErrorCode.INVALID_INPUT.value, 400),
            }[error.code]
            return {"code": code, "message": "The form submission could not be accepted."}, status
        return FormSubmitResponse().model_dump(mode="json")


@web_ns.route("/form/human-input/v2/public/<string:form_token>/upload-token")
class HumanInputV2FormUploadTokenApi(Resource):
    """Issue an upload token for an active Human Input v2 form."""

    @web_ns.response(200, "Success", web_ns.models[FormUploadTokenResponse.__name__])
    def post(self, form_token: str):
        _raise_stub_not_implemented()


@web_ns.route("/form/human-input/v2/public/<string:form_token>/access-request")
class FormAccessRequestApi(Resource):
    @web_ns.response(200, "Success", web_ns.models[FormAccessRequestResponse.__name__])
    def post(self, form_token: str):
        try:
            challenge = build_email_otp_service().request_access(form_token)
        except EmailOtpError as error:
            raise _EmailOtpHTTPError(error) from None
        return FormAccessRequestResponse(
            challenge_token=challenge.challenge_token,
            expires_in_seconds=challenge.expires_in_seconds,
            resend_after_seconds=challenge.resend_after_seconds,
        ).model_dump(mode="json")
