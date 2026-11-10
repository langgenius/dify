"""Account-bound email verification for WebApp users, independent of Builder membership."""

from http import HTTPStatus

from flask import make_response, request
from flask_restx import Resource
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.common.account import (
    ChangeEmailResetPayload,
    ChangeEmailSendPayload,
    ChangeEmailValidityPayload,
    CheckEmailUniquePayload,
)
from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailChangeLimitError,
    EmailChangeRateLimitExceededError,
    EmailCodeError,
    InvalidEmailError,
    InvalidTokenError,
)
from controllers.console.error import AccountInFreezeError, EmailDomainSuspendedError, EmailSendIpLimitError
from controllers.web import web_ns
from controllers.web.account import WebAccountResponse
from controllers.web.account_admission import web_account_context
from extensions.ext_application_services import application_services
from libs.external_api import error_responses
from libs.helper import dump_response, extract_remote_ip
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


@web_ns.route("/account/change-email")
class WebAccountChangeEmailSendApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailSendPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Verification challenge", web_ns.models[SimpleResultDataResponse.__name__])
    @error_responses(EmailChangeRateLimitExceededError, EmailSendIpLimitError, InvalidEmailError, InvalidTokenError)
    def post(self):
        """Send an old/new-email challenge for the cookie Account; no profile changes occur."""
        context = _change_email_context()
        payload = ChangeEmailSendPayload.model_validate(web_ns.payload or {})
        try:
            token = application_services().accounts.change_email.send_code(
                context,
                requested_email=payload.email,
                language="zh-Hans" if payload.language == "zh-Hans" else "en-US",
                phase=payload.phase,
                predecessor_token=payload.token,
                ip_address=extract_remote_ip(request),
            )
        except account_errors.ChangeEmailSendIPLimitedError as error:
            raise EmailSendIpLimitError() from error
        except account_errors.ChangeEmailSendRateLimitError as error:
            raise EmailChangeRateLimitExceededError(error.retry_after_minutes) from error
        except account_errors.InvalidChangeEmailTokenError as error:
            raise InvalidTokenError() from error
        except account_errors.InvalidChangeEmailAddressError as error:
            raise InvalidEmailError() from error
        except account_errors.AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        response = make_response(SimpleResultDataResponse(result="success", data=token).model_dump(mode="json"))
        response.headers["Cache-Control"] = "no-store"
        return response


@web_ns.route("/account/change-email/validity")
class WebAccountChangeEmailValidityApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailValidityPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Verified challenge", web_ns.models[VerificationTokenResponse.__name__])
    @error_responses(EmailChangeLimitError, EmailCodeError, InvalidEmailError, InvalidTokenError)
    def post(self):
        """Verify this Account's challenge and promote its token without changing identity."""
        context = _change_email_context()
        payload = ChangeEmailValidityPayload.model_validate(web_ns.payload or {})
        try:
            verified = application_services().accounts.change_email.verify_code(
                context, email=payload.email, code=payload.code, token=payload.token
            )
        except account_errors.ChangeEmailVerificationLimitError as error:
            raise EmailChangeLimitError() from error
        except account_errors.InvalidChangeEmailTokenError as error:
            raise InvalidTokenError() from error
        except account_errors.InvalidChangeEmailAddressError as error:
            raise InvalidEmailError() from error
        except account_errors.InvalidChangeEmailCodeError as error:
            raise EmailCodeError() from error
        response = make_response(
            VerificationTokenResponse(is_valid=True, email=verified.email, token=verified.token).model_dump(mode="json")
        )
        response.headers["Cache-Control"] = "no-store"
        return response


@web_ns.route("/account/change-email/reset")
class WebAccountChangeEmailResetApi(Resource):
    @web_ns.expect(web_ns.models[ChangeEmailResetPayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Updated Account settings", web_ns.models[WebAccountResponse.__name__])
    @error_responses(AccountInFreezeError, EmailAlreadyInUseError, EmailDomainSuspendedError, InvalidTokenError)
    def post(self):
        """Change only the admitted Account's verified address; failures preserve identity and memberships."""
        context = _change_email_context()
        payload = ChangeEmailResetPayload.model_validate(web_ns.payload or {})
        try:
            updated = application_services().accounts.change_email.reset(
                context, new_email=payload.new_email, token=payload.token
            )
        except account_errors.AccountEmailDomainSuspendedError as error:
            raise EmailDomainSuspendedError() from error
        except account_errors.AccountEmailFrozenError as error:
            raise AccountInFreezeError() from error
        except account_errors.AccountEmailAlreadyInUseError as error:
            raise EmailAlreadyInUseError() from error
        except account_errors.InvalidChangeEmailTokenError as error:
            raise InvalidTokenError() from error
        except account_errors.AccountNotFoundError as error:
            raise Unauthorized("Account login required.") from error
        response = make_response(dump_response(WebAccountResponse, updated))
        response.headers["Cache-Control"] = "no-store"
        return response


@web_ns.route("/account/change-email/check-email-unique")
class WebAccountCheckEmailUniqueApi(Resource):
    @web_ns.expect(web_ns.models[CheckEmailUniquePayload.__name__])
    @web_ns.response(HTTPStatus.OK, "Email available", web_ns.models[SimpleResultResponse.__name__])
    @error_responses(AccountInFreezeError, EmailAlreadyInUseError, EmailDomainSuspendedError)
    def post(self):
        """Check email availability for an admitted Account; do not mutate accounts or tokens."""
        _change_email_context()
        payload = CheckEmailUniquePayload.model_validate(web_ns.payload or {})
        try:
            application_services().accounts.change_email.ensure_available(payload.email)
        except account_errors.AccountEmailDomainSuspendedError as error:
            raise EmailDomainSuspendedError() from error
        except account_errors.AccountEmailFrozenError as error:
            raise AccountInFreezeError() from error
        except account_errors.AccountEmailAlreadyInUseError as error:
            raise EmailAlreadyInUseError() from error
        response = make_response(SimpleResultResponse(result="success").model_dump(mode="json"))
        response.headers["Cache-Control"] = "no-store"
        return response
