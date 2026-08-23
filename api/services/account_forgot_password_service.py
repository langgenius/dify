"""Application service implementing the account forgot-password use case."""

from typing import Protocol

from services.account_errors import (
    AccountNotFoundError,
    ForgotPasswordMismatchError,
    ForgotPasswordSendIPLimitedError,
    ForgotPasswordSendRateLimitError,
    ForgotPasswordVerificationLimitError,
    InvalidForgotPasswordCodeError,
    InvalidForgotPasswordEmailError,
    InvalidForgotPasswordTokenError,
)
from services.account_ports import AccountPasswordHasher, AccountRepository
from services.entities.account_entities import (
    ForgotPasswordResetToken,
    ForgotPasswordToken,
    ForgotPasswordVerification,
    ForgotPasswordVerificationToken,
)

FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX = "reset_password_rate_limit"
FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS = 1
FORGOT_PASSWORD_SEND_RATE_LIMIT_WINDOW_SECONDS = 60
FORGOT_PASSWORD_VERIFICATION_FAILURE_LIMIT = 5
FORGOT_PASSWORD_VERIFICATION_KEY_PREFIX = "forgot_password_error_rate_limit"


class ForgotPasswordTokenGateway(Protocol):
    def read_verification(self, token: str) -> ForgotPasswordVerificationToken | None: ...

    def claim_reset(self, token: str) -> ForgotPasswordResetToken | None: ...

    def issue(self, token_data: ForgotPasswordToken) -> str: ...

    def promote(self, claimed_token: str, token_data: ForgotPasswordResetToken) -> str | None: ...


class ForgotPasswordCodeGenerator(Protocol):
    def generate(self) -> str: ...


class ForgotPasswordNotificationGateway(Protocol):
    def send(
        self,
        *,
        email: str,
        code: str,
        language: str,
        account_exists: bool,
        registration_allowed: bool,
    ) -> None: ...


class ForgotPasswordSendLimiter(Protocol):
    def is_limited(self, email: str) -> bool: ...

    def record(self, email: str) -> None: ...

    @property
    def retry_after_minutes(self) -> int: ...


class ForgotPasswordSecurityGateway(Protocol):
    def is_ip_limited(self, ip_address: str) -> bool: ...

    def is_verification_limited(self, email: str) -> bool: ...

    def record_verification_failure(self, email: str) -> None: ...

    def reset_verification_failures(self, email: str) -> None: ...


class ForgotPasswordRegistrationPolicy(Protocol):
    def is_registration_allowed(self) -> bool: ...


class AccountForgotPasswordService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        passwords: AccountPasswordHasher,
        tokens: ForgotPasswordTokenGateway,
        codes: ForgotPasswordCodeGenerator,
        notifications: ForgotPasswordNotificationGateway,
        send_limits: ForgotPasswordSendLimiter,
        security: ForgotPasswordSecurityGateway,
        registration: ForgotPasswordRegistrationPolicy,
    ) -> None:
        self._accounts = accounts
        self._passwords = passwords
        self._tokens = tokens
        self._codes = codes
        self._notifications = notifications
        self._send_limits = send_limits
        self._security = security
        self._registration = registration

    def send_code(
        self,
        *,
        email: str,
        language: str,
        ip_address: str,
    ) -> str:
        if self._security.is_ip_limited(ip_address):
            raise ForgotPasswordSendIPLimitedError

        normalized_email = email.lower()
        account = self._accounts.get_by_email_with_case_fallback(email)
        destination = account.email if account is not None else normalized_email
        registration_allowed = self._registration.is_registration_allowed()
        if self._send_limits.is_limited(destination):
            raise ForgotPasswordSendRateLimitError(self._send_limits.retry_after_minutes)

        code = self._codes.generate()
        token = self._tokens.issue(
            ForgotPasswordVerificationToken(
                email=destination,
                code=code,
                account_id=account.id if account is not None else None,
            )
        )
        self._notifications.send(
            email=destination,
            code=code,
            language=language,
            account_exists=account is not None,
            registration_allowed=registration_allowed,
        )
        self._send_limits.record(destination)
        return token

    def verify_code(
        self,
        *,
        email: str,
        code: str,
        token: str,
    ) -> ForgotPasswordVerification:
        normalized_email = email.lower()
        if self._security.is_verification_limited(normalized_email):
            raise ForgotPasswordVerificationLimitError

        token_data = self._tokens.read_verification(token)
        if token_data is None:
            raise InvalidForgotPasswordTokenError
        normalized_token_email = token_data.email.lower()
        if normalized_email != normalized_token_email:
            raise InvalidForgotPasswordEmailError
        if code != token_data.code:
            self._security.record_verification_failure(normalized_email)
            raise InvalidForgotPasswordCodeError

        reset_token = self._tokens.promote(token, token_data.promote())
        if reset_token is None:
            raise InvalidForgotPasswordTokenError
        self._security.reset_verification_failures(normalized_email)
        return ForgotPasswordVerification(email=normalized_token_email, token=reset_token)

    def reset(
        self,
        *,
        token: str,
        new_password: str,
        password_confirm: str,
    ) -> None:
        if new_password != password_confirm:
            raise ForgotPasswordMismatchError

        token_data = self._tokens.claim_reset(token)
        if token_data is None:
            raise InvalidForgotPasswordTokenError

        if token_data.account_id is None:
            account = self._accounts.get_by_email_with_case_fallback(token_data.email)
        else:
            account = self._accounts.get(token_data.account_id)
        if account is None or account.email.lower() != token_data.email.lower():
            raise AccountNotFoundError

        password = self._passwords.hash(new_password)
        if self._accounts.update_password(account.id, password) is None:
            raise AccountNotFoundError
