from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from hashlib import sha256

from redis.exceptions import RedisError

from configs import dify_config
from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name

_TOKEN_TYPE = "email_code_login"
_CHALLENGE_VERSION = 2


# The per-email v2 challenge is the sole state for tokens created by this
# implementation. Lua result codes must stay in sync with ``_LuaResult``.
_VERIFY_CHALLENGE_LUA = """
local raw = redis.call('GET', KEYS[1])
if not raw then
    return {0, -1}
end

local decoded, data = pcall(cjson.decode, raw)
if not decoded or type(data) ~= 'table' then
    return {5, -1}
end

if data.token_type ~= ARGV[1] or tonumber(data.challenge_version) ~= tonumber(ARGV[5]) then
    return {5, -1}
end

if data.state == 'consumed' or data.state == 'exhausted' then
    return {8, -1}
end

if type(data.token) ~= 'string' or data.token ~= ARGV[2] then
    return {1, -1}
end

if type(data.email) ~= 'string' or data.email ~= ARGV[3] then
    return {2, -1}
end

if type(data.code) ~= 'string' then
    return {5, -1}
end

local remaining = tonumber(data.remaining_attempts)
if not remaining or remaining <= 0 then
    local tombstone = {
        token_type = data.token_type,
        challenge_version = data.challenge_version,
        state = 'exhausted',
        remaining_attempts = 0
    }
    redis.call('SET', KEYS[1], cjson.encode(tombstone), 'KEEPTTL')
    return {6, 0}
end

if data.code == ARGV[4] then
    local tombstone = {
        token_type = data.token_type,
        challenge_version = data.challenge_version,
        state = 'consumed',
        remaining_attempts = 0
    }
    redis.call('SET', KEYS[1], cjson.encode(tombstone), 'KEEPTTL')
    return {4, -1}
end

remaining = remaining - 1
if remaining <= 0 then
    local tombstone = {
        token_type = data.token_type,
        challenge_version = data.challenge_version,
        state = 'exhausted',
        remaining_attempts = 0
    }
    redis.call('SET', KEYS[1], cjson.encode(tombstone), 'KEEPTTL')
    return {6, 0}
end

data.remaining_attempts = remaining
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return {3, remaining}
"""


# Tokens created before this deployment only have the legacy per-token key.
# This fallback gives those in-flight tokens the same atomic attempt budget.
# A versioned token is never accepted here, so a consumed v2 challenge cannot
# fall back even if a stale legacy key is present unexpectedly.
_VERIFY_LEGACY_TOKEN_LUA = """
local raw = redis.call('GET', KEYS[1])
if not raw then
    return {0, -1}
end

local decoded, data = pcall(cjson.decode, raw)
if not decoded or type(data) ~= 'table' then
    return {5, -1}
end

if data.token_type ~= ARGV[1] or type(data.email) ~= 'string' or type(data.code) ~= 'string' then
    return {5, -1}
end

if string.lower(data.email) ~= ARGV[2] then
    return {2, -1}
end

if data.challenge_version ~= nil then
    return {7, -1}
end

local remaining = tonumber(data.remaining_attempts)
if not remaining then
    remaining = tonumber(ARGV[4])
end
if not remaining or remaining <= 0 then
    redis.call('DEL', KEYS[1])
    return {6, 0}
end

if data.code == ARGV[3] then
    redis.call('DEL', KEYS[1])
    return {4, -1}
end

remaining = remaining - 1
if remaining <= 0 then
    redis.call('DEL', KEYS[1])
    return {6, 0}
end

data.remaining_attempts = remaining
redis.call('SET', KEYS[1], cjson.encode(data), 'KEEPTTL')
return {3, remaining}
"""


class EmailCodeLoginChallengeStatus(StrEnum):
    VERIFIED = "verified"
    INVALID_TOKEN = "invalid_token"
    EMAIL_MISMATCH = "email_mismatch"
    INVALID_CODE = "invalid_code"
    EXHAUSTED = "exhausted"


@dataclass(frozen=True)
class EmailCodeLoginChallengeResult:
    status: EmailCodeLoginChallengeStatus
    remaining_attempts: int | None = None


class EmailCodeLoginChallengeUnavailableError(RuntimeError):
    """The Redis-backed email-code challenge could not be safely evaluated."""


class _LuaResult(IntEnum):
    MISSING = 0
    TOKEN_MISMATCH = 1
    EMAIL_MISMATCH = 2
    INVALID_CODE = 3
    VERIFIED = 4
    CORRUPT = 5
    EXHAUSTED = 6
    VERSIONED_LEGACY_TOKEN = 7
    TERMINAL_CHALLENGE = 8


class EmailCodeLoginChallengeStore:
    @classmethod
    def create(cls, *, email: str, code: str, account_id: str | None) -> str:
        normalized_email = email.lower()
        token = str(uuid.uuid4())
        payload = {
            "account_id": account_id,
            "email": normalized_email,
            "token_type": _TOKEN_TYPE,
            "code": code,
            "remaining_attempts": dify_config.EMAIL_CODE_LOGIN_MAX_ATTEMPTS,
            "challenge_version": _CHALLENGE_VERSION,
            "state": "active",
            "token": token,
        }
        expiry_seconds = int(dify_config.EMAIL_CODE_LOGIN_TOKEN_EXPIRY_MINUTES * 60)

        try:
            # Overwriting this one key makes a resend invalidate the previous
            # token for the normalized email without creating extra budgets.
            redis_client.setex(
                cls._challenge_key(normalized_email),
                expiry_seconds,
                json.dumps(payload, separators=(",", ":")),
            )
        except RedisError as exc:
            raise EmailCodeLoginChallengeUnavailableError("Could not create email-code challenge") from exc

        return token

    @classmethod
    def verify(cls, *, email: str, code: str, token: str) -> EmailCodeLoginChallengeResult:
        normalized_email = email.lower()
        max_attempts = dify_config.EMAIL_CODE_LOGIN_MAX_ATTEMPTS

        try:
            challenge_result = cls._eval(
                _VERIFY_CHALLENGE_LUA,
                cls._challenge_key(normalized_email),
                _TOKEN_TYPE,
                token,
                normalized_email,
                code,
                _CHALLENGE_VERSION,
            )
            if challenge_result[0] is not _LuaResult.MISSING:
                return cls._to_public_result(challenge_result)

            # Only a token created before this deployment can reach the
            # legacy fallback because new tokens are never written there.
            legacy_result = cls._eval(
                _VERIFY_LEGACY_TOKEN_LUA,
                cls._legacy_token_key(token),
                _TOKEN_TYPE,
                normalized_email,
                code,
                max_attempts,
            )
            return cls._to_public_result(legacy_result)
        except (RedisError, TypeError, ValueError) as exc:
            raise EmailCodeLoginChallengeUnavailableError("Could not verify email-code challenge") from exc

    @staticmethod
    def _eval(script: str, key: str, *args: str | int) -> tuple[_LuaResult, int | None]:
        # ``eval`` is delegated to the raw Redis client, so unlike the wrapper's
        # normal commands it needs an explicitly serialized physical key.
        response = redis_client.eval(script, 1, serialize_redis_name(key), *args)
        if not isinstance(response, (list, tuple)) or len(response) != 2:
            raise ValueError("Unexpected Redis Lua response")

        lua_result = _LuaResult(int(response[0]))
        remaining = int(response[1])
        return lua_result, remaining if remaining >= 0 else None

    @staticmethod
    def _to_public_result(result: tuple[_LuaResult, int | None]) -> EmailCodeLoginChallengeResult:
        lua_result, remaining = result
        status = {
            _LuaResult.VERIFIED: EmailCodeLoginChallengeStatus.VERIFIED,
            _LuaResult.EMAIL_MISMATCH: EmailCodeLoginChallengeStatus.EMAIL_MISMATCH,
            _LuaResult.INVALID_CODE: EmailCodeLoginChallengeStatus.INVALID_CODE,
            _LuaResult.EXHAUSTED: EmailCodeLoginChallengeStatus.EXHAUSTED,
        }.get(lua_result, EmailCodeLoginChallengeStatus.INVALID_TOKEN)
        return EmailCodeLoginChallengeResult(status=status, remaining_attempts=remaining)

    @staticmethod
    def _challenge_key(normalized_email: str) -> str:
        email_digest = sha256(normalized_email.encode("utf-8")).hexdigest()
        return f"email_code_login:challenge:{{{email_digest}}}"

    @staticmethod
    def _legacy_token_key(token: str) -> str:
        return f"{_TOKEN_TYPE}:token:{token}"
