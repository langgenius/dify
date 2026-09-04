"""Infrastructure adapters for the account forgot-password application service."""

import secrets
import uuid
from typing import override

from pydantic import TypeAdapter, ValidationError

from extensions.ext_redis import RedisClientWrapper
from extensions.redis_names import serialize_redis_name
from libs.helper import RateLimiter
from services.account_forgot_password_service import (
    FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS,
    FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX,
    FORGOT_PASSWORD_SEND_RATE_LIMIT_WINDOW_SECONDS,
    FORGOT_PASSWORD_VERIFICATION_FAILURE_LIMIT,
    FORGOT_PASSWORD_VERIFICATION_KEY_PREFIX,
    ForgotPasswordCodeGenerator,
    ForgotPasswordNotificationGateway,
    ForgotPasswordRegistrationPolicy,
    ForgotPasswordSecurityGateway,
    ForgotPasswordSendLimiter,
    ForgotPasswordTokenGateway,
)
from services.account_security_gateway import RedisAccountEmailSecurityGateway
from services.entities.account_entities import (
    ForgotPasswordResetToken,
    ForgotPasswordToken,
    ForgotPasswordVerificationToken,
)
from services.entities.auth_entities import (
    ForgotPasswordResetTokenData,
    ForgotPasswordTokenData,
    ForgotPasswordVerificationTokenData,
)
from services.system_feature_service import SystemFeatureService
from tasks.mail_reset_password_task import (
    send_reset_password_mail_task,
    send_reset_password_mail_task_when_account_not_exist,
)

_RESET_PASSWORD_TOKEN_TYPE = "reset_password"
_token_data_adapter: TypeAdapter[ForgotPasswordTokenData] = TypeAdapter(ForgotPasswordTokenData)
_COMPARE_AND_SET_CURRENT_TOKEN_LUA = """
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""


class RedisForgotPasswordTokenGateway(ForgotPasswordTokenGateway):
    def __init__(self, *, redis: RedisClientWrapper, expiry_seconds: int) -> None:
        self._redis = redis
        self._expiry_seconds = expiry_seconds

    @override
    def read_verification(self, token: str) -> ForgotPasswordVerificationToken | None:
        key = f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{token}"
        raw_payload = self._redis.get(key)
        if raw_payload is None:
            return None

        token_data = self._deserialize(raw_payload) if isinstance(raw_payload, str | bytes | bytearray) else None
        if not isinstance(token_data, ForgotPasswordVerificationToken):
            return None
        if token_data.account_id is not None:
            if not self._is_current(token_data.account_id, token):
                return None
        return token_data

    @override
    def claim_reset(self, token: str) -> ForgotPasswordResetToken | None:
        key = f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{token}"
        raw_payload = self._redis.getdel(key)
        if raw_payload is None:
            return None

        token_data = self._deserialize(raw_payload) if isinstance(raw_payload, str | bytes | bytearray) else None
        if not isinstance(token_data, ForgotPasswordResetToken):
            return None
        if token_data.account_id is not None and not self._is_current(token_data.account_id, token):
            return None
        return token_data

    @staticmethod
    def _deserialize(raw_payload: str | bytes | bytearray) -> ForgotPasswordToken | None:
        try:
            payload = _token_data_adapter.validate_json(raw_payload)
        except ValidationError:
            return None
        if isinstance(payload, ForgotPasswordResetTokenData):
            return ForgotPasswordResetToken(
                email=str(payload.email),
                code=payload.code,
                account_id=payload.account_id,
            )
        return ForgotPasswordVerificationToken(
            email=str(payload.email),
            code=payload.code,
            account_id=payload.account_id,
        )

    @override
    def issue(self, token_data: ForgotPasswordToken) -> str:
        token = self._create_token(token_data)
        account_id = token_data.account_id
        if account_id is None:
            return token

        account_key = f"{_RESET_PASSWORD_TOKEN_TYPE}:account:{account_id}"
        previous_token = self._redis.get(account_key)
        self._redis.setex(account_key, self._expiry_seconds, token)
        if isinstance(previous_token, bytes):
            previous_token = previous_token.decode()
        if isinstance(previous_token, str) and previous_token != token:
            self._redis.delete(f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{previous_token}")
        return token

    @override
    def promote(self, claimed_token: str, token_data: ForgotPasswordResetToken) -> str | None:
        account_id = token_data.account_id
        if account_id is None:
            key = f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{claimed_token}"
            raw_payload = self._redis.getdel(key)
            claimed = self._deserialize(raw_payload) if isinstance(raw_payload, str | bytes | bytearray) else None
            if not isinstance(claimed, ForgotPasswordVerificationToken) or claimed.promote() != token_data:
                return None
            return self.issue(token_data)

        reset_token = self._create_token(token_data)
        promoted = self._compare_and_set_current(
            account_id=account_id,
            expected=claimed_token,
            replacement=reset_token,
            expiry_seconds=self._expiry_seconds,
        )
        if promoted:
            self._redis.delete(f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{claimed_token}")
            return reset_token

        self._redis.delete(f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{reset_token}")
        return None

    def _create_token(self, token_data: ForgotPasswordToken) -> str:
        payload: ForgotPasswordTokenData
        if isinstance(token_data, ForgotPasswordResetToken):
            payload = ForgotPasswordResetTokenData(
                account_id=token_data.account_id,
                email=token_data.email,
                code=token_data.code,
                phase="reset",
            )
        else:
            payload = ForgotPasswordVerificationTokenData(
                account_id=token_data.account_id,
                email=token_data.email,
                code=token_data.code,
            )

        token = str(uuid.uuid4())
        self._redis.setex(
            f"{_RESET_PASSWORD_TOKEN_TYPE}:token:{token}",
            self._expiry_seconds,
            payload.model_dump_json(),
        )
        return token

    def _compare_and_set_current(
        self,
        *,
        account_id: str,
        expected: str,
        replacement: str,
        expiry_seconds: int,
    ) -> bool:
        account_key = f"{_RESET_PASSWORD_TOKEN_TYPE}:account:{account_id}"
        return bool(
            self._redis.eval(
                _COMPARE_AND_SET_CURRENT_TOKEN_LUA,
                1,
                serialize_redis_name(account_key),
                expected,
                replacement,
                expiry_seconds,
            )
        )

    def _is_current(self, account_id: str, token: str) -> bool:
        current = self._redis.get(f"{_RESET_PASSWORD_TOKEN_TYPE}:account:{account_id}")
        if isinstance(current, bytes):
            current = current.decode()
        return current == token


class SecureForgotPasswordCodeGenerator(ForgotPasswordCodeGenerator):
    @override
    def generate(self) -> str:
        return "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))


class CeleryForgotPasswordNotificationGateway(ForgotPasswordNotificationGateway):
    @override
    def send(
        self,
        *,
        email: str,
        code: str,
        language: str,
        account_exists: bool,
        registration_allowed: bool,
    ) -> None:
        if account_exists:
            send_reset_password_mail_task.delay(language=language, to=email, code=code)
            return
        send_reset_password_mail_task_when_account_not_exist.delay(
            language=language,
            to=email,
            is_allow_register=registration_allowed,
        )


class RateLimiterForgotPasswordSendLimiter(ForgotPasswordSendLimiter):
    def __init__(self, *, redis: RedisClientWrapper) -> None:
        self._rate_limiter = RateLimiter(
            prefix=FORGOT_PASSWORD_SEND_RATE_LIMIT_PREFIX,
            max_attempts=FORGOT_PASSWORD_SEND_RATE_LIMIT_MAX_ATTEMPTS,
            time_window=FORGOT_PASSWORD_SEND_RATE_LIMIT_WINDOW_SECONDS,
            redis_client=redis,
        )

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


class RedisForgotPasswordSecurityGateway(RedisAccountEmailSecurityGateway, ForgotPasswordSecurityGateway):
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int,
        verification_lockout_duration: int,
    ) -> None:
        super().__init__(
            redis=redis,
            email_send_ip_limit_per_minute=email_send_ip_limit_per_minute,
            verification_failure_limit=FORGOT_PASSWORD_VERIFICATION_FAILURE_LIMIT,
            verification_lockout_duration=verification_lockout_duration,
            verification_key_prefix=FORGOT_PASSWORD_VERIFICATION_KEY_PREFIX,
        )


class SystemFeatureServiceForgotPasswordRegistrationPolicy(ForgotPasswordRegistrationPolicy):
    @override
    def is_registration_allowed(self) -> bool:
        return SystemFeatureService.is_registration_allowed()
