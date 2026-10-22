from contextlib import suppress
from http import HTTPStatus
from typing import Literal, Never
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
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.web_login import WebLoginUnavailableHTTPError, web_login_errors
from controllers.console import console_ns
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailCodeLoginRateLimitExceededError,
    EmailCodeLoginServiceUnavailableError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
    InvalidTokenError,
    NormalizedEmailAlreadyInUseError,
    PasswordResetRateLimitExceededError,
    TurnstileServiceUnavailableError,
    TurnstileVerificationFailedError,
)
from controllers.console.auth.login_mode import require_login_mode
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
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import EmailStr, dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.login import current_account_with_tenant_optional
from libs.token import (
    clear_access_token_from_cookie,
    clear_csrf_token_from_cookie,
    clear_refresh_token_from_cookie,
    extract_console_cookie_token,
    extract_refresh_token,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from services import account_errors
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import (
    EmailCodeLoginCommand,
    EmailCodeSendCommand,
    LoginMode,
    PasswordLoginCommand,
)
from services.entities.auth_entities import LoginPayloadBase
from services.web_login_handoff import WebLoginTarget
from services.web_passport_service import WebPassportUnauthorizedError


class LoginPayload(LoginPayloadBase):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE,
        description="End User mode authenticates an Account without workspace admission or provisioning.",
    )
    remember_me: bool = Field(default=False, description="Remember me flag")
    invite_token: str | None = Field(default=None, description="Invitation token")


class EmailPayload(BaseModel):
    email: EmailStr = Field(...)
    language: str | None = Field(default=None)


class EmailCodeSendPayload(EmailPayload):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE,
        description="End User mode authenticates an Account without workspace admission or provisioning.",
    )
    turnstile_token: str | None = Field(
        default=None,
        max_length=2048,
        description="Cloudflare Turnstile token. Required at runtime for Dify Cloud.",
    )


class EmailCodeLoginPayload(BaseModel):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE,
        description="End User mode authenticates an Account without workspace admission or provisioning.",
    )
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


class RefreshTokenPayload(BaseModel):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE, description="End User mode refreshes the Account session without workspace admission"
    )


class WebAppAccountSessionQuery(WebLoginTarget):
    mode: Literal["end_user"] = "end_user"


class WebAppAccountSessionResponse(ResponseModel):
    logged_in: bool
    redirect_url: str | None


register_schema_models(
    console_ns,
    LoginPayload,
    EmailPayload,
    EmailCodeSendPayload,
    EmailCodeLoginPayload,
    RefreshTokenPayload,
    WebAppAccountSessionQuery,
)
register_response_schema_models(
    console_ns,
    WebAppAccountSessionResponse,
    SimpleResultDataResponse,
    SimpleResultMessageResponse,
    SimpleResultOptionalDataResponse,
    SimpleResultResponse,
)


@console_ns.route("/login")
class LoginApi(Resource):
    """Resource for user login and silent reuse of an existing Account session."""

    @setup_required
    @console_ns.doc("reuse_web_app_account_login")
    @console_ns.doc(
        description="Called by /signin in the Account origin before showing a login form and after successful login. "
        "Reuses or refreshes the existing Account session without workspace admission. "
        "Returns logged_in=false when authentication is needed; otherwise returns a one-use "
        "PKCE-bound callback to the existing /webapp-signin page."
    )
    @console_ns.doc(params=query_params_from_model(WebAppAccountSessionQuery))
    @console_ns.response(200, "Existing Account session", console_ns.models[WebAppAccountSessionResponse.__name__])
    @error_responses(WebLoginUnavailableHTTPError)
    @model_validate(WebAppAccountSessionQuery)
    def get(self, query: WebAppAccountSessionQuery):
        require_login_mode(LoginMode.END_USER)
        with web_login_errors():
            handoff = application_services().web_login_handoff
            handoff.validate_target(query)
            access_token = extract_console_cookie_token(request)
            tokens = None
            redirect_url = None
            if access_token:
                with suppress(WebPassportUnauthorizedError):
                    redirect_url = handoff.authorize(query, access_token)
            if redirect_url is None and (refresh_token := extract_refresh_token(request)):
                try:
                    tokens = application_services().accounts.authentication.refresh(
                        refresh_token, mode=LoginMode.END_USER
                    )
                    redirect_url = handoff.authorize(query, tokens.access_token)
                except (account_errors.InvalidRefreshTokenError, WebPassportUnauthorizedError):
                    tokens = None
            data = {"logged_in": redirect_url is not None, "redirect_url": redirect_url}
            if tokens is not None:
                return _token_response(tokens, WebAppAccountSessionResponse, data)
        # response-contract:ignore authentication state must not be cached
        response = make_response(dump_response(WebAppAccountSessionResponse, data))
        response.headers["Cache-Control"] = "no-store"
        return response

    @error_responses(
        AccountBannedError,
        AccountInFreezeError,
        AccountNotFound,
        AuthenticationFailedError,
        EmailDomainSuspendedError,
        EmailPasswordLoginLimitError,
        InvalidAccountPasswordRequestError,
        InvalidEmailError,
        WorkspacesLimitExceeded,
    )
    @setup_required
    @email_password_login_enabled
    @console_ns.expect(console_ns.models[LoginPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultOptionalDataResponse.__name__])
    @decrypt_password_field
    @model_validate(LoginPayload)
    def post(self, req_data: LoginPayload):
        """Authenticate user and login."""
        require_login_mode(req_data.mode, invite_token=req_data.invite_token)
        try:
            result = application_services().accounts.authentication.login_with_password(
                PasswordLoginCommand(
                    mode=req_data.mode,
                    email=req_data.email,
                    password=req_data.password,
                    invite_token=req_data.invite_token,
                    ip_address=extract_remote_ip(request),
                )
            )
        except account_errors.AccountApplicationError as error:
            _raise_password_login_error(error)

        if result.tokens is None:
            return dump_response(
                SimpleResultOptionalDataResponse,
                {
                    "result": "fail",
                    "data": "workspace not found, please contact system admin to invite you to join in a workspace",
                },
            )
        return _token_response(result.tokens, SimpleResultOptionalDataResponse, {"result": "success"})


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
    @error_responses(
        AccountBannedError, AccountInFreezeError, EmailDomainSuspendedError, PasswordResetRateLimitExceededError
    )
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
            _raise_reset_password_email_error(error)
        return dump_response(SimpleResultDataResponse, {"result": "success", "data": token})


@console_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @error_responses(
        AccountBannedError,
        AccountInFreezeError,
        EmailCodeLoginRateLimitExceededError,
        EmailCodeLoginServiceUnavailableError,
        EmailDomainSuspendedError,
        EmailSendIpLimitError,
        TurnstileServiceUnavailableError,
        TurnstileVerificationFailedError,
    )
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailCodeSendPayload)
    def post(self, req_data: EmailCodeSendPayload):
        require_login_mode(req_data.mode)
        try:
            token = application_services().accounts.authentication.send_email_code(
                EmailCodeSendCommand(
                    mode=req_data.mode,
                    email=req_data.email,
                    language=req_data.language,
                    turnstile_token=req_data.turnstile_token,
                    ip_address=extract_remote_ip(request),
                )
            )
        except account_errors.AccountApplicationError as error:
            _raise_email_code_send_error(error)
        return dump_response(SimpleResultDataResponse, {"result": "success", "data": token})


@console_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @error_responses(
        AccountBannedError,
        AccountInFreezeError,
        AccountNotFound,
        EmailCodeError,
        EmailCodeLoginServiceUnavailableError,
        EmailDomainSuspendedError,
        InvalidEmailError,
        InvalidTokenError,
        NormalizedEmailAlreadyInUseError,
        NotAllowedCreateWorkspace,
        SeatsLimitExceeded,
        TurnstileServiceUnavailableError,
        TurnstileVerificationFailedError,
        WorkspacesLimitExceeded,
    )
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeLoginPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @decrypt_code_field
    @model_validate(EmailCodeLoginPayload)
    def post(self, req_data: EmailCodeLoginPayload):
        require_login_mode(req_data.mode)
        try:
            tokens = application_services().accounts.authentication.login_with_email_code(
                EmailCodeLoginCommand(
                    mode=req_data.mode,
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
            _raise_email_code_login_error(error)
        return _token_response(tokens, SimpleResultResponse, {"result": "success"})


@console_ns.route("/refresh-token")
class RefreshTokenApi(Resource):
    # Existing callers refresh without a request body.
    @console_ns.doc(params={"payload": {"required": False}})
    @console_ns.expect(console_ns.models[RefreshTokenPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(401, "Unauthorized", console_ns.models[SimpleResultMessageResponse.__name__])
    def post(self):
        payload = RefreshTokenPayload.model_validate(request.get_json(silent=True) or {})
        require_login_mode(payload.mode)
        refresh_token = extract_refresh_token(request)
        if not refresh_token:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": "No refresh token provided"},
            ), HTTPStatus.UNAUTHORIZED

        try:
            tokens = application_services().accounts.authentication.refresh(refresh_token, mode=payload.mode)
        except account_errors.InvalidRefreshTokenError as error:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": str(error)},
            ), HTTPStatus.UNAUTHORIZED
        return _token_response(tokens, SimpleResultResponse, {"result": "success"})


def _token_response(tokens: AccountSessionTokens, response_model: type[BaseModel], data: object):
    # response-contract:ignore cookie-bearing Flask response
    response = make_response(dump_response(response_model, data))
    response.headers["Cache-Control"] = "no-store"
    set_csrf_token_to_cookie(request, response, tokens.csrf_token)
    set_access_token_to_cookie(request, response, tokens.access_token)
    set_refresh_token_to_cookie(request, response, tokens.refresh_token)
    return response


def _raise_account_state_error(error: account_errors.AccountApplicationError) -> Never:
    """Translate the account-state errors every login flow checks first."""
    if isinstance(error, account_errors.AccountEmailDomainSuspendedError):
        raise EmailDomainSuspendedError() from error
    if isinstance(error, account_errors.AccountEmailFrozenError):
        raise AccountInFreezeError() from error
    if isinstance(error, account_errors.LoginAccountBannedError):
        raise AccountBannedError() from error
    raise error


def _raise_password_login_error(error: account_errors.AccountApplicationError) -> Never:
    if isinstance(error, account_errors.LoginRateLimitError):
        raise EmailPasswordLoginLimitError() from error
    if isinstance(error, account_errors.InvalidLoginCredentialsError):
        raise AuthenticationFailedError() from error
    if isinstance(error, account_errors.InvalidAccountPasswordError):
        raise InvalidAccountPasswordRequestError(description=str(error)) from error
    if isinstance(error, account_errors.InvalidLoginInvitationEmailError):
        raise InvalidEmailError() from error
    if isinstance(error, account_errors.LoginWorkspaceLimitError):
        raise WorkspacesLimitExceeded() from error
    if isinstance(error, account_errors.AccountNotFoundError):
        raise AccountNotFound() from error
    _raise_account_state_error(error)


def _raise_reset_password_email_error(error: account_errors.AccountApplicationError) -> Never:
    if isinstance(error, account_errors.ResetPasswordEmailRateLimitError):
        raise PasswordResetRateLimitExceededError(error.retry_after_minutes) from error
    _raise_account_state_error(error)


def _raise_email_code_send_error(error: account_errors.AccountApplicationError) -> Never:
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
    _raise_account_state_error(error)


def _raise_email_code_login_error(error: account_errors.AccountApplicationError) -> Never:
    if isinstance(error, account_errors.InvalidEmailCodeTokenError):
        raise InvalidTokenError() from error
    if isinstance(error, account_errors.EmailCodeEmailMismatchError):
        raise InvalidEmailError() from error
    if isinstance(error, account_errors.InvalidEmailCodeError):
        raise EmailCodeError() from error
    if isinstance(error, account_errors.HumanVerificationRejectedError):
        raise TurnstileVerificationFailedError() from error
    if isinstance(error, account_errors.HumanVerificationUnavailableError):
        raise TurnstileServiceUnavailableError() from error
    if isinstance(error, account_errors.EmailCodeLoginUnavailableError):
        raise EmailCodeLoginServiceUnavailableError() from error
    if isinstance(error, account_errors.AccountNotFoundError):
        raise AccountNotFound() from error
    if isinstance(error, account_errors.LoginWorkspaceLimitError):
        raise WorkspacesLimitExceeded() from error
    if isinstance(error, account_errors.LoginWorkspaceCreationNotAllowedError):
        raise NotAllowedCreateWorkspace() from error
    if isinstance(error, account_errors.LoginSeatLimitError):
        raise SeatsLimitExceeded() from error
    if isinstance(error, account_errors.AccountNormalizedEmailAlreadyInUseError):
        raise NormalizedEmailAlreadyInUseError() from error
    _raise_account_state_error(error)
