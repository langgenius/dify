from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from enum import IntEnum, StrEnum
from hashlib import sha256

from redis.exceptions import RedisError
from redis_lua_py import Key, cjson, redis, script

from configs import dify_config
from extensions.ext_redis import redis_client

_TOKEN_TYPE = "email_code_login"
_CHALLENGE_VERSION = 2


# The per-email v2 challenge is the sole state for tokens created by this
# implementation. Lua result codes must stay in sync with ``_LuaResult``.
@script
def _verify_challenge(
    challenge_key: Key,
    token_type: str,
    token: str,
    email: str,
    code: str,
    challenge_version: int,
) -> list[int]:
    raw = redis.get(challenge_key)
    if raw is None:
        return [0, -1]

    try:
        data = cjson.decode(raw)
    except Exception:
        return [5, -1]
    if not isinstance(data, dict):
        return [5, -1]

    if data["token_type"] != token_type or float(data["challenge_version"]) != challenge_version:
        return [5, -1]

    if data["state"] == "consumed" or data["state"] == "exhausted":
        return [8, -1]

    if not isinstance(data["token"], str) or data["token"] != token:
        return [1, -1]

    if not isinstance(data["email"], str) or data["email"] != email:
        return [2, -1]

    if not isinstance(data["code"], str):
        return [5, -1]

    def write_tombstone(state: str) -> None:
        tombstone = {
            "token_type": data["token_type"],
            "challenge_version": data["challenge_version"],
            "state": state,
            "remaining_attempts": 0,
        }
        redis.set(challenge_key, cjson.encode(tombstone), "KEEPTTL")

    remaining: float | None = float(data["remaining_attempts"])
    if remaining is None or remaining <= 0:
        write_tombstone("exhausted")
        return [6, 0]

    if data["code"] == code:
        write_tombstone("consumed")
        return [4, -1]

    remaining = remaining - 1
    if remaining <= 0:
        write_tombstone("exhausted")
        return [6, 0]

    data["remaining_attempts"] = remaining
    redis.set(challenge_key, cjson.encode(data), "KEEPTTL")
    return [3, int(remaining)]


# Tokens created before this deployment only have the legacy per-token key.
# This fallback gives those in-flight tokens the same atomic attempt budget.
# A versioned token is never accepted here, so a consumed v2 challenge cannot
# fall back even if a stale legacy key is present unexpectedly.
@script
def _verify_legacy_token(
    token_key: Key,
    token_type: str,
    email: str,
    code: str,
    max_attempts: int,
) -> list[int]:
    raw = redis.get(token_key)
    if raw is None:
        return [0, -1]

    try:
        data = cjson.decode(raw)
    except Exception:
        return [5, -1]
    if not isinstance(data, dict):
        return [5, -1]

    if data["token_type"] != token_type or not isinstance(data["email"], str) or not isinstance(data["code"], str):
        return [5, -1]

    if data["email"].lower() != email:
        return [2, -1]

    if "challenge_version" in data:
        return [7, -1]

    remaining: float | None = float(data["remaining_attempts"])
    if remaining is None:
        remaining = max_attempts
    if remaining <= 0:
        redis.delete(token_key)
        return [6, 0]

    if data["code"] == code:
        redis.delete(token_key)
        return [4, -1]

    remaining = remaining - 1
    if remaining <= 0:
        redis.delete(token_key)
        return [6, 0]

    data["remaining_attempts"] = remaining
    redis.set(token_key, cjson.encode(data), "KEEPTTL")
    return [3, int(remaining)]


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
            challenge_result = cls._parse(
                _verify_challenge(
                    redis_client,
                    challenge_key=cls._challenge_key(normalized_email),
                    token_type=_TOKEN_TYPE,
                    token=token,
                    email=normalized_email,
                    code=code,
                    challenge_version=_CHALLENGE_VERSION,
                )
            )
            if challenge_result[0] is not _LuaResult.MISSING:
                return cls._to_public_result(challenge_result)

            # Only a token created before this deployment can reach the
            # legacy fallback because new tokens are never written there.
            legacy_result = cls._parse(
                _verify_legacy_token(
                    redis_client,
                    token_key=cls._legacy_token_key(token),
                    token_type=_TOKEN_TYPE,
                    email=normalized_email,
                    code=code,
                    max_attempts=max_attempts,
                )
            )
            return cls._to_public_result(legacy_result)
        except (RedisError, TypeError, ValueError) as exc:
            raise EmailCodeLoginChallengeUnavailableError("Could not verify email-code challenge") from exc

    @staticmethod
    def _parse(response: object) -> tuple[_LuaResult, int | None]:
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
