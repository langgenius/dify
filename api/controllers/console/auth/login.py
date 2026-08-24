from http import HTTPStatus
from typing import Never
from uuid import UUID

import flask_login
from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.fields import (
    SimpleResultDataResponse,
    SimpleResultMessageResponse,
    SimpleResultOptionalDataResponse,
    SimpleResultResponse,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailCodeLoginRateLimitExceededError,
    EmailCodeLoginServiceUnavailableError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordResetRateLimitExceededError,
    TurnstileServiceUnavailableError,
    TurnstileVerificationFailedError,
)
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    AccountNotFound,
    EmailDomainSuspendedError,
    EmailSendIpLimitError,
    InvalidAccountPasswordRequestError,
    NotAllowedCreateWorkspace,
    SeatsLimitExceeded,
    WorkspacesLimitExceeded,
)
from controllers.console.wraps import (
    decrypt_code_field,
    decrypt_password_field,
    email_password_login_enabled,
    model_validate,
    setup_required,
)
from extensions.ext_application_services import application_services
from libs.helper import EmailStr, dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.login import current_account_with_tenant_optional
from libs.token import (
    clear_access_token_from_cookie,
    clear_csrf_token_from_cookie,
    clear_refresh_token_from_cookie,
    extract_refresh_token,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from services import account_errors
from services.entities.account_login_entities import (
    AuthTokenPair,
    EmailCodeLoginCommand,
    EmailCodeSendCommand,
    PasswordLoginCommand,
)
from services.entities.auth_entities import LoginPayloadBase


class LoginPayload(LoginPayloadBase):
    remember_me: bool = Field(default=False, description="Remember me flag")
    invite_token: str | None = Field(default=None, description="Invitation token")


class EmailPayload(BaseModel):
    email: EmailStr = Field(...)
    language: str | None = Field(default=None)


class EmailCodeSendPayload(EmailPayload):
    turnstile_token: str | None = Field(
        default=None,
        max_length=2048,
        description="Cloudflare Turnstile token. Required at runtime for Dify Cloud.",
    )


class EmailCodeLoginPayload(BaseModel):
    email: EmailStr = Field(...)
    code: str
    token: UUID
    turnstile_token: str | None = Field(
        default=None,
        max_length=2048,
        description="Cloudflare Turnstile token for email-code verification.",
    )
    language: str | None = Field(default=None)
    timezone: str | None = Field(default=None)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_timezone_string(value)


register_schema_models(console_ns, LoginPayload, EmailPayload, EmailCodeSendPayload, EmailCodeLoginPayload)
register_response_schema_models(
    console_ns,
    SimpleResultDataResponse,
    SimpleResultMessageResponse,
    SimpleResultOptionalDataResponse,
    SimpleResultResponse,
)


@console_ns.route("/login")
class LoginApi(Resource):
    """Resource for user login."""

    @setup_required
    @email_password_login_enabled
    @console_ns.expect(console_ns.models[LoginPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultOptionalDataResponse.__name__])
    @decrypt_password_field
    @model_validate(LoginPayload)
    def post(self, req_data: LoginPayload):
        """Authenticate user and login."""
        try:
            result = application_services().accounts.authentication.login_with_password(
                PasswordLoginCommand(
                    email=req_data.email,
                    password=req_data.password,
                    invite_token=req_data.invite_token,
                    ip_address=extract_remote_ip(request),
                )
            )
        except account_errors.AccountApplicationError as error:
            _raise_request_error(error)

        if not result.workspace_found or result.token_pair is None:
            return dump_response(
                SimpleResultOptionalDataResponse,
                {
                    "result": "fail",
                    "data": "workspace not found, please contact system admin to invite you to join in a workspace",
                },
            )
        return _token_response(result.token_pair, SimpleResultOptionalDataResponse, {"result": "success"})


@console_ns.route("/logout")
class LogoutApi(Resource):
    @setup_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    def post(self):
        account, _ = current_account_with_tenant_optional()
        if account is not None:
            application_services().accounts.authentication.logout(account.id)
            flask_login.logout_user()

        response = make_response(dump_response(SimpleResultResponse, {"result": "success"}))
        clear_access_token_from_cookie(response)
        clear_refresh_token_from_cookie(response)
        clear_csrf_token_from_cookie(response)
        return response


@console_ns.route("/reset-password")
class ResetPasswordSendEmailApi(Resource):
    @setup_required
    @email_password_login_enabled
    @console_ns.expect(console_ns.models[EmailPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailPayload)
    def post(self, req_data: EmailPayload):
        try:
            token = application_services().accounts.authentication.send_reset_password_email(
                email=req_data.email,
                language=req_data.language,
                ip_address=extract_remote_ip(request),
            )
        except account_errors.AccountApplicationError as error:
            _raise_request_error(error)
        return dump_response(SimpleResultDataResponse, {"result": "success", "data": token})


@console_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailCodeSendPayload)
    def post(self, req_data: EmailCodeSendPayload):
        try:
            token = application_services().accounts.authentication.send_email_code(
                EmailCodeSendCommand(
                    email=req_data.email,
                    language=req_data.language,
                    turnstile_token=req_data.turnstile_token,
                    ip_address=extract_remote_ip(request),
                )
            )
        except account_errors.AccountApplicationError as error:
            _raise_request_error(error)
        return dump_response(SimpleResultDataResponse, {"result": "success", "data": token})


@console_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeLoginPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @decrypt_code_field
    @model_validate(EmailCodeLoginPayload)
    def post(self, req_data: EmailCodeLoginPayload):
        try:
            token_pair = application_services().accounts.authentication.login_with_email_code(
                EmailCodeLoginCommand(
                    email=req_data.email,
                    code=req_data.code,
                    token=str(req_data.token),
                    turnstile_token=req_data.turnstile_token,
                    language=req_data.language,
                    timezone=req_data.timezone,
                    ip_address=extract_remote_ip(request),
                )
            )
        except account_errors.AccountApplicationError as error:
            _raise_request_error(error)
        return _token_response(token_pair, SimpleResultResponse, {"result": "success"})


@console_ns.route("/refresh-token")
class RefreshTokenApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(401, "Unauthorized", console_ns.models[SimpleResultMessageResponse.__name__])
    def post(self):
        refresh_token = extract_refresh_token(request)
        if not refresh_token:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": "No refresh token provided"},
            ), HTTPStatus.UNAUTHORIZED

        try:
            token_pair = application_services().accounts.authentication.refresh(refresh_token)
        except account_errors.InvalidRefreshTokenError as error:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": str(error)},
            ), HTTPStatus.UNAUTHORIZED
        return _token_response(token_pair, SimpleResultResponse, {"result": "success"})


def _token_response(token_pair: AuthTokenPair, response_model: type[BaseModel], data: object):
    # response-contract:ignore cookie-bearing Flask response
    response = make_response(dump_response(response_model, data))
    set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
    set_access_token_to_cookie(request, response, token_pair.access_token)
    set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
    return response


def _raise_request_error(error: account_errors.AccountApplicationError) -> Never:
    if isinstance(error, account_errors.AccountEmailDomainSuspendedError):
        raise EmailDomainSuspendedError() from error
    if isinstance(error, account_errors.AccountEmailFrozenError):
        raise AccountInFreezeError() from error
    if isinstance(error, account_errors.LoginRateLimitError):
        raise EmailPasswordLoginLimitError() from error
    if isinstance(error, account_errors.InvalidLoginCredentialsError):
        raise AuthenticationFailedError() from error
    if isinstance(error, account_errors.InvalidAccountPasswordError):
        raise InvalidAccountPasswordRequestError(description=str(error)) from error
    if isinstance(error, account_errors.LoginAccountBannedError):
        raise AccountBannedError() from error
    if isinstance(error, account_errors.InvalidLoginInvitationEmailError):
        raise InvalidEmailError() from error
    if isinstance(error, account_errors.LoginWorkspaceLimitError):
        raise WorkspacesLimitExceeded() from error
    if isinstance(error, account_errors.LoginWorkspaceCreationNotAllowedError):
        raise NotAllowedCreateWorkspace() from error
    if isinstance(error, account_errors.LoginSeatLimitError):
        raise SeatsLimitExceeded() from error
    if isinstance(error, account_errors.EmailCodeSendIPLimitedError):
        raise EmailSendIpLimitError() from error
    if isinstance(error, account_errors.EmailCodeSendRateLimitError):
        raise EmailCodeLoginRateLimitExceededError(error.retry_after_minutes) from error
    if isinstance(error, account_errors.HumanVerificationRejectedError):
        raise TurnstileVerificationFailedError() from error
    if isinstance(error, account_errors.HumanVerificationUnavailableError):
        raise TurnstileServiceUnavailableError() from error
    if isinstance(error, account_errors.EmailCodeLoginUnavailableError):
        raise EmailCodeLoginServiceUnavailableError() from error
    if isinstance(error, account_errors.InvalidEmailCodeTokenError):
        raise InvalidTokenError() from error
    if isinstance(error, account_errors.EmailCodeEmailMismatchError):
        raise InvalidEmailError() from error
    if isinstance(error, account_errors.InvalidEmailCodeError):
        raise EmailCodeError() from error
    if isinstance(error, account_errors.AccountNotFoundError):
        raise AccountNotFound() from error
    if isinstance(error, account_errors.ResetPasswordEmailRateLimitError):
        raise PasswordResetRateLimitExceededError(error.retry_after_minutes) from error
    raise error
