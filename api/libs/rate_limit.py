"""Typed rate-limit decorator over ``libs.helper.RateLimiter`` (sliding-
window Redis ZSET). Apply after auth decorators so scopes can read
``g.auth_ctx``. Use :func:`enforce` when the bucket key is computed
in-handler. RFC-8628 ``slow_down`` is inline — its response shape isn't
generic 429. Spec: docs/specs/v1.0/server/security.md.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from functools import wraps
from typing import Callable

from flask import g, request, session
from werkzeug.exceptions import TooManyRequests

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


def _one_key(scope: RateLimitScope) -> str:
    match scope:
        case RateLimitScope.IP:
            return f"ip:{extract_remote_ip(request) or 'unknown'}"
        case RateLimitScope.SESSION:
            return f"session:{session.get('_id', 'anon')}"
        case RateLimitScope.ACCOUNT:
            ctx = getattr(g, "auth_ctx", None)
            if ctx and ctx.account_id:
                return f"account:{ctx.account_id}"
            return "account:anon"
        case RateLimitScope.SUBJECT_EMAIL:
            ctx = getattr(g, "auth_ctx", None)
            if ctx and ctx.subject_email:
                return f"subject:{ctx.subject_email}"
            return "subject:anon"
        case RateLimitScope.TOKEN_ID:
            ctx = getattr(g, "auth_ctx", None)
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


def rate_limit(spec: RateLimit) -> Callable:
    """Apply after auth decorators that the scopes read from."""
    limiter = _build_limiter(spec)

    def wrap(fn: Callable) -> Callable:
        @wraps(fn)
        def inner(*args, **kwargs):
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
