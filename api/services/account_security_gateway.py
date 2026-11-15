"""Shared Redis-backed security policies for account email flows."""

import logging

from redis import RedisError

from extensions.ext_redis import RedisClientWrapper

logger = logging.getLogger(__name__)


class RedisAccountEmailSecurityGateway:
    def __init__(
        self,
        *,
        redis: RedisClientWrapper,
        email_send_ip_limit_per_minute: int,
        verification_failure_limit: int,
        verification_lockout_duration: int,
        verification_key_prefix: str,
    ) -> None:
        self._redis = redis
        self._email_send_ip_limit_per_minute = email_send_ip_limit_per_minute
        self._verification_failure_limit = verification_failure_limit
        self._verification_lockout_duration = verification_lockout_duration
        self._verification_key_prefix = verification_key_prefix

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
            logger.warning("Redis unavailable while checking the account email IP limit", exc_info=True)
            return False

    def is_verification_limited(self, email: str) -> bool:
        try:
            count = self._redis.get(self._verification_key(email))
            return count is not None and int(count) > self._verification_failure_limit
        except RedisError:
            logger.warning("Redis unavailable while checking the account email verification limit", exc_info=True)
            return False

    def record_verification_failure(self, email: str) -> None:
        try:
            key = self._verification_key(email)
            count = int(self._redis.get(key) or 0) + 1
            self._redis.setex(key, self._verification_lockout_duration, count)
        except RedisError:
            logger.warning("Redis unavailable while recording an account email verification failure", exc_info=True)
            return None

    def reset_verification_failures(self, email: str) -> None:
        try:
            self._redis.delete(self._verification_key(email))
        except RedisError:
            logger.warning("Redis unavailable while resetting account email verification failures", exc_info=True)
            return None

    def _verification_key(self, email: str) -> str:
        return f"{self._verification_key_prefix}:{email}"
