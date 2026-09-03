"""Infrastructure adapters for the account change-email application service."""

import secrets
from typing import override

from pydantic import TypeAdapter, ValidationError

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter, TokenManager
from services.account_change_email_ports import (
    AccountEmailPolicyGateway,
    ChangeEmailCodeGenerator,
    ChangeEmailNotificationGateway,
    ChangeEmailSecurityGateway,
    ChangeEmailSendLimiter,
    ChangeEmailTokenGateway,
)
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.billing_service import BillingService
from services.entities.account_entities import (
    AccountChangeEmailNewEmailToken,
    AccountChangeEmailNewEmailVerifiedToken,
    AccountChangeEmailOldEmailToken,
    AccountChangeEmailOldEmailVerifiedToken,
    AccountChangeEmailPhase,
    AccountChangeEmailTokenData,
)
from services.entities.auth_entities import (
    ChangeEmailNewEmailToken,
    ChangeEmailNewEmailVerifiedToken,
    ChangeEmailOldEmailToken,
    ChangeEmailOldEmailVerifiedToken,
    ChangeEmailTokenData,
)
from tasks.mail_change_mail_task import send_change_mail_completed_notification_task, send_change_mail_task

_token_adapter: TypeAdapter[ChangeEmailTokenData] = TypeAdapter(ChangeEmailTokenData)


class TokenManagerChangeEmailTokenGateway(ChangeEmailTokenGateway):
    @override
    def get(self, token: str) -> AccountChangeEmailTokenData | None:
        payload = TokenManager.get_token_data(token, "change_email")
        if payload is None:
            return None
        try:
            token_data = _token_adapter.validate_python(payload)
        except ValidationError:
            return None
        token_kwargs = {
            "account_id": token_data.account_id,
            "email": str(token_data.email),
            "old_email": str(token_data.old_email),
            "code": token_data.code,
        }
        if isinstance(token_data, ChangeEmailOldEmailToken):
            return AccountChangeEmailOldEmailToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailOldEmailVerifiedToken):
            return AccountChangeEmailOldEmailVerifiedToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailNewEmailToken):
            return AccountChangeEmailNewEmailToken(**token_kwargs)
        if isinstance(token_data, ChangeEmailNewEmailVerifiedToken):
            return AccountChangeEmailNewEmailVerifiedToken(**token_kwargs)
        return None

    @override
    def issue(self, token_data: AccountChangeEmailTokenData) -> str:
        return TokenManager.generate_token(
            account_id=token_data.account_id,
            email=token_data.email,
            token_type="change_email",
            additional_data={
                "old_email": token_data.old_email,
                "code": token_data.code,
                "email_change_phase": token_data.phase.value,
            },
        )

    @override
    def revoke(self, token: str) -> None:
        TokenManager.revoke_token(token, "change_email")


class SecureChangeEmailCodeGenerator(ChangeEmailCodeGenerator):
    @override
    def generate(self) -> str:
        return "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))


class CeleryChangeEmailNotificationGateway(ChangeEmailNotificationGateway):
    @override
    def send_code(self, *, email: str, code: str, language: str, phase: AccountChangeEmailPhase) -> None:
        send_change_mail_task.delay(language=language, to=email, code=code, phase=phase)

    @override
    def send_completed(self, *, email: str, language: str) -> None:
        send_change_mail_completed_notification_task.delay(language=language, to=email)


class RateLimiterChangeEmailSendLimiter(ChangeEmailSendLimiter):
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


class RedisChangeEmailSecurityGateway(RedisAccountEmailSecurityGateway, ChangeEmailSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int,
        verification_failure_limit: int,
        verification_lockout_duration: int,
    ) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=email_send_ip_limit_per_minute,
            verification_failure_limit=verification_failure_limit,
            verification_lockout_duration=verification_lockout_duration,
            verification_key_prefix="change_email_error_rate_limit",
        )


class BillingAccountEmailPolicyGateway(AccountEmailPolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def is_frozen(self, email: str) -> str | None:
        if not self._billing_enabled or not BillingService.is_email_in_freeze(email):
            return None
        return BillingService.get_email_freeze_type(email) or "freeze"
