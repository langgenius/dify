"""Infrastructure adapters for the account change-email application service."""

import secrets
from typing import override

from pydantic import TypeAdapter, ValidationError
from redis import RedisError

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


class RedisChangeEmailSecurityGateway(ChangeEmailSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int,
        verification_failure_limit: int,
        verification_lockout_duration: int,
    ) -> None:
        self._redis = redis
        self._email_send_ip_limit_per_minute = email_send_ip_limit_per_minute
        self._verification_failure_limit = verification_failure_limit
        self._verification_lockout_duration = verification_lockout_duration

    @override
    def is_ip_limited(self, ip_address: str) -> bool:
        minute_key = f"email_send_ip_limit_minute:{ip_address}"
        freeze_key = f"email_send_ip_limit_freeze:{ip_address}"
        hour_limit_key = f"email_send_ip_limit_hour:{ip_address}"
        try:
            if self._redis.get(freeze_key):
                return True

            current_minute_count = int(self._redis.get(minute_key) or 0)
            if current_minute_count > self._email_send_ip_limit_per_minute:
                hour_limit_count = int(self._redis.get(hour_limit_key) or 0)
                if hour_limit_count >= 1:
                    self._redis.setex(freeze_key, 60 * 60, 1)
                    return True
                if not self._redis.set(hour_limit_key, 1, ex=60 * 10, nx=True):
                    self._redis.setex(freeze_key, 60 * 60, 1)
                return True

            self._redis.setex(minute_key, 60, current_minute_count + 1)
            self._redis.expire(minute_key, 60)
            return False
        except RedisError:
            return False

    @override
    def is_verification_limited(self, email: str) -> bool:
        try:
            count = self._redis.get(self._verification_key(email))
            return count is not None and int(count) > self._verification_failure_limit
        except RedisError:
            return False

    @override
    def record_verification_failure(self, email: str) -> None:
        try:
            key = self._verification_key(email)
            count = int(self._redis.get(key) or 0) + 1
            self._redis.setex(key, self._verification_lockout_duration, count)
        except RedisError:
            return None

    @override
    def reset_verification_failures(self, email: str) -> None:
        try:
            self._redis.delete(self._verification_key(email))
        except RedisError:
            return None

    @staticmethod
    def _verification_key(email: str) -> str:
        return f"change_email_error_rate_limit:{email}"


class BillingAccountEmailPolicyGateway(AccountEmailPolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def is_frozen(self, email: str) -> str | None:
        if not self._billing_enabled or not BillingService.is_email_in_freeze(email):
            return None
        return BillingService.get_email_freeze_type(email) or "freeze"
