import logging

import flask_login
from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

import services
from configs import dify_config
from constants.languages import get_valid_language
from controllers.common.fields import (
    SimpleResultDataResponse,
    SimpleResultMessageResponse,
    SimpleResultOptionalDataResponse,
    SimpleResultResponse,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailPasswordLoginLimitError,
    InvalidEmailError,
    InvalidTokenError,
    TurnstileServiceUnavailableError,
    TurnstileVerificationFailedError,
)
from controllers.console.error import (
    AccountBannedError,
    AccountInFreezeError,
    AccountNotFound,
    EmailSendIpLimitError,
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
    with_current_user,
)
from enums import DeploymentEdition
from extensions.ext_database import db
from libs.helper import EmailStr, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.token import (
    clear_access_token_from_cookie,
    clear_csrf_token_from_cookie,
    clear_refresh_token_from_cookie,
    extract_refresh_token,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from models.account import Account
from services.account_service import AccountService, InvitationDetailDict, RegisterService, TenantService
from services.billing_service import BillingService
from services.entities.auth_entities import LoginFailureReason, LoginPayloadBase
from services.errors.account import (
    AccountRegisterError,
    RefreshTokenAccountNotFoundError,
    RefreshTokenNotFoundError,
    SeatsLimitExceededError,
)
from services.errors.workspace import WorkSpaceNotAllowedCreateError, WorkspacesLimitExceededError
from services.feature_service import FeatureService
from services.turnstile_service import (
    TurnstileChallengeRejectedError,
    TurnstileService,
    TurnstileUpstreamError,
)

logger = logging.getLogger(__name__)


class LoginPayload(LoginPayloadBase):
    remember_me: bool = Field(default=False, description="Remember me flag")
    invite_token: str | None = Field(default=None, description="Invitation token")


class EmailPayload(BaseModel):
    email: EmailStr = Field(...)
    language: str | None = Field(default=None)


class EmailCodeSendPayload(EmailPayload):
    turnstile_token: str | None = Field(
        default=None,
        description="Cloudflare Turnstile token. Required at runtime for Dify Cloud.",
    )


class EmailCodeLoginPayload(BaseModel):
    email: EmailStr = Field(...)
    code: str = Field(...)
    token: str = Field(...)
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
        request_email = req_data.email
        normalized_email = request_email.lower()

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and BillingService.is_email_in_freeze(
            normalized_email
        ):
            _log_console_login_failure(email=normalized_email, reason=LoginFailureReason.ACCOUNT_IN_FREEZE)
            raise AccountInFreezeError()

        is_login_error_rate_limit = AccountService.is_login_error_rate_limit(normalized_email)
        if is_login_error_rate_limit:
            _log_console_login_failure(email=normalized_email, reason=LoginFailureReason.LOGIN_RATE_LIMITED)
            raise EmailPasswordLoginLimitError()

        invite_token = req_data.invite_token
        invitation_data: InvitationDetailDict | None = None
        if invite_token:
            invitation_data = RegisterService.get_invitation_with_case_fallback(
                None, request_email, invite_token, session=db.session()
            )
            if invitation_data is None:
                invite_token = None

        try:
            if invitation_data:
                data = invitation_data.get("data", {})
                invitee_email = data.get("email") if data else None
                invitee_email_normalized = invitee_email.lower() if isinstance(invitee_email, str) else invitee_email
                if invitee_email_normalized != normalized_email:
                    _log_console_login_failure(
                        email=normalized_email,
                        reason=LoginFailureReason.INVALID_INVITATION_EMAIL,
                    )
                    raise InvalidEmailError()
            account = _authenticate_account_with_case_fallback(
                request_email, normalized_email, req_data.password, invite_token
            )
        except services.errors.account.AccountLoginError:
            _log_console_login_failure(email=normalized_email, reason=LoginFailureReason.ACCOUNT_BANNED)
            raise AccountBannedError()
        except services.errors.account.AccountPasswordError as exc:
            AccountService.add_login_error_rate_limit(normalized_email)
            _log_console_login_failure(email=normalized_email, reason=LoginFailureReason.INVALID_CREDENTIALS)
            raise AuthenticationFailedError() from exc
        tenants = TenantService.get_join_tenants(account, session=db.session())
        if len(tenants) == 0:
            if (
                FeatureService.is_workspace_creation_allowed()
                and not FeatureService.get_license().workspaces.is_available()
            ):
                raise WorkspacesLimitExceeded()
            else:
                return SimpleResultOptionalDataResponse(
                    result="fail",
                    data="workspace not found, please contact system admin to invite you to join in a workspace",
                ).model_dump(mode="json")

        token_pair = AccountService.login(account=account, session=db.session(), ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(normalized_email)

        # Create response with cookies instead of returning tokens in body
        # response-contract:ignore cookie-bearing Flask response
        response = make_response(
            SimpleResultOptionalDataResponse(result="success").model_dump(mode="json", exclude_none=True)
        )

        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)

        return response


@console_ns.route("/logout")
class LogoutApi(Resource):
    @setup_required
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @with_current_user
    def post(self, account: Account):
        # response-contract:ignore cookie-bearing Flask response
        response = make_response(SimpleResultResponse(result="success").model_dump(mode="json"))
        if not isinstance(account, flask_login.AnonymousUserMixin):
            AccountService.logout(account=account)
            flask_login.logout_user()

        # Clear cookies on logout
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
        normalized_email = req_data.email.lower()

        if req_data.language is not None and req_data.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        try:
            account = _get_account_with_case_fallback(req_data.email)
        except AccountRegisterError:
            raise AccountInFreezeError()

        token = AccountService.send_reset_password_email(
            email=normalized_email,
            account=account,
            language=language,
            is_allow_register=FeatureService.get_system_features().is_allow_register,
        )

        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailCodeSendPayload)
    def post(self, req_data: EmailCodeSendPayload):
        normalized_email = req_data.email.lower()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            try:
                TurnstileService.verify(token=req_data.turnstile_token, remote_ip=ip_address)
            except TurnstileChallengeRejectedError as exc:
                logger.info("Turnstile rejected an email-code login challenge")
                raise TurnstileVerificationFailedError() from exc
            except TurnstileUpstreamError as exc:
                logger.warning("Turnstile verification is unavailable", exc_info=True)
                raise TurnstileServiceUnavailableError() from exc

        if req_data.language is not None and req_data.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"
        try:
            account = _get_account_with_case_fallback(req_data.email)
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            if FeatureService.get_system_features().is_allow_register:
                token = AccountService.send_email_code_login_email(email=normalized_email, language=language)
            else:
                raise AccountNotFound()
        else:
            token = AccountService.send_email_code_login_email(account=account, language=language)

        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@console_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @setup_required
    @console_ns.expect(console_ns.models[EmailCodeLoginPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @decrypt_code_field
    @model_validate(EmailCodeLoginPayload)
    def post(self, req_data: EmailCodeLoginPayload):

        original_email = req_data.email
        user_email = original_email.lower()
        language = req_data.language

        token_data = AccountService.get_email_code_login_data(req_data.token)
        if token_data is None:
            _log_console_login_failure(email=user_email, reason=LoginFailureReason.INVALID_EMAIL_CODE_TOKEN)
            raise InvalidTokenError()

        token_email = token_data.get("email")
        normalized_token_email = token_email.lower() if isinstance(token_email, str) else token_email
        if normalized_token_email != user_email:
            _log_console_login_failure(email=user_email, reason=LoginFailureReason.EMAIL_CODE_EMAIL_MISMATCH)
            raise InvalidEmailError()

        if token_data["code"] != req_data.code:
            _log_console_login_failure(email=user_email, reason=LoginFailureReason.INVALID_EMAIL_CODE)
            raise EmailCodeError()

        AccountService.revoke_email_code_login_token(req_data.token)
        try:
            account = _get_account_with_case_fallback(original_email)
        except Unauthorized as exc:
            _log_console_login_failure(email=user_email, reason=LoginFailureReason.ACCOUNT_BANNED)
            raise AccountBannedError() from exc
        except AccountRegisterError:
            _log_console_login_failure(email=user_email, reason=LoginFailureReason.ACCOUNT_IN_FREEZE)
            raise AccountInFreezeError()
        if account:
            tenants = TenantService.get_join_tenants(account, session=db.session())
            if not tenants:
                workspaces = FeatureService.get_license().workspaces
                if not workspaces.is_available():
                    raise WorkspacesLimitExceeded()
                if not FeatureService.is_workspace_creation_allowed():
                    raise NotAllowedCreateWorkspace()
                else:
                    TenantService.create_owner_tenant(account, session=db.session())

        if account is None:
            try:
                account = AccountService.create_account_and_tenant(
                    email=user_email,
                    name=user_email,
                    interface_language=get_valid_language(language),
                    timezone=req_data.timezone,
                    session=db.session(),
                )
            except WorkSpaceNotAllowedCreateError:
                raise NotAllowedCreateWorkspace()
            except SeatsLimitExceededError:
                raise SeatsLimitExceeded()
            except AccountRegisterError:
                _log_console_login_failure(email=user_email, reason=LoginFailureReason.ACCOUNT_IN_FREEZE)
                raise AccountInFreezeError()
            except WorkspacesLimitExceededError:
                raise WorkspacesLimitExceeded()
        token_pair = AccountService.login(account, session=db.session(), ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(user_email)

        # Create response with cookies instead of returning tokens in body
        # response-contract:ignore cookie-bearing Flask response
        response = make_response(SimpleResultResponse(result="success").model_dump(mode="json"))

        set_csrf_token_to_cookie(request, response, token_pair.csrf_token)
        # Set HTTP-only secure cookies for tokens
        set_access_token_to_cookie(request, response, token_pair.access_token)
        set_refresh_token_to_cookie(request, response, token_pair.refresh_token)
        return response


@console_ns.route("/refresh-token")
class RefreshTokenApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(401, "Unauthorized", console_ns.models[SimpleResultMessageResponse.__name__])
    @with_session(write=False)
    def post(self, session: Session):
        # Get refresh token from cookie instead of request body
        refresh_token = extract_refresh_token(request)

        if not refresh_token:
            return SimpleResultMessageResponse(result="fail", message="No refresh token provided").model_dump(
                mode="json"
            ), 401

        try:
            new_token_pair = AccountService.refresh_token(refresh_token, session=session)
        except Unauthorized as exc:
            return SimpleResultMessageResponse(result="fail", message=exc.description or "Unauthorized.").model_dump(
                mode="json"
            ), 401
        except (RefreshTokenNotFoundError, RefreshTokenAccountNotFoundError) as exc:
            return SimpleResultMessageResponse(result="fail", message=str(exc)).model_dump(mode="json"), 401

        # Create response with new cookies
        # response-contract:ignore cookie-bearing Flask response
        response = make_response(SimpleResultResponse(result="success").model_dump(mode="json"))

        # Update cookies with new tokens
        set_csrf_token_to_cookie(request, response, new_token_pair.csrf_token)
        set_access_token_to_cookie(request, response, new_token_pair.access_token)
        set_refresh_token_to_cookie(request, response, new_token_pair.refresh_token)
        return response


def _get_account_with_case_fallback(email: str):
    account = AccountService.get_user_through_email(email, session=db.session())
    if account or email == email.lower():
        return account

    return AccountService.get_user_through_email(email.lower(), session=db.session())


def _authenticate_account_with_case_fallback(
    original_email: str, normalized_email: str, password: str, invite_token: str | None
):
    try:
        return AccountService.authenticate(original_email, password, invite_token, session=db.session())
    except services.errors.account.AccountPasswordError:
        if original_email == normalized_email:
            raise
        return AccountService.authenticate(normalized_email, password, invite_token, session=db.session())


def _log_console_login_failure(*, email: str, reason: LoginFailureReason) -> None:
    logger.warning(
        "Console login failed: email=%s reason=%s ip_address=%s",
        email,
        reason,
        extract_remote_ip(request),
    )
