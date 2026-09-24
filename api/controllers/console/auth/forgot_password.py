from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
    PasswordResetRateLimitExceededError,
)
from controllers.console.error import AccountNotFound, EmailSendIpLimitError
from controllers.console.wraps import email_password_login_enabled, model_validate, setup_required
from extensions.ext_application_services import application_services
from libs.helper import EmailStr, dump_response, extract_remote_ip
from services import account_errors
from services.entities.auth_entities import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)


class ForgotPasswordEmailResponse(BaseModel):
    result: str = Field(description="Operation result")
    data: str | None = Field(default=None, description="Reset token")


class ForgotPasswordCheckResponse(BaseModel):
    is_valid: bool = Field(description="Whether code is valid")
    email: EmailStr = Field(description="Email address")
    token: str = Field(description="New reset token")


class ForgotPasswordResetResponse(BaseModel):
    result: str = Field(description="Operation result")


register_schema_models(
    console_ns,
    ForgotPasswordSendPayload,
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordEmailResponse,
    ForgotPasswordCheckResponse,
    ForgotPasswordResetResponse,
)


@console_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @console_ns.doc("send_forgot_password_email")
    @console_ns.doc(description="Send password reset email")
    @console_ns.expect(console_ns.models[ForgotPasswordSendPayload.__name__])
    @console_ns.response(
        200,
        "Email sent successfully",
        console_ns.models[ForgotPasswordEmailResponse.__name__],
    )
    @console_ns.response(400, "Invalid email or rate limit exceeded")
    @setup_required
    @email_password_login_enabled
    @model_validate(ForgotPasswordSendPayload)
    def post(self, req_data: ForgotPasswordSendPayload):
        ip_address = extract_remote_ip(request)
        language = "zh-Hans" if req_data.language == "zh-Hans" else "en-US"
        try:
            token = application_services().accounts.forgot_password.send_code(
                email=req_data.email,
                language=language,
                ip_address=ip_address,
            )
        except account_errors.ForgotPasswordSendIPLimitedError:
            raise EmailSendIpLimitError() from None
        except account_errors.ForgotPasswordSendRateLimitError as error:
            raise PasswordResetRateLimitExceededError(error.retry_after_minutes) from None

        return dump_response(ForgotPasswordEmailResponse, {"result": "success", "data": token})


@console_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @console_ns.doc("check_forgot_password_code")
    @console_ns.doc(description="Verify password reset code")
    @console_ns.expect(console_ns.models[ForgotPasswordCheckPayload.__name__])
    @console_ns.response(
        200,
        "Code verified successfully",
        console_ns.models[ForgotPasswordCheckResponse.__name__],
    )
    @console_ns.response(400, "Invalid code or token")
    @setup_required
    @email_password_login_enabled
    @model_validate(ForgotPasswordCheckPayload)
    def post(self, req_data: ForgotPasswordCheckPayload):
        try:
            verification = application_services().accounts.forgot_password.verify_code(
                email=req_data.email,
                code=req_data.code,
                token=req_data.token,
            )
        except account_errors.ForgotPasswordVerificationLimitError:
            raise EmailPasswordResetLimitError() from None
        except account_errors.InvalidForgotPasswordTokenError:
            raise InvalidTokenError() from None
        except account_errors.InvalidForgotPasswordEmailError:
            raise InvalidEmailError() from None
        except account_errors.InvalidForgotPasswordCodeError:
            raise EmailCodeError() from None

        return dump_response(
            ForgotPasswordCheckResponse,
            {"is_valid": True, "email": verification.email, "token": verification.token},
        )


@console_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @console_ns.doc("reset_password")
    @console_ns.doc(description="Reset password with verification token")
    @console_ns.expect(console_ns.models[ForgotPasswordResetPayload.__name__])
    @console_ns.response(
        200,
        "Password reset successfully",
        console_ns.models[ForgotPasswordResetResponse.__name__],
    )
    @console_ns.response(400, "Invalid token or password mismatch")
    @setup_required
    @email_password_login_enabled
    @model_validate(ForgotPasswordResetPayload)
    def post(self, req_data: ForgotPasswordResetPayload):
        try:
            application_services().accounts.forgot_password.reset(
                token=req_data.token,
                new_password=req_data.new_password,
                password_confirm=req_data.password_confirm,
            )
        except account_errors.ForgotPasswordMismatchError:
            raise PasswordMismatchError() from None
        except account_errors.InvalidForgotPasswordTokenError:
            raise InvalidTokenError() from None
        except account_errors.AccountNotFoundError:
            raise AccountNotFound() from None

        return dump_response(ForgotPasswordResetResponse, {"result": "success"})
