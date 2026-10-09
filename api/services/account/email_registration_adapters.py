"""Infrastructure adapters for account email registration."""

import secrets
from typing import override

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter, TokenManager
from services.account.email_registration_service import (
    AccountRegistrationGateway,
    AccountRegistrationPolicyGateway,
    EmailRegistrationCodeGenerator,
    EmailRegistrationNotificationGateway,
    EmailRegistrationSecurityGateway,
    EmailRegistrationSendLimiter,
    EmailRegistrationTokenGateway,
)
from services.account.login_service import ConsoleAuthSecurityGateway
from services.account.service import AccountService
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    AccountNormalizedEmailAlreadyInUseError,
    AccountRegisterError,
    EmailRegistrationSeatsLimitError,
    SeatsLimitExceededError,
)
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.billing_service import BillingService
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountSessionTokens,
)
from tasks.mail_register_task import send_email_register_mail_task, send_email_register_mail_task_when_account_exist


class TokenManagerEmailRegistrationTokenGateway(EmailRegistrationTokenGateway):
    @override
    def get(self, token: str) -> AccountEmailRegistrationToken | None:
        payload = TokenManager.get_token_data(token, "email_register")
        if payload is None:
            return None
        email = payload.get("email")
        code = payload.get("code")
        phase_value = payload.get("phase")
        if not isinstance(email, str) or not isinstance(code, str):
            return None
        if phase_value is None:
            phase = None
        else:
            try:
                phase = AccountEmailRegistrationPhase(phase_value)
            except (TypeError, ValueError):
                return None
        return AccountEmailRegistrationToken(email=email, code=code, phase=phase)

    @override
    def issue(self, token_data: AccountEmailRegistrationToken) -> str:
        additional_data = {"code": token_data.code}
        if token_data.phase is not None:
            additional_data["phase"] = token_data.phase.value
        return TokenManager.generate_token(
            email=token_data.email,
            token_type="email_register",
            additional_data=additional_data,
        )

    @override
    def revoke(self, token: str) -> None:
        TokenManager.revoke_token(token, "email_register")


class SecureEmailRegistrationCodeGenerator(EmailRegistrationCodeGenerator):
    @override
    def generate(self) -> str:
        return "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))


class CeleryEmailRegistrationNotificationGateway(EmailRegistrationNotificationGateway):
    @override
    def send_code(self, *, email: str, code: str, language: str) -> None:
        send_email_register_mail_task.delay(language=language, to=email, code=code)

    @override
    def send_account_exists(self, *, email: str, account_name: str, language: str) -> None:
        send_email_register_mail_task_when_account_exist.delay(
            language=language,
            to=email,
            account_name=account_name,
        )


class RateLimiterEmailRegistrationSendLimiter(EmailRegistrationSendLimiter):
    def __init__(self, *, rate_limiter: RateLimiter) -> None:
        self._rate_limiter = rate_limiter

    @override
    def is_limited(self, email: str) -> bool:
        return self._rate_limiter.is_rate_limited(email)

    @override
    def record(self, email: str) -> None:
        self._rate_limiter.increment_rate_limit(email)

    @property
    @override
    def retry_after_minutes(self) -> int:
        return int(self._rate_limiter.time_window / 60)


class RedisEmailRegistrationSecurityGateway(RedisAccountEmailSecurityGateway, EmailRegistrationSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        login_security: ConsoleAuthSecurityGateway,
        verification_failure_limit: int,
        verification_lockout_duration: int,
    ) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
            verification_failure_limit=verification_failure_limit,
            verification_lockout_duration=verification_lockout_duration,
            verification_key_prefix="email_register_error_rate_limit",
        )
        self._login_security = login_security

    @override
    def reset_login_failures(self, email: str) -> None:
        self._login_security.reset_login_failures(email)


class BillingAccountRegistrationPolicyGateway(AccountRegistrationPolicyGateway):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def get_freeze_type(self, email: str) -> str | None:
        if not self._enabled:
            return None
        return BillingService.get_email_freeze_type(email)


class AccountLifecycleRegistrationGateway(AccountRegistrationGateway):
    def __init__(self, *, accounts: AccountService) -> None:
        self._accounts = accounts

    @override
    def create(
        self, *, email: str, password: str, interface_language: str, timezone: str | None, ip_address: str
    ) -> str:
        try:
            account = self._accounts.create_account_and_tenant(
                email=email,
                name=email,
                password=password,
                interface_language=interface_language,
                timezone=timezone,
                ip_address=ip_address,
                check_normalized_email=True,
            )
        except SeatsLimitExceededError as exc:
            raise EmailRegistrationSeatsLimitError from exc
        except (AccountEmailDomainSuspendedError, AccountNormalizedEmailAlreadyInUseError):
            raise
        except AccountRegisterError as exc:
            raise AccountEmailFrozenError from exc
        return account.id

    @override
    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        return self._accounts.login(account_id, ip_address=ip_address)
