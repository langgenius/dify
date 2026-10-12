import hmac
import re
from http import HTTPStatus
from typing import Never
from urllib.parse import urlsplit
from uuid import UUID

import jwt
from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import BadRequest, Forbidden, Unauthorized

from configs import dify_config
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
    NormalizedEmailAlreadyInUseError,
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
from libs.external_api import error_responses
from libs.helper import EmailStr, dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.login import current_account_with_tenant_optional, login_required
from libs.token import (
    clear_access_token_from_cookie,
    clear_csrf_token_from_cookie,
    clear_refresh_token_from_cookie,
    extract_csrf_token,
    extract_csrf_token_from_cookie,
    extract_refresh_token,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from services import account_errors
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import EmailCodeLoginCommand, EmailCodeSendCommand, PasswordLoginCommand
from services.entities.auth_entities import LoginPayloadBase

_REFRESH_ORIGIN_DESCRIPTION = (
    "Requires an Origin matching the Console web URL or API origin. "
    "Same-host proxy scheme/port changes additionally require a signed X-CSRF-Token matching the CSRF cookie."
)


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
            _raise_password_login_error(error)

        if not result.workspace_found or result.tokens is None:
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
    @console_ns.doc(description=_REFRESH_ORIGIN_DESCRIPTION)
    @console_ns.response(403, "Missing or untrusted Origin")
    def post(self):
        _check_refresh_origin()
        application_services().accounts.authentication.logout(extract_refresh_token(request))
        return _logout_response()


@console_ns.route("/logout-all")
class LogoutAllApi(Resource):
    @setup_required
    @login_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(401, "Unauthorized")
    @console_ns.doc(description=_REFRESH_ORIGIN_DESCRIPTION)
    @console_ns.response(403, "Missing or untrusted Origin")
    def post(self):
        """Revoke refresh sessions on every device for the authenticated account."""
        _check_refresh_origin()
        account, _ = current_account_with_tenant_optional()
        if account is None:
            raise Unauthorized()
        application_services().accounts.authentication.logout_all(account.id)
        return _logout_response()


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
        try:
            tokens = application_services().accounts.authentication.login_with_email_code(
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
            _raise_email_code_login_error(error)
        return _token_response(tokens, SimpleResultResponse, {"result": "success"})


@console_ns.route("/refresh-token")
class RefreshTokenApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(401, "Unauthorized", console_ns.models[SimpleResultMessageResponse.__name__])
    @console_ns.response(400, "Invalid refresh request UUID")
    @console_ns.doc(description=_REFRESH_ORIGIN_DESCRIPTION)
    @console_ns.response(403, "Missing or untrusted Origin")
    @console_ns.doc(
        params={
            "X-Refresh-Request-ID": {
                "in": "header",
                "type": "string",
                "format": "uuid",
                "description": "Reuse this UUID when retrying one refresh request after a lost response.",
            },
        }
    )
    def post(self):
        _check_refresh_origin()
        request_id = request.headers.get("X-Refresh-Request-ID")
        if request_id is not None:
            try:
                request_id = str(UUID(request_id))
            except ValueError as error:
                raise BadRequest("X-Refresh-Request-ID must be a UUID.") from error
        refresh_token = extract_refresh_token(request)
        if not refresh_token:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": "No refresh token provided"},
            ), HTTPStatus.UNAUTHORIZED

        try:
            tokens = application_services().accounts.authentication.refresh(refresh_token, request_id=request_id)
        except account_errors.InvalidRefreshTokenError as error:
            return dump_response(
                SimpleResultMessageResponse,
                {"result": "fail", "message": str(error)},
            ), HTTPStatus.UNAUTHORIZED
        return _token_response(tokens, SimpleResultResponse, {"result": "success"})


def _origin(url: str) -> tuple[str, str, int] | None:
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or any(character.isspace() for character in url)
        ):
            return None
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
        if port == 0:
            return None
        return parsed.scheme, parsed.hostname, port
    except ValueError:
        return None


def _check_refresh_origin() -> None:
    # Refresh and logout must still work after the access and CSRF JWTs expire.
    value = request.headers.get("Origin", "")
    origin = _origin(value)
    if origin is None:
        raise Forbidden("A trusted Origin header is required.")
    parsed = urlsplit(value)
    if parsed.path or parsed.query or parsed.fragment:
        raise Forbidden("A trusted Origin header is required.")
    api_origin = _origin(request.host_url)
    if origin in {api_origin, _origin(dify_config.CONSOLE_WEB_URL)}:
        return
    # Proxies can hide the browser's scheme/port; a signed cookie echo proves same-host access without trusting headers.
    if api_origin is not None and origin[1] == api_origin[1] and _has_refresh_csrf_proof():
        return
    raise Forbidden("A trusted Origin header is required.")


def _has_refresh_csrf_proof() -> bool:
    csrf_token = extract_csrf_token(request)
    csrf_cookie = extract_csrf_token_from_cookie(request)
    if not csrf_token or not csrf_cookie or not hmac.compare_digest(csrf_token.encode(), csrf_cookie.encode()):
        return False
    try:
        claims = jwt.decode(
            csrf_token,
            dify_config.SECRET_KEY,
            algorithms=["HS256"],
            options={"verify_exp": False, "require": ["sub", "exp", "jti"]},
        )
        account_id = claims["sub"]
        if not isinstance(account_id, str) or str(UUID(account_id)) != account_id:
            return False
    except (jwt.PyJWTError, ValueError):
        return False
    if (
        type(claims["exp"]) is not int
        or not isinstance(claims["jti"], str)
        or re.fullmatch(r"[0-9a-f]{32}", claims["jti"]) is None
        or any(claim in claims for claim in ("aud", "token_type", "token_source"))
    ):
        return False
    refresh_token = extract_refresh_token(request)
    return (
        refresh_token is None
        or re.fullmatch(rf"v2\.{re.escape(account_id)}\.[0-9a-f]{{32}}\.[0-9a-f]{{64}}", refresh_token) is not None
    )


def _logout_response():
    # response-contract:ignore cookie-bearing Flask response
    response = make_response(dump_response(SimpleResultResponse, {"result": "success"}))
    clear_access_token_from_cookie(response)
    clear_refresh_token_from_cookie(response)
    clear_csrf_token_from_cookie(response)
    return response


def _token_response(tokens: AccountSessionTokens, response_model: type[BaseModel], data: object):
    # response-contract:ignore cookie-bearing Flask response
    response = make_response(dump_response(response_model, data))
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
