from flask import request
from flask_restx import Resource

from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
    PasswordResetRateLimitExceededError,
)
from controllers.console.error import EmailSendIpLimitError
from controllers.console.wraps import (
    email_password_login_enabled,
    model_validate,
    only_edition_enterprise,
    setup_required,
)
from controllers.web import web_ns
from extensions.ext_application_services import application_services
from libs.helper import extract_remote_ip
from services import account_errors
from services.entities.auth_entities import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)

register_schema_models(web_ns, ForgotPasswordSendPayload, ForgotPasswordCheckPayload, ForgotPasswordResetPayload)
register_response_schema_models(
    web_ns,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)


@web_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordSendPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    @web_ns.doc("send_forgot_password_email")
    @web_ns.doc(description="Send password reset email")
    @web_ns.doc(
        responses={
            200: "Password reset email sent successfully",
            400: "Bad request - invalid email format",
            404: "Account not found",
            429: "Too many requests - rate limit exceeded",
        }
    )
    @web_ns.response(200, "Password reset email sent successfully", web_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(ForgotPasswordSendPayload)
    def post(self, payload: ForgotPasswordSendPayload):
        try:
            token = application_services().accounts.forgot_password.send_code(
                email=payload.email,
                language="zh-Hans" if payload.language == "zh-Hans" else "en-US",
                ip_address=extract_remote_ip(request),
                require_account=True,
            )
        except account_errors.AccountNotFoundError:
            raise AuthenticationFailedError() from None
        except account_errors.ForgotPasswordSendIPLimitedError:
            raise EmailSendIpLimitError() from None
        except account_errors.ForgotPasswordSendRateLimitError as error:
            raise PasswordResetRateLimitExceededError(error.retry_after_minutes) from None
        return {"result": "success", "data": token}


@web_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordCheckPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    @web_ns.doc("check_forgot_password_token")
    @web_ns.doc(description="Verify password reset token validity")
    @web_ns.doc(
        responses={200: "Token is valid", 400: "Bad request - invalid token format", 401: "Invalid or expired token"}
    )
    @web_ns.response(200, "Token is valid", web_ns.models[VerificationTokenResponse.__name__])
    @model_validate(ForgotPasswordCheckPayload)
    def post(self, payload: ForgotPasswordCheckPayload):
        try:
            verification = application_services().accounts.forgot_password.verify_code(
                email=payload.email,
                code=payload.code,
                token=payload.token,
            )
        except account_errors.ForgotPasswordVerificationLimitError:
            raise EmailPasswordResetLimitError() from None
        except account_errors.InvalidForgotPasswordTokenError:
            raise InvalidTokenError() from None
        except account_errors.InvalidForgotPasswordEmailError:
            raise InvalidEmailError() from None
        except account_errors.InvalidForgotPasswordCodeError:
            raise EmailCodeError() from None
        return {"is_valid": True, "email": verification.email, "token": verification.token}


@web_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordResetPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    @web_ns.doc("reset_password")
    @web_ns.doc(description="Reset user password with verification token")
    @web_ns.doc(
        responses={
            200: "Password reset successfully",
            400: "Bad request - invalid parameters or password mismatch",
            401: "Invalid or expired token",
            404: "Account not found",
        }
    )
    @web_ns.response(200, "Password reset successfully", web_ns.models[SimpleResultResponse.__name__])
    @model_validate(ForgotPasswordResetPayload)
    def post(self, payload: ForgotPasswordResetPayload):
        # Validate passwords match
        try:
            application_services().accounts.forgot_password.reset(
                token=payload.token,
                new_password=payload.new_password,
                password_confirm=payload.password_confirm,
            )
        except account_errors.ForgotPasswordMismatchError:
            raise PasswordMismatchError() from None
        except account_errors.InvalidForgotPasswordTokenError:
            raise InvalidTokenError() from None
        except account_errors.AccountNotFoundError:
            raise AuthenticationFailedError() from None
        return {"result": "success"}
