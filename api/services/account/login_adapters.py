"""Infrastructure adapters for the Console authentication application service."""

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import override

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.account import (
    AccountStatus,
)
from repositories.account.repository import SQLAlchemyAccountRepository
from services import account_errors
from services.account.login_service import (
    AccountRefreshPreparationGateway,
    AccountSessionGateway,
    ConsoleAuthAuditGateway,
    ConsoleAuthInvitationGateway,
    ConsoleAuthPolicyGateway,
    ConsoleAuthSecurityGateway,
    EmailCodeGateway,
    HumanVerificationGateway,
    ResetPasswordEmailGateway,
)
from services.account_activation_service import AccountActivationRepository, InvitationTokenStore
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.billing_service import BillingService
from services.email_code_login_challenge import EmailCodeLoginChallengeStore, EmailCodeLoginChallengeUnavailableError
from services.entities.account_activation_entities import InvitationLookup
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_login_entities import EmailCodeChallengeStatus, LoginInvitation, RefreshAccountStatus
from services.entities.auth_audit_entities import LoginFailureReason
from services.system_feature_service import SystemFeatureService
from services.turnstile_service import (
    EMAIL_CODE_SEND_ACTION,
    EMAIL_CODE_VERIFY_ACTION,
    TurnstileChallengeRejectedError,
    TurnstileService,
    TurnstileUpstreamError,
)
from tasks.mail_email_code_login import send_email_code_login_mail_task
from tasks.mail_reset_password_task import (
    send_reset_password_mail_task,
    send_reset_password_mail_task_when_account_not_exist,
)

logger = logging.getLogger(__name__)

_ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL = timedelta(minutes=10)
_ACCOUNT_REFRESH_TOKEN_PREFIX = "account_refresh_token:"
_EMAIL_CODE_LOGIN_RATE_LIMIT_ATTEMPTS = 3
_EMAIL_CODE_LOGIN_RATE_LIMIT_SECONDS = 5 * 60
_LOGIN_FAILURE_LIMIT = 5
_REFRESH_TOKEN_PREFIX = "refresh_token:"
_RESET_PASSWORD_RATE_LIMIT_ATTEMPTS = 1
_RESET_PASSWORD_RATE_LIMIT_SECONDS = 60


class AccountActivationConsoleAuthInvitationGateway(ConsoleAuthInvitationGateway):
    """Resolve login invitations through the shared activation contracts."""

    def __init__(self, *, tokens: InvitationTokenStore, accounts: AccountActivationRepository) -> None:
        self._tokens = tokens
        self._accounts = accounts

    @override
    def resolve(self, *, email: str, token: str) -> LoginInvitation | None:
        candidate_emails = (email,) if email == email.lower() else (email, email.lower())
        for candidate_email in candidate_emails:
            invitation_token = self._tokens.find(
                InvitationLookup(workspace_id=None, email=candidate_email, token=token)
            )
            if invitation_token is None:
                continue
            invitation = self._accounts.resolve(invitation_token)
            if invitation is not None:
                return LoginInvitation(email=invitation.account_email)
        return None


class DeploymentConsoleAuthPolicyGateway(ConsoleAuthPolicyGateway):
    def __init__(self, *, billing_enabled: bool) -> None:
        self._billing_enabled = billing_enabled

    @override
    def get_email_freeze_type(self, email: str) -> str | None:
        if not self._billing_enabled:
            return None
        return BillingService.get_email_freeze_type(email)

    @override
    def is_registration_allowed(self) -> bool:
        return SystemFeatureService.is_registration_allowed()

    @override
    def is_workspace_creation_allowed(self) -> bool:
        return SystemFeatureService.is_workspace_creation_allowed()

    @override
    def has_workspace_capacity(self) -> bool:
        return SystemFeatureService.get_license().workspaces.is_available()

    @override
    def has_account_capacity(self) -> bool:
        return SystemFeatureService.get_license().seats.is_available()


class RedisConsoleAuthSecurityGateway(RedisAccountEmailSecurityGateway, ConsoleAuthSecurityGateway):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=dify_config.EMAIL_SEND_IP_LIMIT_PER_MINUTE,
            verification_failure_limit=_LOGIN_FAILURE_LIMIT,
            verification_lockout_duration=dify_config.LOGIN_LOCKOUT_DURATION,
            verification_key_prefix="login_error_rate_limit",
        )

    @override
    def is_login_limited(self, email: str) -> bool:
        return self.is_verification_limited(email)

    @override
    def record_login_failure(self, email: str) -> None:
        self.record_verification_failure(email)

    @override
    def reset_login_failures(self, email: str) -> None:
        self.reset_verification_failures(email)

    @override
    def is_email_send_ip_limited(self, ip_address: str) -> bool:
        return self.is_ip_limited(ip_address)


class TurnstileHumanVerificationGateway(HumanVerificationGateway):
    @override
    def verify(self, *, token: str | None, remote_ip: str, action: str) -> None:
        is_email_code_verification = action == "signin_code_verify"
        expected_action = EMAIL_CODE_VERIFY_ACTION if is_email_code_verification else EMAIL_CODE_SEND_ACTION
        try:
            TurnstileService.verify(token=token, remote_ip=remote_ip, expected_action=expected_action)
        except TurnstileChallengeRejectedError as error:
            if is_email_code_verification:
                logger.info("Turnstile rejected an email-code verification challenge")
            else:
                logger.info("Turnstile rejected an email-code login challenge")
            raise account_errors.HumanVerificationRejectedError from error
        except TurnstileUpstreamError as error:
            logger.warning("Turnstile verification is unavailable", exc_info=True)
            raise account_errors.HumanVerificationUnavailableError from error


class RedisAccountSessionGateway(AccountSessionGateway):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    def issue(self, account_id: str) -> AccountSessionTokens:
        return self._issue(account_id)

    @override
    def revoke(self, account_id: str) -> None:
        refresh_token = self._redis.get(self._account_refresh_token_key(account_id))
        if refresh_token:
            self._delete_refresh_token(refresh_token.decode("utf-8"), account_id)

    @override
    def resolve_refresh_token(self, refresh_token: str) -> str | None:
        account_id = self._redis.get(self._refresh_token_key(refresh_token))
        return account_id.decode("utf-8") if account_id else None

    @override
    def rotate(self, *, refresh_token: str, account_id: str) -> AccountSessionTokens:
        self._delete_refresh_token(refresh_token, account_id)
        return self._issue(account_id)

    def _issue(self, account_id: str) -> AccountSessionTokens:
        expires_at = datetime.now(UTC) + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = PassportService().issue(
            {
                "user_id": account_id,
                "exp": int(expires_at.timestamp()),
                "iss": dify_config.DEPLOYMENT_EDITION.value,
                "sub": "Console API Passport",
            }
        )
        refresh_token = secrets.token_hex(64)
        self._store_refresh_token(refresh_token, account_id)
        return AccountSessionTokens(
            access_token=access_token,
            refresh_token=refresh_token,
            csrf_token=generate_csrf_token(account_id),
        )

    def _store_refresh_token(self, refresh_token: str, account_id: str) -> None:
        expires_in = timedelta(days=dify_config.REFRESH_TOKEN_EXPIRE_DAYS)
        self._redis.setex(self._refresh_token_key(refresh_token), expires_in, account_id)
        self._redis.setex(self._account_refresh_token_key(account_id), expires_in, refresh_token)

    def _delete_refresh_token(self, refresh_token: str, account_id: str) -> None:
        self._redis.delete(self._refresh_token_key(refresh_token))
        self._redis.delete(self._account_refresh_token_key(account_id))

    @staticmethod
    def _refresh_token_key(refresh_token: str) -> str:
        return f"{_REFRESH_TOKEN_PREFIX}{refresh_token}"

    @staticmethod
    def _account_refresh_token_key(account_id: str) -> str:
        return f"{_ACCOUNT_REFRESH_TOKEN_PREFIX}{account_id}"


class SQLAlchemyAccountRefreshPreparationGateway(AccountRefreshPreparationGateway):
    def __init__(self, *, accounts: SQLAlchemyAccountRepository) -> None:
        self._accounts = accounts

    @override
    def prepare(self, account_id: str) -> RefreshAccountStatus:
        now = naive_utc_now()
        account = self._accounts.load_identity(account_id, now=now)
        if account is None:
            return RefreshAccountStatus.NOT_FOUND
        if account.status == AccountStatus.BANNED:
            return RefreshAccountStatus.BANNED
        self._accounts.touch_activity(
            account_id,
            now=now,
            before=now - _ACCOUNT_LAST_ACTIVE_REFRESH_INTERVAL,
            touch_updated_at=False,
        )
        return RefreshAccountStatus.READY


class RedisEmailCodeGateway(EmailCodeGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper | None = None,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        if rate_limiter is None:
            if redis is None:
                raise ValueError("redis is required when rate_limiter is not provided")
            rate_limiter = RateLimiter(
                prefix="email_code_login_rate_limit",
                max_attempts=_EMAIL_CODE_LOGIN_RATE_LIMIT_ATTEMPTS,
                time_window=_EMAIL_CODE_LOGIN_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def send(
        self,
        *,
        account_id: str | None,
        normalized_email: str,
        recipient_email: str,
        language: str,
    ) -> str:
        normalized_email = normalized_email.lower()
        if self._rate_limiter.is_rate_limited(normalized_email):
            retry_after = int(self._rate_limiter.time_window / 60)
            raise account_errors.EmailCodeSendRateLimitError(retry_after)

        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        try:
            token = EmailCodeLoginChallengeStore.create(account_id=account_id, email=normalized_email, code=code)
        except EmailCodeLoginChallengeUnavailableError as error:
            logger.warning("Email-code challenge creation is unavailable", exc_info=True)
            raise account_errors.EmailCodeLoginUnavailableError from error
        send_email_code_login_mail_task.delay(language=language, to=recipient_email, code=code)
        self._rate_limiter.increment_rate_limit(normalized_email)
        return token

    @override
    def verify(self, *, normalized_email: str, code: str, token: str) -> EmailCodeChallengeStatus:
        try:
            result = EmailCodeLoginChallengeStore.verify(email=normalized_email.lower(), code=code, token=token)
        except EmailCodeLoginChallengeUnavailableError as error:
            logger.warning("Email-code challenge verification is unavailable", exc_info=True)
            raise account_errors.EmailCodeLoginUnavailableError from error
        return EmailCodeChallengeStatus(result.status.value)


class RedisResetPasswordEmailGateway(ResetPasswordEmailGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper | None = None,
        rate_limiter: RateLimiter | None = None,
    ) -> None:
        if rate_limiter is None:
            if redis is None:
                raise ValueError("redis is required when rate_limiter is not provided")
            rate_limiter = RateLimiter(
                prefix="reset_password_rate_limit",
                max_attempts=_RESET_PASSWORD_RATE_LIMIT_ATTEMPTS,
                time_window=_RESET_PASSWORD_RATE_LIMIT_SECONDS,
                redis_client=redis,
            )
        self._rate_limiter = rate_limiter

    @override
    def send(
        self,
        *,
        account_id: str | None,
        email: str,
        language: str,
        registration_allowed: bool,
    ) -> str:
        if self._rate_limiter.is_rate_limited(email):
            raise account_errors.ResetPasswordEmailRateLimitError(int(self._rate_limiter.time_window / 60))

        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="reset_password",
            additional_data={"code": code},
        )
        if account_id is not None:
            send_reset_password_mail_task.delay(language=language, to=email, code=code)
        else:
            send_reset_password_mail_task_when_account_not_exist.delay(
                language=language,
                to=email,
                is_allow_register=registration_allowed,
            )
        self._rate_limiter.increment_rate_limit(email)
        return token


class LoggingConsoleAuthAuditGateway(ConsoleAuthAuditGateway):
    @override
    def login_failed(
        self,
        *,
        email: str,
        reason: LoginFailureReason,
        ip_address: str,
    ) -> None:
        logger.warning(
            "Console login failed: email=%s reason=%s ip_address=%s",
            email,
            reason,
            ip_address,
        )
