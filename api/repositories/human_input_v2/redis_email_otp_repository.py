"""Atomic challenge operations; expiry and failed guesses share a single key."""

from typing import Protocol

from extensions.redis_names import serialize_redis_name
from repositories.human_input_v2.email_otp_repository import (
    EmailOtpChallenge,
    EmailOtpSubject,
    ExternalContactSubject,
    VerificationStatus,
)

_CHALLENGE_TTL_SECONDS = 600
_MAX_FAILED_ATTEMPTS = 5

_CREATE = """
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'payload', ARGV[1], 'failed_attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"""

_VERIFY = """
local raw = redis.call('HGET', KEYS[1], 'payload')
if not raw then return 'expired' end
local challenge = cjson.decode(raw)
if challenge.type ~= ARGV[1] or challenge.email ~= ARGV[2] then return 'stale' end
if challenge.type == 'external_contact' and challenge.contact_id ~= ARGV[3] then return 'stale' end
if challenge.otp == ARGV[4] then return 'verified' end
local failures = redis.call('HINCRBY', KEYS[1], 'failed_attempts', 1)
if failures >= tonumber(ARGV[5]) then
    redis.call('DEL', KEYS[1])
    return 'stale'
end
return 'invalid'
"""


class _Redis(Protocol):
    def eval(self, script: str, numkeys: int, *args: str | int) -> object: ...


class RedisEmailOtpRepository:
    def __init__(self, redis: _Redis) -> None:
        self._redis = redis

    @staticmethod
    def _key(delivery_id: str, token: str) -> str:
        # eval bypasses RedisClientWrapper's normal key-prefix handling.
        return serialize_redis_name(f"hitl:otp:challenge:{delivery_id}:{token}")

    def create(self, delivery_id: str, token: str, challenge: EmailOtpChallenge) -> None:
        created = self._redis.eval(
            _CREATE, 1, self._key(delivery_id, token), challenge.model_dump_json(), _CHALLENGE_TTL_SECONDS
        )
        if created != 1:
            raise ValueError("OTP challenge key already exists")

    def verify(self, delivery_id: str, token: str, subject: EmailOtpSubject, otp: str) -> VerificationStatus:
        status = self._redis.eval(
            _VERIFY,
            1,
            self._key(delivery_id, token),
            subject.type,
            subject.email,
            subject.contact_id if isinstance(subject, ExternalContactSubject) else "",
            otp,
            _MAX_FAILED_ATTEMPTS,
        )
        if isinstance(status, bytes):
            status = status.decode("ascii")
        return VerificationStatus(status)

    def remaining_seconds(self, delivery_id: str, token: str) -> int:
        remaining = self._redis.eval("return redis.call('TTL', KEYS[1])", 1, self._key(delivery_id, token))
        if not isinstance(remaining, int):
            raise ValueError("Invalid Redis TTL response")
        return max(0, remaining)

    def delete(self, delivery_id: str, token: str) -> None:
        self._redis.eval("return redis.call('DEL', KEYS[1])", 1, self._key(delivery_id, token))
