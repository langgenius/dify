"""OAuth bearer primitives.

To add a token kind: write a Resolver, add a SubjectType + Accepts member,
append a TokenKind to build_registry, and update _SUBJECT_TO_ACCEPT.
Authenticator + validate_bearer stay untouched.
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Callable, Iterable
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from functools import wraps
from typing import Literal, ParamSpec, Protocol, TypeVar

from flask import request
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, ServiceUnavailable, Unauthorized

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.rate_limit import enforce_bearer_rate_limit
from models import Account, OAuthAccessToken, TenantAccountJoin

logger = logging.getLogger(__name__)


# ============================================================================
# Contract — types, enums, protocols
# ============================================================================


class SubjectType(StrEnum):
    ACCOUNT = "account"
    EXTERNAL_SSO = "external_sso"


class TokenType(StrEnum):
    OAUTH_ACCOUNT = "oauth_account"
    OAUTH_EXTERNAL_SSO = "oauth_external_sso"


class Scope(StrEnum):
    """Catalog of bearer scopes recognised by the openapi surface.

    `FULL` is the catch-all carried by `dfoa_` account tokens — it satisfies
    any per-route `require_scope`. `dfoe_` tokens carry the per-feature scopes
    (`APPS_RUN`, `APPS_READ_PERMITTED_EXTERNAL`).
    """

    FULL = "full"
    APPS_READ = "apps:read"
    APPS_READ_PERMITTED_EXTERNAL = "apps:read:permitted-external"
    APPS_RUN = "apps:run"
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"


class Accepts(StrEnum):
    """Subject types a route is willing to accept as caller."""

    USER_ACCOUNT = "user_account"
    USER_EXT_SSO = "user_ext_sso"


ACCEPT_USER_ANY: frozenset[Accepts] = frozenset({Accepts.USER_ACCOUNT, Accepts.USER_EXT_SSO})
ACCEPT_USER_EXT_SSO: frozenset[Accepts] = frozenset({Accepts.USER_EXT_SSO})

_SUBJECT_TO_ACCEPT: dict[SubjectType, Accepts] = {
    SubjectType.ACCOUNT: Accepts.USER_ACCOUNT,
    SubjectType.EXTERNAL_SSO: Accepts.USER_EXT_SSO,
}


@dataclass(frozen=True, slots=True)
class AuthContext:
    """Per-request identity published via :data:`_auth_ctx_var`
    (see :func:`set_auth_ctx` / :func:`get_auth_ctx`). ``scopes`` /
    ``subject_type`` / ``token_type`` come from the TokenKind, not the DB —
    corrupt rows can't elevate scope.

    `verified_tenants` is a snapshot of the Layer-0 verdict cache at
    authenticate time. Per-request mutations write through to Redis via
    `record_layer0_verdict`; this snapshot is not updated in place (frozen).
    """

    subject_type: SubjectType
    subject_email: str | None
    subject_issuer: str | None
    account_id: uuid.UUID | None
    client_id: str | None
    scopes: frozenset[Scope]
    token_id: uuid.UUID
    token_type: TokenType
    expires_at: datetime | None
    token_hash: str
    verified_tenants: dict[str, bool] = field(default_factory=dict)


_auth_ctx_var: ContextVar[AuthContext] = ContextVar("openapi_auth_ctx")


def set_auth_ctx(ctx: AuthContext) -> Token[AuthContext]:
    return _auth_ctx_var.set(ctx)


def reset_auth_ctx(token: Token[AuthContext]) -> None:
    _auth_ctx_var.reset(token)


def get_auth_ctx() -> AuthContext:
    return _auth_ctx_var.get()


def try_get_auth_ctx() -> AuthContext | None:
    return _auth_ctx_var.get(None)


@dataclass(frozen=True, slots=True)
class ResolvedRow:
    subject_email: str | None
    subject_issuer: str | None
    account_id: uuid.UUID | None
    client_id: str | None
    token_id: uuid.UUID
    expires_at: datetime | None
    verified_tenants: dict[str, bool] = field(default_factory=dict)

    def to_cache(self) -> dict:
        return {
            "subject_email": self.subject_email,
            "subject_issuer": self.subject_issuer,
            "account_id": str(self.account_id) if self.account_id else None,
            "client_id": self.client_id,
            "token_id": str(self.token_id),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "verified_tenants": dict(self.verified_tenants),
        }

    @classmethod
    def from_cache(cls, data: dict) -> ResolvedRow:
        return cls(
            subject_email=data["subject_email"],
            subject_issuer=data["subject_issuer"],
            account_id=uuid.UUID(data["account_id"]) if data["account_id"] else None,
            client_id=data.get("client_id"),
            token_id=uuid.UUID(data["token_id"]),
            expires_at=datetime.fromisoformat(data["expires_at"]) if data["expires_at"] else None,
            verified_tenants=_coerce_verified_tenants(data.get("verified_tenants")),
        )


def _coerce_verified_tenants(raw: object) -> dict[str, bool]:
    """Tolerate legacy entries that stored 'ok'/'denied' string verdicts.

    TODO(post-v1.0): remove once the AuthContext cache TTL has fully cycled
    on all live deployments (60s TTL → safe to drop one release after rollout).
    """
    if not isinstance(raw, dict):
        return {}
    out: dict[str, bool] = {}
    for k, v in raw.items():
        if isinstance(v, bool):
            out[k] = v
        elif v == "ok":
            out[k] = True
        elif v == "denied":
            out[k] = False
    return out


class Resolver(Protocol):
    def resolve(self, token_hash: str) -> ResolvedRow | None:  # pragma: no cover - contract
        ...


@dataclass(frozen=True, slots=True)
class TokenKind:
    prefix: str
    subject_type: SubjectType
    scopes: frozenset[Scope]
    token_type: TokenType
    resolver: Resolver

    def matches(self, token: str) -> bool:
        return token.startswith(self.prefix)


@dataclass(frozen=True, slots=True)
class MintProfile:
    """Single source of truth for (subject_type, prefix, scopes) at mint time.

    Consumers:
    - ``build_registry`` reads scopes here so the resolve-time TokenKind
      cannot drift from the mint-time intent.
    - Device-flow ``approve`` / ``approve-external`` read prefix + scopes
      here when calling ``mint_oauth_token`` and ``validate_mint_policy``.
    - ``services.openapi.mint_policy.validate_mint_policy`` cross-checks
      the (subject_type, prefix, scopes) triple a caller intends to mint
      against this table — a caller that assembles its own scope set
      from a non-canonical source will fail closed at approve time.
    """

    subject_type: SubjectType
    prefix: str
    scopes: frozenset[Scope]


MINTABLE_PROFILES: dict[SubjectType, MintProfile] = {
    SubjectType.ACCOUNT: MintProfile(
        subject_type=SubjectType.ACCOUNT,
        prefix="dfoa_",
        scopes=frozenset({Scope.FULL}),
    ),
    SubjectType.EXTERNAL_SSO: MintProfile(
        subject_type=SubjectType.EXTERNAL_SSO,
        prefix="dfoe_",
        scopes=frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL}),
    ),
}


class InvalidBearerError(Exception):
    """Token missing, unknown prefix, or no live row."""


class TokenExpiredError(Exception):
    """Hard-expire bookkeeping is the resolver's job before raising."""


# ============================================================================
# Registry
# ============================================================================


class TokenKindRegistry:
    def __init__(self, kinds: Iterable[TokenKind]) -> None:
        self._kinds: tuple[TokenKind, ...] = tuple(kinds)
        prefixes = [k.prefix for k in self._kinds]
        if len(set(prefixes)) != len(prefixes):
            raise ValueError(f"duplicate prefix in registry: {prefixes}")

    def find(self, token: str) -> TokenKind | None:
        for k in self._kinds:
            if k.matches(token):
                return k
        return None

    def kinds(self) -> tuple[TokenKind, ...]:
        return self._kinds


# ============================================================================
# Authenticator
# ============================================================================


def sha256_hex(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class BearerAuthenticator:
    def __init__(self, registry: TokenKindRegistry) -> None:
        self._registry = registry

    @property
    def registry(self) -> TokenKindRegistry:
        return self._registry

    def authenticate(self, token: str) -> AuthContext:
        """Identity + per-token rate limit (single source).

        Both the openapi pipeline (`BearerCheck`) and the decorator
        (`validate_bearer`) call this — rate-limit fires exactly once per
        request regardless of which path hosts the route.
        """
        kind = self._registry.find(token)
        if kind is None:
            raise InvalidBearerError("invalid_bearer")
        token_hash = sha256_hex(token)
        enforce_bearer_rate_limit(token_hash)
        row = kind.resolver.resolve(token_hash)
        if row is None:
            raise InvalidBearerError("invalid_bearer")
        return AuthContext(
            subject_type=kind.subject_type,
            subject_email=row.subject_email,
            subject_issuer=row.subject_issuer,
            account_id=row.account_id,
            client_id=row.client_id,
            scopes=kind.scopes,
            token_id=row.token_id,
            token_type=kind.token_type,
            expires_at=row.expires_at,
            token_hash=token_hash,
            verified_tenants=dict(row.verified_tenants),
        )


# ============================================================================
# OAuth access token resolver (PAT resolver would be a sibling class)
# ============================================================================

TOKEN_CACHE_KEY_FMT = "auth:token:{hash}"
POSITIVE_TTL_SECONDS = 60
NEGATIVE_TTL_SECONDS = 10
AUDIT_OAUTH_EXPIRED = "oauth.token_expired"

ScopeVariant = Literal["account", "external_sso"]


class OAuthAccessTokenResolver:
    """``.for_account()`` / ``.for_external_sso()`` are variant-scoped views
    sharing DB + cache plumbing.
    """

    def __init__(
        self,
        session_factory,
        redis_client,
        positive_ttl: int = POSITIVE_TTL_SECONDS,
        negative_ttl: int = NEGATIVE_TTL_SECONDS,
    ) -> None:
        self.session_factory = session_factory
        self._redis = redis_client
        self._positive_ttl = positive_ttl
        self._negative_ttl = negative_ttl

    def for_account(self) -> Resolver:
        return _VariantResolver(self, variant="account")

    def for_external_sso(self) -> Resolver:
        return _VariantResolver(self, variant="external_sso")

    def _cache_key(self, token_hash: str) -> str:
        return TOKEN_CACHE_KEY_FMT.format(hash=token_hash)

    def cache_get(self, token_hash: str) -> ResolvedRow | None | Literal["invalid"]:
        raw = self._redis.get(self._cache_key(token_hash))
        if raw is None:
            return None
        text = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
        if text == "invalid":
            return "invalid"
        try:
            return ResolvedRow.from_cache(json.loads(text))
        except (ValueError, KeyError):
            logger.warning("auth:token cache entry malformed; treating as miss")
            return None

    def cache_set_positive(self, token_hash: str, row: ResolvedRow) -> None:
        self._redis.setex(
            self._cache_key(token_hash),
            self._positive_ttl,
            json.dumps(row.to_cache()),
        )

    def cache_set_negative(self, token_hash: str) -> None:
        self._redis.setex(self._cache_key(token_hash), self._negative_ttl, "invalid")

    def hard_expire(self, session: Session, row_id: uuid.UUID | str, token_hash: str) -> None:
        """Atomic CAS — only the worker that flips revoked_at emits audit;
        replays are idempotent.
        """
        stmt = (
            update(OAuthAccessToken)
            .where(OAuthAccessToken.id == row_id, OAuthAccessToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC), token_hash=None)
        )
        result = session.execute(stmt)
        session.commit()
        if result.rowcount == 1:  # type: ignore
            logger.warning(
                "audit: %s token_id=%s",
                AUDIT_OAUTH_EXPIRED,
                row_id,
                extra={"audit": True, "token_id": str(row_id)},
            )
        self._redis.delete(self._cache_key(token_hash))
        self.cache_set_negative(token_hash)


class _VariantResolver:
    def __init__(self, parent: OAuthAccessTokenResolver, variant: ScopeVariant) -> None:
        self._parent = parent
        self._variant = variant

    def resolve(self, token_hash: str) -> ResolvedRow | None:
        cached = self._parent.cache_get(token_hash)
        if cached == "invalid":
            return None
        if cached is not None and not isinstance(cached, str):
            if not self._matches_variant(cached):
                return None
            return cached

        # Flask-SQLAlchemy's scoped_session is request-bound and not a
        # context manager; use it directly.
        session = self._parent.session_factory()
        row = self._load_from_db(session, token_hash)
        if row is None:
            self._parent.cache_set_negative(token_hash)
            return None

        now = datetime.now(UTC)
        if row.expires_at is not None and row.expires_at <= now:
            self._parent.hard_expire(session, row.id, token_hash)
            return None

        if not self._matches_variant_model(row):
            logger.error(
                "internal_state_invariant: account_id/prefix mismatch token_id=%s prefix=%s",
                row.id,
                row.prefix,
            )
            return None

        resolved = ResolvedRow(
            subject_email=row.subject_email,
            subject_issuer=row.subject_issuer,
            account_id=uuid.UUID(str(row.account_id)) if row.account_id else None,
            client_id=row.client_id,
            token_id=uuid.UUID(str(row.id)),
            expires_at=row.expires_at,
        )
        self._parent.cache_set_positive(token_hash, resolved)
        return resolved

    def _matches_variant(self, row: ResolvedRow) -> bool:
        has_account = row.account_id is not None
        if self._variant == "account":
            return has_account
        return not has_account

    def _matches_variant_model(self, row: OAuthAccessToken) -> bool:
        has_account = row.account_id is not None
        if self._variant == "account":
            return has_account and row.prefix == "dfoa_"
        return (not has_account) and row.prefix == "dfoe_"

    def _load_from_db(self, session: Session, token_hash: str) -> OAuthAccessToken | None:
        return (
            session.query(OAuthAccessToken)
            .filter(
                OAuthAccessToken.token_hash == token_hash,
                OAuthAccessToken.revoked_at.is_(None),
            )
            .one_or_none()
        )


# ============================================================================
# Layer 0 — workspace membership cache + helper
# ============================================================================


def record_layer0_verdict(token_hash: str, tenant_id: str, verdict: bool) -> None:
    """Merge a Layer-0 membership verdict into the AuthContext cache entry at
    `auth:token:{hash}`. No-op if entry missing/expired/invalid — next request
    rebuilds via authenticate() and re-runs Layer 0.
    """
    cache_key = TOKEN_CACHE_KEY_FMT.format(hash=token_hash)
    raw = redis_client.get(cache_key)
    if raw is None:
        return
    text = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
    if text == "invalid":
        return
    try:
        data = json.loads(text)
    except (ValueError, KeyError):
        return
    ttl = redis_client.ttl(cache_key)
    if ttl <= 0:
        return
    data.setdefault("verified_tenants", {})[tenant_id] = verdict
    redis_client.setex(cache_key, ttl, json.dumps(data))


def check_workspace_membership(
    *,
    account_id: uuid.UUID | str,
    tenant_id: str,
    token_hash: str,
    membership_cache: dict[str, bool] | None = None,
    cached_verdicts: dict[str, bool] | None = None,
) -> None:
    """Layer-0 enforcement core. Raises `Forbidden` on deny, returns on allow.

    Shared by the pipeline step (`WorkspaceMembershipCheck`) and the
    inline helper (`require_workspace_member`). Caller is responsible for
    short-circuiting on EE / SSO subjects before invoking — this function
    runs the membership + active-status checks unconditionally.
    """
    cache = membership_cache if membership_cache is not None else cached_verdicts or {}
    cached = cache.get(tenant_id)
    if cached is True:
        return
    if cached is False:
        raise Forbidden("workspace_membership_revoked")

    join = db.session.execute(
        select(TenantAccountJoin.id).where(
            TenantAccountJoin.account_id == account_id,
            TenantAccountJoin.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if join is None:
        record_layer0_verdict(token_hash, tenant_id, False)
        raise Forbidden("workspace_membership_revoked")

    status = db.session.execute(select(Account.status).where(Account.id == account_id)).scalar_one_or_none()
    if status != "active":
        record_layer0_verdict(token_hash, tenant_id, False)
        raise Forbidden("workspace_membership_revoked")

    record_layer0_verdict(token_hash, tenant_id, True)


def require_workspace_member(ctx: AuthContext, tenant_id: str) -> None:
    """AuthContext-flavoured wrapper around `check_workspace_membership`.

    No-op on EE (gateway RBAC owns tenant isolation) and for SSO subjects
    (no `tenant_account_joins` row by definition).
    """
    if dify_config.ENTERPRISE_ENABLED:
        return
    if ctx.subject_type != SubjectType.ACCOUNT or ctx.account_id is None:
        return
    check_workspace_membership(
        account_id=ctx.account_id,
        tenant_id=tenant_id,
        token_hash=ctx.token_hash,
        membership_cache=ctx.verified_tenants,
    )


# ============================================================================
# Decorator — route-level bearer gate
# ============================================================================


_authenticator: BearerAuthenticator | None = None


def bind_authenticator(authenticator: BearerAuthenticator) -> None:
    global _authenticator
    _authenticator = authenticator


def get_authenticator() -> BearerAuthenticator:
    if _authenticator is None:
        raise RuntimeError("BearerAuthenticator not bound; call bind_authenticator at startup")
    return _authenticator


def extract_bearer(req) -> str | None:
    """Pull the bearer token out of an HTTP request's Authorization header.

    Used by both attachment paths (the ``validate_bearer`` decorator and the
    openapi ``Pipeline.guard``) so the parsing rule lives in one place. Pipeline
    callers extract once at the boundary and pass the token through ``Context``
    so steps stay independent of the request object.
    """
    header = req.headers.get("Authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


_DP = ParamSpec("_DP")
_DR = TypeVar("_DR")


def validate_bearer(*, accept: frozenset[Accepts]) -> Callable[[Callable[_DP, _DR]], Callable[_DP, _DR]]:
    """Opt-in: omitting it leaves the route unauthenticated.

    Resolves user-level OAuth bearers (``dfoa_`` / ``dfoe_``). Legacy
    ``app-`` keys belong to ``service_api/wraps.py:validate_app_token``
    and are rejected here as the wrong auth scheme for this surface.
    """

    def wrap(fn: Callable[_DP, _DR]) -> Callable[_DP, _DR]:
        @wraps(fn)
        def inner(*args: _DP.args, **kwargs: _DP.kwargs) -> _DR:
            token = extract_bearer(request)
            if token is None:
                raise Unauthorized("missing bearer token")

            if _authenticator is None:
                raise ServiceUnavailable("bearer_auth_disabled: set ENABLE_OAUTH_BEARER=true to enable")

            try:
                ctx = get_authenticator().authenticate(token)
            except InvalidBearerError as e:
                raise Unauthorized(str(e))

            if _SUBJECT_TO_ACCEPT[ctx.subject_type] not in accept:
                raise Forbidden("token subject type not accepted here")

            # Try/finally pairing — the WSGI worker thread is reused
            # across requests, so a leaked ContextVar would publish the
            # previous caller's identity to the next request.
            reset_token = set_auth_ctx(ctx)
            try:
                return fn(*args, **kwargs)
            finally:
                reset_auth_ctx(reset_token)

        return inner

    return wrap


def bearer_feature_required[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    """503 if ENABLE_OAUTH_BEARER is off — minted tokens would be unusable
    without the authenticator, so fail fast instead of approving silently.
    """

    @wraps(fn)
    def inner(*args: P.args, **kwargs: P.kwargs) -> R:
        if not dify_config.ENABLE_OAUTH_BEARER:
            raise ServiceUnavailable("bearer_auth_disabled: set ENABLE_OAUTH_BEARER=true to enable")
        return fn(*args, **kwargs)

    return inner


def require_scope[**P, R](scope: Scope):
    """Route-level scope gate — must run AFTER validate_bearer so that
    the auth ContextVar is set. Raises ``Forbidden('insufficient_scope: <scope>')``
    when the bearer lacks both the requested scope and ``Scope.FULL``.
    """

    def wrap(fn: Callable[P, R]):
        @wraps(fn)
        def inner(*args: P.args, **kwargs: P.kwargs):
            ctx = try_get_auth_ctx()
            if ctx is None:
                raise RuntimeError(
                    "require_scope used without validate_bearer; stack @validate_bearer above @require_scope"
                )
            if Scope.FULL not in ctx.scopes and scope not in ctx.scopes:
                raise Forbidden(f"insufficient_scope: {scope}")
            return fn(*args, **kwargs)

        return inner

    return wrap


# ============================================================================
# Wiring — called once from the app factory
# ============================================================================


def build_registry(session_factory, redis_client) -> TokenKindRegistry:
    oauth = OAuthAccessTokenResolver(session_factory, redis_client)
    account = MINTABLE_PROFILES[SubjectType.ACCOUNT]
    external = MINTABLE_PROFILES[SubjectType.EXTERNAL_SSO]
    return TokenKindRegistry(
        [
            TokenKind(
                prefix=account.prefix,
                subject_type=account.subject_type,
                scopes=account.scopes,
                token_type=TokenType.OAUTH_ACCOUNT,
                resolver=oauth.for_account(),
            ),
            TokenKind(
                prefix=external.prefix,
                subject_type=external.subject_type,
                scopes=external.scopes,
                token_type=TokenType.OAUTH_EXTERNAL_SSO,
                resolver=oauth.for_external_sso(),
            ),
        ]
    )


def build_and_bind(session_factory, redis_client) -> BearerAuthenticator:
    registry = build_registry(session_factory, redis_client)
    auth = BearerAuthenticator(registry)
    bind_authenticator(auth)
    return auth
