"""Framework-neutral application service for Web authentication use cases."""

from typing import Never, Protocol

from machinery.context import RequestContext
from services.account_ports import AccountPasswordHasher
from services.entities.account_entities import AccountAuthenticationSnapshot, AccountPasswordDigest, AccountSnapshot
from services.entities.auth_audit_entities import LoginFailureReason
from services.entities.authentication_entities import (
    StoredAuthenticationToken,
    WebAppSessionRecord,
    WebLoginStatus,
)

_BANNED_ACCOUNT_STATUS = "banned"


class WebAuthenticationAccountRepository(Protocol):
    def find_for_authentication(self, email: str) -> AccountAuthenticationSnapshot | None: ...

    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None: ...


class WebAuthenticationTokenGateway(Protocol):
    def issue_access_token(self, *, account_id: str, email: str) -> str: ...

    def verify_access_token(self, token: str | None) -> bool: ...

    def send_email_login_code(self, *, account_id: str, email: str, language: str) -> str: ...

    def get_email_login_token(self, token: str) -> StoredAuthenticationToken | None: ...

    def revoke_email_login_token(self, token: str) -> None: ...

    def send_reset_password_code(self, *, account_id: str, email: str, language: str) -> str: ...

    def get_reset_password_token(self, token: str) -> StoredAuthenticationToken | None: ...

    def replace_reset_password_token(self, *, email: str, code: str) -> str: ...

    def revoke_reset_password_token(self, token: str) -> None: ...


class WebAuthenticationSecurityGateway(Protocol):
    def is_email_send_ip_limited(self, ip_address: str) -> bool: ...

    def is_password_reset_verification_limited(self, email: str) -> bool: ...

    def record_password_reset_verification_failure(self, email: str) -> None: ...

    def reset_password_reset_verification_failures(self, email: str) -> None: ...

    def reset_login_failures(self, email: str) -> None: ...


class WebAppAccessGateway(Protocol):
    def find_app_id_by_code(self, app_code: str) -> str | None: ...

    def requires_permission_check(self, app_id: str) -> bool: ...

    def requires_authentication(self, app_id: str) -> bool: ...

    def is_user_allowed(self, *, user_id: str, app_id: str) -> bool: ...


class WebAppSessionGateway(Protocol):
    def verify(self, *, token: str | None, app_code: str, user_id: str | None) -> bool: ...


class WebAppSessionQuery(Protocol):
    def find_active_session(
        self,
        *,
        app_id: str,
        app_code: str,
        end_user_id: str,
    ) -> WebAppSessionRecord | None: ...


class WebAuthenticationAuditGateway(Protocol):
    def login_failed(self, *, email: str, reason: LoginFailureReason, ip_address: str) -> None: ...


class WebAuthenticationError(Exception):
    """Base class for Web authentication use-case failures."""


class WebAuthenticationFailedError(WebAuthenticationError):
    pass


class WebAccountBannedError(WebAuthenticationError):
    pass


class WebInvalidTokenError(WebAuthenticationError):
    pass


class WebInvalidEmailError(WebAuthenticationError):
    pass


class WebInvalidCodeError(WebAuthenticationError):
    pass


class WebPasswordMismatchError(WebAuthenticationError):
    pass


class WebEmailSendIPLimitedError(WebAuthenticationError):
    pass


class WebPasswordResetVerificationLimitedError(WebAuthenticationError):
    pass


class WebEmailDeliveryRateLimitError(WebAuthenticationError):
    def __init__(self, *, flow: str, retry_after_minutes: int) -> None:
        super().__init__(flow, retry_after_minutes)
        self.flow = flow
        self.retry_after_minutes = retry_after_minutes


class WebAuthenticationService:
    def __init__(
        self,
        *,
        accounts: WebAuthenticationAccountRepository,
        passwords: AccountPasswordHasher,
        tokens: WebAuthenticationTokenGateway,
        security: WebAuthenticationSecurityGateway,
        app_access: WebAppAccessGateway,
        app_sessions: WebAppSessionGateway,
        audit: WebAuthenticationAuditGateway,
        private_app_access_enabled: bool,
    ) -> None:
        self._accounts = accounts
        self._passwords = passwords
        self._tokens = tokens
        self._security = security
        self._app_access = app_access
        self._app_sessions = app_sessions
        self._audit = audit
        self._private_app_access_enabled = private_app_access_enabled

    def login_with_password(self, context: RequestContext, *, email: str, password: str) -> str:
        normalized_email = email.lower()
        account = self._accounts.find_for_authentication(email)
        if account is None:
            self._fail_login(context, normalized_email, LoginFailureReason.ACCOUNT_NOT_FOUND)
        self._ensure_active_account(context, account, normalized_email)
        if (
            account.password_hash is None
            or account.password_salt is None
            or not self._passwords.verify(
                password,
                password_hash=account.password_hash,
                password_salt=account.password_salt,
            )
        ):
            self._fail_login(context, normalized_email, LoginFailureReason.INVALID_CREDENTIALS)
        return self._tokens.issue_access_token(account_id=account.id, email=account.email)

    def get_login_status(
        self,
        *,
        app_code: str | None,
        user_id: str | None,
        access_token: str | None,
        app_session_token: str | None,
    ) -> WebLoginStatus:
        if not app_code:
            return WebLoginStatus(logged_in=bool(access_token), app_logged_in=False)

        app_id = self._app_access.find_app_id_by_code(app_code)
        if app_id is None:
            raise ValueError(f"App with code {app_code} not found")
        is_public = not self._private_app_access_enabled or not self._app_access.requires_permission_check(app_id)
        logged_in = is_public or self._tokens.verify_access_token(access_token)
        app_logged_in = self._app_sessions.verify(token=app_session_token, app_code=app_code, user_id=user_id)
        return WebLoginStatus(logged_in=logged_in, app_logged_in=app_logged_in)

    def send_email_login_code(self, *, email: str, language: str | None) -> str:
        account = self._accounts.find_for_authentication(email)
        if account is None:
            raise WebAuthenticationFailedError
        if account.status == _BANNED_ACCOUNT_STATUS:
            raise WebAccountBannedError
        return self._tokens.send_email_login_code(
            account_id=account.id,
            email=account.email,
            language=self._language(language),
        )

    def login_with_email_code(
        self,
        context: RequestContext,
        *,
        email: str,
        code: str,
        token: str,
    ) -> str:
        normalized_email = email.lower()
        token_data = self._tokens.get_email_login_token(token)
        if token_data is None:
            self._fail_login(context, normalized_email, LoginFailureReason.INVALID_EMAIL_CODE_TOKEN)
        if token_data.email is None or token_data.email.lower() != normalized_email:
            self._fail_login(context, normalized_email, LoginFailureReason.EMAIL_CODE_EMAIL_MISMATCH)
        if token_data.code != code:
            self._fail_login(context, normalized_email, LoginFailureReason.INVALID_EMAIL_CODE)

        self._tokens.revoke_email_login_token(token)
        account = self._accounts.find_for_authentication(token_data.email)
        if account is None:
            self._fail_login(context, normalized_email, LoginFailureReason.ACCOUNT_NOT_FOUND)
        self._ensure_active_account(context, account, normalized_email)
        access_token = self._tokens.issue_access_token(account_id=account.id, email=account.email)
        self._security.reset_login_failures(normalized_email)
        return access_token

    def send_reset_password_email(self, context: RequestContext, *, email: str, language: str | None) -> str:
        if self._security.is_email_send_ip_limited(context.remote_ip or ""):
            raise WebEmailSendIPLimitedError
        account = self._accounts.find_for_authentication(email)
        if account is None:
            raise WebAuthenticationFailedError
        return self._tokens.send_reset_password_code(
            account_id=account.id,
            email=account.email,
            language=self._language(language),
        )

    def verify_reset_password_code(self, *, email: str, code: str, token: str) -> str:
        normalized_email = email.lower()
        if self._security.is_password_reset_verification_limited(normalized_email):
            raise WebPasswordResetVerificationLimitedError
        token_data = self._tokens.get_reset_password_token(token)
        if token_data is None:
            raise WebInvalidTokenError
        if token_data.email is None or token_data.email.lower() != normalized_email:
            raise WebInvalidEmailError
        if token_data.code != code:
            self._security.record_password_reset_verification_failure(normalized_email)
            raise WebInvalidCodeError

        self._tokens.revoke_reset_password_token(token)
        new_token = self._tokens.replace_reset_password_token(email=token_data.email, code=code)
        self._security.reset_password_reset_verification_failures(normalized_email)
        return new_token

    def reset_password(self, *, token: str, new_password: str, password_confirmation: str) -> None:
        if new_password != password_confirmation:
            raise WebPasswordMismatchError
        token_data = self._tokens.get_reset_password_token(token)
        if token_data is None or token_data.phase != "reset":
            raise WebInvalidTokenError

        self._tokens.revoke_reset_password_token(token)
        if token_data.email is None:
            raise WebAuthenticationFailedError
        account = self._accounts.find_for_authentication(token_data.email)
        if account is None:
            raise WebAuthenticationFailedError
        password = self._passwords.hash(new_password)
        if self._accounts.update_password(account.id, password) is None:
            raise WebAuthenticationFailedError

    def _ensure_active_account(
        self,
        context: RequestContext,
        account: AccountAuthenticationSnapshot,
        normalized_email: str,
    ) -> None:
        if account.status == _BANNED_ACCOUNT_STATUS:
            self._audit.login_failed(
                email=normalized_email,
                reason=LoginFailureReason.ACCOUNT_BANNED,
                ip_address=context.remote_ip or "",
            )
            raise WebAccountBannedError

    def _fail_login(self, context: RequestContext, email: str, reason: LoginFailureReason) -> Never:
        self._audit.login_failed(email=email, reason=reason, ip_address=context.remote_ip or "")
        if reason == LoginFailureReason.ACCOUNT_BANNED:
            raise WebAccountBannedError
        if reason == LoginFailureReason.INVALID_EMAIL_CODE_TOKEN:
            raise WebInvalidTokenError
        if reason == LoginFailureReason.EMAIL_CODE_EMAIL_MISMATCH:
            raise WebInvalidEmailError
        if reason == LoginFailureReason.INVALID_EMAIL_CODE:
            raise WebInvalidCodeError
        raise WebAuthenticationFailedError

    @staticmethod
    def _language(language: str | None) -> str:
        return "zh-Hans" if language == "zh-Hans" else "en-US"
