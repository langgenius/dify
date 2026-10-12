"""Infrastructure adapters for the Console authentication application service."""

import base64
import hashlib
import hmac
import logging
import re
import secrets
from datetime import timedelta
from typing import override
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from pydantic import TypeAdapter, ValidationError

from configs import dify_config
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.helper import RateLimiter, TokenManager
from libs.token import generate_csrf_token
from models.account import (
    AccountStatus,
)
from repositories.account.repository import SQLAlchemyAccountRepository
from services import account_errors
from services.account.console_tokens import issue_console_access_token
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
from services.account_activation_service import (
    AccountActivationRepository,
    AccountActivationService,
    InvitationTokenStore,
)
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
_EMAIL_CODE_LOGIN_RATE_LIMIT_ATTEMPTS = 3
_EMAIL_CODE_LOGIN_RATE_LIMIT_SECONDS = 5 * 60
_LOGIN_FAILURE_LIMIT = 5
_RESET_PASSWORD_RATE_LIMIT_ATTEMPTS = 1
_RESET_PASSWORD_RATE_LIMIT_SECONDS = 60


class AccountActivationConsoleAuthInvitationGateway(ConsoleAuthInvitationGateway):
    """Resolve login invitations and restore invited membership through activation."""

    def __init__(
        self,
        *,
        tokens: InvitationTokenStore,
        accounts: AccountActivationRepository,
        activation: AccountActivationService,
    ) -> None:
        self._tokens = tokens
        self._accounts = accounts
        self._activation = activation

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

    @override
    def ensure_membership(self, *, account_id: str, email: str, token: str) -> bool:
        return self._activation.ensure_membership(account_id=account_id, email=email, token=token)


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
    """Independent login families with atomic rotation and bounded retry recovery.

    Each family has one fixed expiry. Only token digests persist for that lifetime;
    an encrypted response lives for ten seconds to recover a lost refresh reply.
    The account hash tag keeps every script within one Redis Cluster slot.
    """

    _TOKEN_PATTERN = re.compile(
        r"v2\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
        r"\.([0-9a-f]{32})\.[0-9a-f]{64}"
    )
    _TOKENS = TypeAdapter(AccountSessionTokens)
    _ISSUE_SCRIPT = """
        local epoch = redis.call('GET', KEYS[2])
        if redis.call('EXISTS', KEYS[1]) == 1 then
            if epoch and redis.call('HGET', KEYS[1], 'current') == ARGV[1]
                and redis.call('HGET', KEYS[1], 'epoch') == epoch
                and redis.call('HGET', KEYS[1], 'revoked') == '0' then return 1 end
            return 0
        end
        if not epoch then
            -- A delayed transport retry after eviction must not recreate an earlier epoch.
            epoch = ARGV[3] .. ':' .. table.concat(redis.call('TIME'), ':')
            redis.call('SET', KEYS[2], epoch)
        end
        redis.call('HSET', KEYS[1], 'current', ARGV[1], 'epoch', epoch, 'revoked', '0')
        redis.call('EXPIRE', KEYS[1], ARGV[2])
        return 1
    """
    _SESSION_SCRIPT = """
        if redis.call('HGET', KEYS[1], 'revoked') ~= '0' then return nil end
        local epoch = redis.call('GET', KEYS[2])
        if not epoch or redis.call('HGET', KEYS[1], 'epoch') ~= epoch then
            return nil
        end
        local current = redis.call('HGET', KEYS[1], 'current')
        local used = redis.call('HEXISTS', KEYS[1], 'used:' .. ARGV[2]) == 1
        if ARGV[1] == 'resolve' then
            if current == ARGV[2] or used then return 1 end
            return nil
        end
        if ARGV[1] == 'revoke' then
            if current == ARGV[2] or used then
                redis.call('HSET', KEYS[1], 'revoked', '1')
                redis.call('DEL', KEYS[3])
            end
            return nil
        end
        -- A Redis transport retry carries the identical generated successor.
        if current == ARGV[3] and used then return ARGV[5] end
        local cached = redis.call('GET', KEYS[3])
        if ARGV[4] ~= '' and cached then
            local reply = cjson.decode(cached)
            if reply.request_id == ARGV[4] and reply.successor == current
                and (reply.predecessor == ARGV[2] or current == ARGV[2]) then
                return reply.tokens
            end
        end
        if current ~= ARGV[2] then
            if used then
                redis.call('HSET', KEYS[1], 'revoked', '1')
                redis.call('DEL', KEYS[3])
            end
            return nil
        end
        local remaining = redis.call('PTTL', KEYS[1])
        if remaining <= 0 then return nil end
        redis.call('HSET', KEYS[1], 'used:' .. ARGV[2], '1', 'current', ARGV[3])
        local reply = cjson.encode({request_id = ARGV[4], predecessor = ARGV[2],
            successor = ARGV[3], tokens = ARGV[5]})
        redis.call('SET', KEYS[3], reply, 'PX', math.min(10000, remaining))
        return ARGV[5]
    """
    _REVOKE_ALL_SCRIPT = """
        -- Never restore an earlier epoch when a delayed command is retried.
        if (redis.call('GET', KEYS[1]) or '') == ARGV[1] then
            redis.call('SET', KEYS[1], ARGV[2] .. ':' .. table.concat(redis.call('TIME'), ':'))
        end
    """

    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._redis = redis
        key = hmac.digest(dify_config.SECRET_KEY.encode(), b"dify:console:refresh-retry:v2", "sha256")
        self._retry_cipher = Fernet(base64.urlsafe_b64encode(key))

    @override
    def issue(self, account_id: str) -> AccountSessionTokens:
        account_id = str(UUID(account_id))
        session_id = secrets.token_hex(16)
        tokens = self._new_tokens(account_id, session_id)
        issued = self._redis.register_script(self._ISSUE_SCRIPT)(
            keys=self._session_keys(account_id, session_id)[:2],
            args=[self._digest(tokens.refresh_token), self._expires_in(), secrets.token_hex(32)],
        )
        if not issued:
            raise account_errors.InvalidRefreshTokenError("Session is no longer active")
        return tokens

    @override
    def revoke(self, refresh_token: str) -> None:
        identity = self._parse(refresh_token)
        if identity is not None:
            self._redis.register_script(self._SESSION_SCRIPT)(
                keys=self._session_keys(*identity), args=["revoke", self._digest(refresh_token)]
            )

    @override
    def revoke_all(self, account_id: str) -> None:
        key = self._epoch_key(str(UUID(account_id)))
        previous = self._redis.get(key) or b""
        self._redis.register_script(self._REVOKE_ALL_SCRIPT)(keys=[key], args=[previous, secrets.token_hex(32)])

    @override
    def resolve_refresh_token(self, refresh_token: str) -> str | None:
        identity = self._parse(refresh_token)
        if identity is None:
            return None
        known = self._redis.register_script(self._SESSION_SCRIPT)(
            keys=self._session_keys(*identity), args=["resolve", self._digest(refresh_token)]
        )
        return identity[0] if known else None

    @override
    def rotate(self, *, refresh_token: str, account_id: str, request_id: str | None = None) -> AccountSessionTokens:
        identity = self._parse(refresh_token)
        if identity is None or identity[0] != account_id:
            raise account_errors.InvalidRefreshTokenError("Invalid refresh token")
        tokens = self._new_tokens(*identity)
        encrypted = self._retry_cipher.encrypt(self._TOKENS.dump_json(tokens)).decode("ascii")
        reply = self._redis.register_script(self._SESSION_SCRIPT)(
            keys=self._session_keys(*identity),
            args=[
                "rotate",
                self._digest(refresh_token),
                self._digest(tokens.refresh_token),
                request_id or "",
                encrypted,
            ],
        )
        if not reply:
            raise account_errors.InvalidRefreshTokenError("Invalid refresh token")
        try:
            return self._TOKENS.validate_json(self._retry_cipher.decrypt(reply))
        except (InvalidToken, ValidationError) as error:
            raise account_errors.InvalidRefreshTokenError("Invalid refresh response") from error

    @staticmethod
    def _new_tokens(account_id: str, session_id: str) -> AccountSessionTokens:
        return AccountSessionTokens(
            access_token=issue_console_access_token(account_id, session_id),
            refresh_token=f"v2.{account_id}.{session_id}.{secrets.token_hex(32)}",
            csrf_token=generate_csrf_token(account_id),
        )

    @staticmethod
    def _digest(refresh_token: str) -> str:
        return hashlib.sha256(refresh_token.encode()).hexdigest()

    @staticmethod
    def _expires_in() -> int:
        return max(1, int(timedelta(days=dify_config.REFRESH_TOKEN_EXPIRE_DAYS).total_seconds()))

    @classmethod
    def _parse(cls, refresh_token: str) -> tuple[str, str] | None:
        match = cls._TOKEN_PATTERN.fullmatch(refresh_token)
        return (match[1], match[2]) if match else None

    @staticmethod
    def _epoch_key(account_id: str) -> str:
        return f"auth:{{{account_id}}}:epoch"

    @classmethod
    def _session_keys(cls, account_id: str, session_id: str) -> list[str]:
        return [
            f"auth:{{{account_id}}}:session:{session_id}",
            cls._epoch_key(account_id),
            f"auth:{{{account_id}}}:reply:{session_id}",
        ]


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
        registration_allowed: bool,
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
        if account_id is not None or registration_allowed:
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
        with self._rate_limiter.reserve(email) as acquired:
            if not acquired:
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
