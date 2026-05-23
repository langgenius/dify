"""Typed rate-limit decorator over ``libs.helper.RateLimiter`` (sliding-
window Redis ZSET). Apply after auth decorators so account/email/token-id
scopes can read the openapi auth ContextVar (see
:func:`libs.oauth_bearer.try_get_auth_ctx`). Use :func:`enforce` when the
bucket key is computed in-handler. RFC-8628 ``slow_down`` is inline — its
response shape isn't generic 429.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import jsonify, make_response, request, session
from werkzeug.exceptions import TooManyRequests

from configs import dify_config
from libs.helper import RateLimiter, extract_remote_ip


class RateLimitScope(StrEnum):
    IP = "ip"
    SESSION = "session"
    ACCOUNT = "account"
    SUBJECT_EMAIL = "subject_email"
    TOKEN_ID = "token_id"


@dataclass(frozen=True, slots=True)
class RateLimit:
    limit: int
    window: timedelta
    scopes: tuple[RateLimitScope, ...]


LIMIT_DEVICE_CODE_PER_IP = RateLimit(60, timedelta(hours=1), (RateLimitScope.IP,))
LIMIT_SSO_INITIATE_PER_IP = RateLimit(60, timedelta(hours=1), (RateLimitScope.IP,))
LIMIT_APPROVE_EXT_PER_EMAIL = RateLimit(10, timedelta(hours=1), (RateLimitScope.SUBJECT_EMAIL,))
LIMIT_APPROVE_CONSOLE = RateLimit(10, timedelta(hours=1), (RateLimitScope.SESSION,))
LIMIT_LOOKUP_PUBLIC = RateLimit(60, timedelta(minutes=5), (RateLimitScope.IP,))
LIMIT_ME_PER_ACCOUNT = RateLimit(60, timedelta(minutes=1), (RateLimitScope.ACCOUNT,))
LIMIT_ME_PER_EMAIL = RateLimit(60, timedelta(minutes=1), (RateLimitScope.SUBJECT_EMAIL,))
LIMIT_BEARER_PER_TOKEN = RateLimit(
    limit=dify_config.OPENAPI_RATE_LIMIT_PER_TOKEN,
    window=timedelta(minutes=1),
    scopes=(RateLimitScope.TOKEN_ID,),  # bucket key composed by caller from sha256(token)
)


def _one_key(scope: RateLimitScope) -> str:
    match scope:
        case RateLimitScope.IP:
            return f"ip:{extract_remote_ip(request) or 'unknown'}"
        case RateLimitScope.SESSION:
            return f"session:{session.get('_id', 'anon')}"
        case RateLimitScope.ACCOUNT:
            from libs.oauth_bearer import try_get_auth_ctx

            ctx = try_get_auth_ctx()
            if ctx and ctx.account_id:
                return f"account:{ctx.account_id}"
            return "account:anon"
        case RateLimitScope.SUBJECT_EMAIL:
            from libs.oauth_bearer import try_get_auth_ctx

            ctx = try_get_auth_ctx()
            if ctx and ctx.subject_email:
                return f"subject:{ctx.subject_email}"
            return "subject:anon"
        case RateLimitScope.TOKEN_ID:
            from libs.oauth_bearer import try_get_auth_ctx

            ctx = try_get_auth_ctx()
            if ctx and ctx.token_id:
                return f"token:{ctx.token_id}"
            return "token:anon"


def _composite_key(scopes: tuple[RateLimitScope, ...]) -> str:
    return "|".join(_one_key(s) for s in scopes)


def _limiter_prefix(scopes: tuple[RateLimitScope, ...]) -> str:
    return "rl:" + "+".join(s.value for s in scopes)


def _build_limiter(spec: RateLimit) -> RateLimiter:
    return RateLimiter(
        prefix=_limiter_prefix(spec.scopes),
        max_attempts=spec.limit,
        time_window=int(spec.window.total_seconds()),
    )


_P = ParamSpec("_P")
_R = TypeVar("_R")


def rate_limit(spec: RateLimit) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Apply after auth decorators that the scopes read from."""
    limiter = _build_limiter(spec)

    def wrap(fn: Callable[_P, _R]) -> Callable[_P, _R]:
        @wraps(fn)
        def inner(*args: _P.args, **kwargs: _P.kwargs) -> _R:
            key = _composite_key(spec.scopes)
            if limiter.is_rate_limited(key):
                raise TooManyRequests("rate_limited")
            limiter.increment_rate_limit(key)
            return fn(*args, **kwargs)

        return inner

    return wrap


def enforce(spec: RateLimit, *, key: str) -> None:
    """Imperative form — caller composes the bucket key to match scope
    semantics (the key is opaque here).
    """
    limiter = _build_limiter(spec)
    if limiter.is_rate_limited(key):
        raise TooManyRequests("rate_limited")
    limiter.increment_rate_limit(key)


def enforce_bearer_rate_limit(token_hash: str) -> None:
    """Per-token rate limit on /openapi/v1/* bearer-authed routes.

    Bucket key = ``token:<sha256_hex>`` so the same token shares one
    bucket across api replicas (Redis-backed sliding window).
    """
    limiter = _build_limiter(LIMIT_BEARER_PER_TOKEN)
    key = f"token:{token_hash}"
    if limiter.is_rate_limited(key):
        retry_after = limiter.seconds_until_available(key)
        response = make_response(
            jsonify({"error": "rate_limited", "retry_after_ms": retry_after * 1000}),
            429,
        )
        response.headers["Retry-After"] = str(retry_after)
        raise TooManyRequests(response=response)
    limiter.increment_rate_limit(key)
