"""Infrastructure adapters for Web authentication application ports."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, override

from libs.helper import RateLimiter, TokenManager
from libs.passport import PassportService
from services.account_service import AccountService
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.authentication_entities import LoginFailureReason, StoredAuthenticationToken
from services.web_authentication_service import (
    WebAppAccessGateway,
    WebAppSessionGateway,
    WebAppSessionQuery,
    WebAuthenticationAuditGateway,
    WebAuthenticationSecurityGateway,
    WebAuthenticationTokenGateway,
    WebEmailDeliveryRateLimitError,
)
from tasks.mail_email_code_login import send_email_code_login_mail_task
from tasks.mail_reset_password_task import send_reset_password_mail_task


class TokenManagerWebAuthenticationGateway(WebAuthenticationTokenGateway):
    """Web authentication tokens backed by TokenManager and PassportService."""

    def __init__(
        self,
        *,
        reset_password_rate_limiter: RateLimiter,
        access_token_expire_minutes: int,
    ) -> None:
        self._reset_password_rate_limiter = reset_password_rate_limiter
        self._access_token_expire_minutes = access_token_expire_minutes

    @override
    def issue_access_token(self, *, account_id: str, email: str) -> str:
        expires_at = datetime.now(UTC) + timedelta(minutes=self._access_token_expire_minutes)
        return PassportService().issue(
            {
                "sub": "Web API Passport",
                "user_id": account_id,
                "session_id": email,
                "token_source": "webapp_login_token",
                "auth_type": "internal",
                "exp": int(expires_at.timestamp()),
            }
        )

    @override
    def verify_access_token(self, token: str | None) -> bool:
        if not token:
            return False
        try:
            PassportService().verify(token=token)
        except Exception:
            return False
        return True

    @override
    def send_email_login_code(self, *, account_id: str, email: str, language: str) -> str:
        code = self._generate_code()
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="email_code_login",
            additional_data={"code": code},
        )
        send_email_code_login_mail_task.delay(language=language, to=email, code=code)
        return token

    @override
    def get_email_login_token(self, token: str) -> StoredAuthenticationToken | None:
        return self._read_token(token, "email_code_login")

    @override
    def revoke_email_login_token(self, token: str) -> None:
        TokenManager.revoke_token(token, "email_code_login")

    @override
    def send_reset_password_code(self, *, account_id: str, email: str, language: str) -> str:
        limiter = self._reset_password_rate_limiter
        if limiter.is_rate_limited(email):
            raise WebEmailDeliveryRateLimitError(
                flow="reset_password",
                retry_after_minutes=int(limiter.time_window / 60),
            )
        code = self._generate_code()
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="reset_password",
            additional_data={"code": code},
        )
        send_reset_password_mail_task.delay(language=language, to=email, code=code)
        limiter.increment_rate_limit(email)
        return token

    @override
    def get_reset_password_token(self, token: str) -> StoredAuthenticationToken | None:
        return self._read_token(token, "reset_password")

    @override
    def replace_reset_password_token(self, *, email: str, code: str) -> str:
        return TokenManager.generate_token(
            email=email,
            token_type="reset_password",
            additional_data={"code": code, "phase": "reset"},
        )

    @override
    def revoke_reset_password_token(self, token: str) -> None:
        TokenManager.revoke_token(token, "reset_password")

    @staticmethod
    def _generate_code() -> str:
        return "".join(str(secrets.randbelow(10)) for _ in range(6))

    @staticmethod
    def _read_token(token: str, token_type: str) -> StoredAuthenticationToken | None:
        data = TokenManager.get_token_data(token, token_type)
        if data is None:
            return None
        email = data.get("email")
        code = data.get("code")
        phase = data.get("phase")
        return StoredAuthenticationToken(
            email=email if isinstance(email, str) else None,
            code=code if isinstance(code, str) else None,
            phase=phase if isinstance(phase, str) else None,
        )


class AccountServiceWebAuthenticationSecurityGateway(WebAuthenticationSecurityGateway):
    def __init__(self, *, account_service: type[AccountService]) -> None:
        self._account_service = account_service

    @override
    def is_email_send_ip_limited(self, ip_address: str) -> bool:
        return bool(self._account_service.is_email_send_ip_limit(ip_address))

    @override
    def is_password_reset_verification_limited(self, email: str) -> bool:
        return bool(self._account_service.is_forgot_password_error_rate_limit(email))

    @override
    def record_password_reset_verification_failure(self, email: str) -> None:
        self._account_service.add_forgot_password_error_rate_limit(email)

    @override
    def reset_password_reset_verification_failures(self, email: str) -> None:
        self._account_service.reset_forgot_password_error_rate_limit(email)

    @override
    def reset_login_failures(self, email: str) -> None:
        self._account_service.reset_login_error_rate_limit(email)


class PassportWebAppSessionGateway(WebAppSessionGateway):
    def __init__(
        self,
        *,
        sessions: WebAppSessionQuery,
        app_access: WebAppAccessGateway,
    ) -> None:
        self._sessions = sessions
        self._app_access = app_access

    @override
    def verify(self, *, token: str | None, app_code: str, user_id: str | None) -> bool:
        if not token:
            return False
        try:
            decoded = PassportService().verify(token)
            token_app_code = decoded.get("app_code")
            app_id = decoded.get("app_id")
            end_user_id = decoded.get("end_user_id")
            if not isinstance(token_app_code, str) or not isinstance(app_id, str) or not isinstance(end_user_id, str):
                return False

            session = self._sessions.find_active_session(
                app_id=app_id,
                app_code=token_app_code,
                end_user_id=end_user_id,
            )
            if session is None:
                return False
            if user_id is not None and session.end_user_session_id != user_id:
                return False

            return self._verify_webapp_auth_claims(decoded, app_id)
        except Exception:
            return False

    def _verify_webapp_auth_claims(self, decoded: dict[str, Any], app_id: str) -> bool:
        authentication_required = self._app_access.requires_authentication(app_id)
        source = decoded.get("token_source")
        if authentication_required:
            if source != "webapp":
                return False
            user_id = decoded.get("user_id")
            if not isinstance(user_id, str):
                return False
            if self._app_access.requires_permission_check(app_id) and not self._app_access.is_user_allowed(
                user_id=user_id,
                app_id=app_id,
            ):
                return False
            auth_type = decoded.get("auth_type")
            granted_at = decoded.get("granted_at")
            if not isinstance(granted_at, (int, float)):
                return False
            granted_time = datetime.fromtimestamp(granted_at, tz=UTC)
            if auth_type == "external":
                return granted_time >= EnterpriseService.get_app_sso_settings_last_update_time()
            if auth_type == "internal":
                return granted_time >= EnterpriseService.get_workspace_sso_settings_last_update_time()
            return False
        return source != "webapp"


class LoggingWebAuthenticationAuditGateway(WebAuthenticationAuditGateway):
    def __init__(self, *, logger: logging.Logger) -> None:
        self._logger = logger

    @override
    def login_failed(self, *, email: str, reason: LoginFailureReason, ip_address: str) -> None:
        self._logger.warning(
            "Web login failed: email=%s reason=%s ip_address=%s",
            email,
            reason,
            ip_address,
        )
