"""Application service for the account email-registration use case."""

from typing import Protocol

from constants.languages import get_valid_language, languages
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    EmailRegistrationPasswordMismatchError,
    EmailRegistrationSendIPLimitedError,
    EmailRegistrationSendRateLimitError,
    EmailRegistrationVerificationLimitError,
    InvalidEmailRegistrationAddressError,
    InvalidEmailRegistrationCodeError,
    InvalidEmailRegistrationTokenError,
)
from services.account_ports import AccountRepository
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountEmailRegistrationVerification,
    AccountSessionTokens,
)


class EmailRegistrationTokenGateway(Protocol):
    def get(self, token: str) -> AccountEmailRegistrationToken | None: ...

    def issue(self, token_data: AccountEmailRegistrationToken) -> str: ...

    def revoke(self, token: str) -> None: ...


class EmailRegistrationCodeGenerator(Protocol):
    def generate(self) -> str: ...


class EmailRegistrationNotificationGateway(Protocol):
    def send_code(self, *, email: str, code: str, language: str) -> None: ...

    def send_account_exists(self, *, email: str, account_name: str, language: str) -> None: ...


class EmailRegistrationSendLimiter(Protocol):
    def is_limited(self, email: str) -> bool: ...

    def record(self, email: str) -> None: ...

    @property
    def retry_after_minutes(self) -> int: ...


class EmailRegistrationSecurityGateway(Protocol):
    def is_ip_limited(self, ip_address: str) -> bool: ...

    def is_verification_limited(self, email: str) -> bool: ...

    def record_verification_failure(self, email: str) -> None: ...

    def reset_verification_failures(self, email: str) -> None: ...

    def reset_login_failures(self, email: str) -> None: ...


class AccountRegistrationPolicyGateway(Protocol):
    def get_freeze_type(self, email: str) -> str | None: ...


class AccountRegistrationGateway(Protocol):
    def create(
        self,
        *,
        email: str,
        password: str,
        interface_language: str,
        timezone: str | None,
        ip_address: str,
    ) -> str: ...

    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens: ...


class AccountEmailRegistrationService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        tokens: EmailRegistrationTokenGateway,
        codes: EmailRegistrationCodeGenerator,
        notifications: EmailRegistrationNotificationGateway,
        send_limits: EmailRegistrationSendLimiter,
        security: EmailRegistrationSecurityGateway,
        account_policy: AccountRegistrationPolicyGateway,
        registration: AccountRegistrationGateway,
    ) -> None:
        self._accounts = accounts
        self._tokens = tokens
        self._codes = codes
        self._notifications = notifications
        self._send_limits = send_limits
        self._security = security
        self._account_policy = account_policy
        self._registration = registration

    def send_code(
        self,
        *,
        remote_ip: str,
        requested_email: str,
        requested_language: str | None,
    ) -> str:
        if self._security.is_ip_limited(remote_ip):
            raise EmailRegistrationSendIPLimitedError

        normalized_email = requested_email.lower()
        self._ensure_email_allowed(normalized_email)
        account = self._accounts.find_by_email(requested_email)
        delivery_email = account.email if account is not None else normalized_email
        if self._send_limits.is_limited(delivery_email):
            raise EmailRegistrationSendRateLimitError(self._send_limits.retry_after_minutes)

        language = requested_language if requested_language is not None and requested_language in languages else "en-US"
        code = self._codes.generate()
        token = self._tokens.issue(AccountEmailRegistrationToken(email=delivery_email, code=code))
        if account is None:
            self._notifications.send_code(email=delivery_email, code=code, language=language)
        else:
            self._notifications.send_account_exists(
                email=delivery_email,
                account_name=account.name,
                language=language,
            )
        self._send_limits.record(delivery_email)
        return token

    def verify_code(
        self,
        *,
        email: str,
        code: str,
        token: str,
    ) -> AccountEmailRegistrationVerification:
        normalized_email = email.lower()
        if self._security.is_verification_limited(normalized_email):
            raise EmailRegistrationVerificationLimitError

        token_data = self._tokens.get(token)
        if token_data is None:
            raise InvalidEmailRegistrationTokenError
        normalized_token_email = token_data.email.lower()
        if normalized_email != normalized_token_email:
            raise InvalidEmailRegistrationAddressError
        if code != token_data.code:
            self._security.record_verification_failure(normalized_email)
            raise InvalidEmailRegistrationCodeError

        self._tokens.revoke(token)
        verified_token = self._tokens.issue(
            AccountEmailRegistrationToken(
                email=normalized_email,
                code=code,
                phase=AccountEmailRegistrationPhase.REGISTER,
            )
        )
        self._security.reset_verification_failures(normalized_email)
        return AccountEmailRegistrationVerification(email=normalized_token_email, token=verified_token)

    def register(
        self,
        *,
        remote_ip: str,
        token: str,
        new_password: str,
        password_confirm: str,
        language: str | None,
        timezone: str | None,
    ) -> AccountSessionTokens:
        if new_password != password_confirm:
            raise EmailRegistrationPasswordMismatchError

        token_data = self._tokens.get(token)
        if token_data is None or token_data.phase != AccountEmailRegistrationPhase.REGISTER:
            raise InvalidEmailRegistrationTokenError
        self._tokens.revoke(token)

        normalized_email = token_data.email.lower()
        if self._accounts.find_by_email(token_data.email) is not None:
            raise AccountEmailAlreadyInUseError

        account_id = self._registration.create(
            email=normalized_email,
            password=password_confirm,
            interface_language=get_valid_language(language),
            timezone=timezone,
            ip_address=remote_ip,
        )
        tokens = self._registration.login(account_id, ip_address=remote_ip)
        self._security.reset_login_failures(normalized_email)
        return tokens

    def _ensure_email_allowed(self, email: str) -> None:
        freeze_type = self._account_policy.get_freeze_type(email)
        if freeze_type == "email_domain_suspended":
            raise AccountEmailDomainSuspendedError
        if freeze_type:
            raise AccountEmailFrozenError
