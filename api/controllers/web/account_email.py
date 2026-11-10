"""Account-bound email verification for WebApp users, independent of Builder membership."""

from http import HTTPStatus

from flask import Response, make_response, request
from flask_restx import Resource
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.account_email import (
    check_change_email_available,
    reset_change_email,
    send_change_email_code,
    verify_change_email_code,
)
from controllers.account_email_errors import (
    AccountInFreezeError,
    EmailAlreadyInUseError,
    EmailChangeLimitError,
    EmailChangeRateLimitExceededError,
    EmailCodeError,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.common.account import (
    ChangeEmailResetPayload,
    ChangeEmailSendPayload,
    ChangeEmailValidityPayload,
    CheckEmailUniquePayload,
)
from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.account import WebAccountResponse
from controllers.web.account_admission import web_account_context
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import extract_remote_ip
from machinery.context import AccountRequestContext
from services import account_errors
from services.system_feature_service import SystemFeatureService

register_schema_models(
    web_ns, ChangeEmailSendPayload, ChangeEmailValidityPayload, ChangeEmailResetPayload, CheckEmailUniquePayload
)
register_response_schema_models(web_ns, SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse)


def _change_email_context() -> AccountRequestContext:
    """Require an admitted same-origin Account and enabled email changes before processing input."""
    context = web_account_context()
    if not SystemFeatureService.is_change_email_enabled():
        raise Forbidden()
    return context


def _private_response(payload: ResponseModel) -> Response:
    """Serialize admitted Account data without shared caching; schemas stay surface-specific."""
    response = make_response(payload.model_dump(mode="json"))
    response.headers["Cache-Control"] = "no-store"
    return response


@web_ns.route("/account/change-email")
class WebAccountChangeEmailSendApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailSendPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Verification challenge", web_ns.models[SimpleResultDataResponse.__name__])
    @error_responses(EmailChangeRateLimitExceededError, EmailSendIpLimitError, InvalidEmailError, InvalidTokenError)
    def post(self):
        """Send an old/new-email challenge for the cookie Account; no profile changes occur."""
        context = _change_email_context()
        try:
            result = send_change_email_code(
                application_services().accounts.change_email,
                context,
                web_ns.payload or {},
                ip_address=extract_remote_ip(request),
            )
        except account_errors.AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        return _private_response(result)


@web_ns.route("/account/change-email/validity")
class WebAccountChangeEmailValidityApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailValidityPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Verified challenge", web_ns.models[VerificationTokenResponse.__name__])
    @error_responses(EmailChangeLimitError, EmailCodeError, InvalidEmailError, InvalidTokenError)
    def post(self):
        """Verify this Account's challenge and promote its token without changing identity."""
        context = _change_email_context()
        result = verify_change_email_code(application_services().accounts.change_email, context, web_ns.payload or {})
        return _private_response(result)


@web_ns.route("/account/change-email/reset")
class WebAccountChangeEmailResetApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailResetPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Updated Account settings", web_ns.models[WebAccountResponse.__name__])
    @error_responses(AccountInFreezeError, EmailAlreadyInUseError, EmailDomainSuspendedError, InvalidTokenError)
    def post(self):
        """Change only the admitted Account's verified address; failures preserve identity and memberships."""
        context = _change_email_context()
        try:
            updated = reset_change_email(application_services().accounts.change_email, context, web_ns.payload or {})
        except account_errors.AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        return _private_response(WebAccountResponse.model_validate(updated, from_attributes=True))


@web_ns.route("/account/change-email/check-email-unique")
class WebAccountCheckEmailUniqueApi(Resource):
    @web_ns.expect(web_ns.models[CheckEmailUniquePayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Email available", web_ns.models[SimpleResultResponse.__name__])
    @error_responses(AccountInFreezeError, EmailAlreadyInUseError, EmailDomainSuspendedError)
    def post(self):
        """Check email availability for an admitted Account; do not mutate accounts or tokens."""
        _change_email_context()
        result = check_change_email_available(application_services().accounts.change_email, web_ns.payload or {})
        return _private_response(result)
