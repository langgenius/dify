"""Typed rate-limit decorator over ``libs.helper.RateLimiter`` (sliding-
window Redis ZSET). Apply after auth decorators so account/email/token-id
scopes can read the openapi auth ContextVar (see
:func:`libs.oauth_bearer.try_get_auth_ctx`). Use :func:`enforce` when the
bucket key is computed in-handler. RFC-8628 ``slow_down`` is inline — its
response shape isn't generic 429.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import request
from werkzeug.exceptions import TooManyRequests, Unauthorized

from configs import dify_config
from libs.helper import RateLimiter, extract_remote_ip


class RateLimitScope(StrEnum):
    IP = "ip"
    CONSOLE_ACCOUNT = "console_account"
    ACCOUNT = "account"
    SUBJECT_EMAIL = "subject_email"
    TOKEN_ID = "token_id"


@dataclass(frozen=True, slots=True, kw_only=True)
class RateLimit:
    name: str
    limit: int
    window: timedelta
    scopes: tuple[RateLimitScope, ...]


LIMIT_DEVICE_CODE_PER_IP = RateLimit(
    name="device_code_per_ip", limit=60, window=timedelta(hours=1), scopes=(RateLimitScope.IP,)
)
LIMIT_SSO_INITIATE_PER_IP = RateLimit(
    name="sso_initiate_per_ip", limit=60, window=timedelta(hours=1), scopes=(RateLimitScope.IP,)
)
LIMIT_APPROVE_EXT_PER_EMAIL = RateLimit(
    name="approve_ext_per_email", limit=10, window=timedelta(hours=1), scopes=(RateLimitScope.SUBJECT_EMAIL,)
)
LIMIT_DEVICE_FLOW_APPROVE = RateLimit(
    name="device_flow_approve",
    limit=dify_config.DEVICE_FLOW_APPROVE_RATE_LIMIT_PER_HOUR,
    window=timedelta(hours=1),
    scopes=(RateLimitScope.CONSOLE_ACCOUNT,),
)
LIMIT_LOOKUP_PUBLIC = RateLimit(
    name="lookup_public", limit=60, window=timedelta(minutes=5), scopes=(RateLimitScope.IP,)
)
LIMIT_ME_PER_ACCOUNT = RateLimit(
    name="me_per_account", limit=60, window=timedelta(minutes=1), scopes=(RateLimitScope.ACCOUNT,)
)
LIMIT_BEARER_PER_TOKEN = RateLimit(
    name="bearer_per_token",
    limit=dify_config.OPENAPI_RATE_LIMIT_PER_TOKEN,
    window=timedelta(minutes=1),
    scopes=(RateLimitScope.TOKEN_ID,),  # bucket key composed by caller from sha256(token)
)


def _ip_key() -> str:
    ip = extract_remote_ip(request)
    if not ip:
        raise Unauthorized("rate_limit_identity_missing")
    return f"ip:{ip}"


def _console_account_key() -> str:
    from libs.login import current_account_with_tenant_optional

    account, _ = current_account_with_tenant_optional()
    if not account:
        raise Unauthorized("rate_limit_identity_missing")
    return f"console_account:{account.id}"


def _account_key() -> str:
    from libs.oauth_bearer import try_get_auth_ctx

    ctx = try_get_auth_ctx()
    if not ctx or not ctx.account_id:
        raise Unauthorized("rate_limit_identity_missing")
    return f"account:{ctx.account_id}"


def _subject_email_key() -> str:
    from libs.oauth_bearer import try_get_auth_ctx

    ctx = try_get_auth_ctx()
    if not ctx or not ctx.subject_email:
        raise Unauthorized("rate_limit_identity_missing")
    return f"subject:{ctx.subject_email}"


def _token_id_key() -> str:
    from libs.oauth_bearer import try_get_auth_ctx

    ctx = try_get_auth_ctx()
    if not ctx or not ctx.token_id:
        raise Unauthorized("rate_limit_identity_missing")
    return f"token:{ctx.token_id}"


_SCOPE_KEYS: Mapping[RateLimitScope, Callable[[], str]] = {
    RateLimitScope.IP: _ip_key,
    RateLimitScope.CONSOLE_ACCOUNT: _console_account_key,
    RateLimitScope.ACCOUNT: _account_key,
    RateLimitScope.SUBJECT_EMAIL: _subject_email_key,
    RateLimitScope.TOKEN_ID: _token_id_key,
}


def _composite_key(scopes: tuple[RateLimitScope, ...]) -> str:
    return "|".join(_SCOPE_KEYS[s]() for s in scopes)


def limiter_prefix(spec: RateLimit) -> str:
    return f"rl:{spec.name}:" + "+".join(s.value for s in spec.scopes)


def _build_limiter(spec: RateLimit) -> RateLimiter:
    return RateLimiter(
        prefix=limiter_prefix(spec),
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


class _BearerRateLimited(TooManyRequests):
    """Per-token 429 with an explicit Retry-After header and no pre-built response,
    so the formatter still renders the canonical ErrorBody ("too_many_requests").
    """

    headers: dict[str, str]

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__()
        self.headers = {"Retry-After": str(retry_after_seconds)}


def enforce_bearer_rate_limit(token_hash: str) -> None:
    """Per-token rate limit on /openapi/v1/* bearer-authed routes.

    Bucket key = ``token:<sha256_hex>`` so the same token shares one
    bucket across api replicas (Redis-backed sliding window).
    """
    # 0 (or less) disables the per-token limit. Short-circuit here: a limiter built with
    # max_attempts=0 would otherwise treat every request as already over the limit.
    if LIMIT_BEARER_PER_TOKEN.limit <= 0:
        return
    limiter = _build_limiter(LIMIT_BEARER_PER_TOKEN)
    key = f"token:{token_hash}"
    if limiter.is_rate_limited(key):
        retry_after = limiter.seconds_until_available(key)
        raise _BearerRateLimited(retry_after)
    limiter.increment_rate_limit(key)
