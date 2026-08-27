"""OAuth bearer primitives."""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Callable, Iterable
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from functools import wraps
from typing import Literal, Protocol

from sqlalchemy import update
from sqlalchemy.orm import Session
from werkzeug.exceptions import ServiceUnavailable

from configs import dify_config
from libs.rate_limit import enforce_bearer_rate_limit
from models import OAuthAccessToken

logger = logging.getLogger(__name__)


# ============================================================================
# Contract — types, enums, protocols
# ============================================================================


class Scope(StrEnum):
    """Catalog of bearer scopes recognised by the openapi surface.

    `FULL` is the catch-all carried by `dfoa_` account tokens — it satisfies
    any per-route scope requirement. `dfoe_` tokens carry the per-feature
    scopes (`APPS_RUN`, `APPS_READ_PERMITTED_EXTERNAL`).
    """

    FULL = "full"
    APPS_READ = "apps:read"
    APPS_READ_PERMITTED_EXTERNAL = "apps:read:permitted-external"
    APPS_RUN = "apps:run"
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"


class SubjectType(StrEnum):
    # Annotation-only names are not enum members; they declare what `__new__`
    # attaches, so a static checker can see `.prefix` / `.scopes`.
    prefix: str
    scopes: frozenset[Scope]

    ACCOUNT = ("account", "dfoa_", frozenset({Scope.FULL}))
    EXTERNAL_SSO = (
        "external_sso",
        "dfoe_",
        frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL}),
    )

    def __new__(cls, value: str, prefix: str, scopes: frozenset[Scope]) -> SubjectType:
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.prefix = prefix
        obj.scopes = scopes
        return obj


class TokenType(StrEnum):
    OAUTH_ACCOUNT = "oauth_account"
    OAUTH_EXTERNAL_SSO = "oauth_external_sso"


@dataclass(frozen=True, slots=True)
class AuthContext:
    """Per-request identity published via :data:`_auth_ctx_var`
    (see :func:`set_auth_ctx` / :func:`get_auth_ctx`). ``scopes`` /
    ``subject_type`` / ``token_type`` come from the TokenKind, not the DB —
    corrupt rows can't elevate scope.
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

    def to_cache(self) -> dict:
        return {
            "subject_email": self.subject_email,
            "subject_issuer": self.subject_issuer,
            "account_id": str(self.account_id) if self.account_id else None,
            "client_id": self.client_id,
            "token_id": str(self.token_id),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
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
        )


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


class InvalidBearerError(Exception):
    """Token missing, unknown prefix, or no live row."""


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

        The openapi auth pipeline is the only caller, so the rate limit fires
        exactly once per request.
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

    Used by the openapi auth pipeline, which extracts once at the request
    boundary so the parsing rule lives in one place and later steps stay
    independent of the request object.
    """
    header = req.headers.get("Authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


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


# ============================================================================
# Wiring — called once from the app factory
# ============================================================================


def build_registry(session_factory, redis_client) -> TokenKindRegistry:
    oauth = OAuthAccessTokenResolver(session_factory, redis_client)
    return TokenKindRegistry(
        [
            TokenKind(
                prefix=SubjectType.ACCOUNT.prefix,
                subject_type=SubjectType.ACCOUNT,
                scopes=SubjectType.ACCOUNT.scopes,
                token_type=TokenType.OAUTH_ACCOUNT,
                resolver=oauth.for_account(),
            ),
            TokenKind(
                prefix=SubjectType.EXTERNAL_SSO.prefix,
                subject_type=SubjectType.EXTERNAL_SSO,
                scopes=SubjectType.EXTERNAL_SSO.scopes,
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
