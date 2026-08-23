"""Infrastructure adapters for account email registration."""

import logging
import secrets
from typing import override

from redis import RedisError
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from libs.helper import RateLimiter, TokenManager
from models.account import Account
from services.account_email_registration_service import (
    AccountRegistrationGateway,
    AccountRegistrationPolicyGateway,
    EmailRegistrationCodeGenerator,
    EmailRegistrationNotificationGateway,
    EmailRegistrationSecurityGateway,
    EmailRegistrationSendLimiter,
    EmailRegistrationTokenGateway,
)
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    EmailRegistrationSeatsLimitError,
)
from services.account_service import AccountService
from services.billing_service import BillingService
from services.entities.account_entities import (
    AccountEmailRegistrationPhase,
    AccountEmailRegistrationToken,
    AccountSessionTokens,
)
from services.errors.account import AccountRegisterError, EmailDomainSuspendedError, SeatsLimitExceededError
from tasks.mail_register_task import send_email_register_mail_task, send_email_register_mail_task_when_account_exist

logger = logging.getLogger(__name__)


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


class RedisEmailRegistrationSecurityGateway(EmailRegistrationSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        verification_failure_limit: int,
        verification_lockout_duration: int,
    ) -> None:
        self._redis = redis
        self._verification_failure_limit = verification_failure_limit
        self._verification_lockout_duration = verification_lockout_duration

    @override
    def is_ip_limited(self, ip_address: str) -> bool:
        return AccountService.is_email_send_ip_limit(ip_address) is True

    @override
    def is_verification_limited(self, email: str) -> bool:
        try:
            count = self._redis.get(self._verification_key(email))
            return count is not None and int(count) > self._verification_failure_limit
        except RedisError:
            logger.warning("Failed to read email-registration verification limit", exc_info=True)
            return False

    @override
    def record_verification_failure(self, email: str) -> None:
        try:
            key = self._verification_key(email)
            count = int(self._redis.get(key) or 0) + 1
            self._redis.setex(key, self._verification_lockout_duration, count)
        except RedisError:
            logger.warning("Failed to record email-registration verification failure", exc_info=True)
            return None

    @override
    def reset_verification_failures(self, email: str) -> None:
        try:
            self._redis.delete(self._verification_key(email))
        except RedisError:
            logger.warning("Failed to reset email-registration verification failures", exc_info=True)
            return None

    @override
    def reset_login_failures(self, email: str) -> None:
        AccountService.reset_login_error_rate_limit(email)

    @staticmethod
    def _verification_key(email: str) -> str:
        return f"email_register_error_rate_limit:{email}"


class BillingAccountRegistrationPolicyGateway(AccountRegistrationPolicyGateway):
    def __init__(self, *, enabled: bool) -> None:
        self._enabled = enabled

    @override
    def get_freeze_type(self, email: str) -> str | None:
        if not self._enabled:
            return None
        return BillingService.get_email_freeze_type(email)


class AccountServiceRegistrationGateway(AccountRegistrationGateway):
    """Compatibility adapter around account provisioning and login internals."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def create(
        self,
        *,
        email: str,
        password: str,
        interface_language: str,
        timezone: str | None,
        ip_address: str,
    ) -> str:
        with self._session_factory() as session:
            try:
                account = AccountService.create_account_and_tenant(
                    email=email,
                    name=email,
                    password=password,
                    interface_language=interface_language,
                    timezone=timezone,
                    ip_address=ip_address,
                    session=session,
                )
            except SeatsLimitExceededError as exc:
                raise EmailRegistrationSeatsLimitError from exc
            except EmailDomainSuspendedError as exc:
                raise AccountEmailDomainSuspendedError from exc
            except AccountRegisterError as exc:
                raise AccountEmailFrozenError from exc
            return account.id

    @override
    def login(self, account_id: str, *, ip_address: str) -> AccountSessionTokens:
        with self._session_factory() as session:
            account = session.get(Account, account_id)
            if account is None:
                raise RuntimeError("newly registered account no longer exists")
            token_pair = AccountService.login(account=account, session=session, ip_address=ip_address)
            return AccountSessionTokens(
                access_token=token_pair.access_token,
                refresh_token=token_pair.refresh_token,
                csrf_token=token_pair.csrf_token,
            )
