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
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from functools import wraps
from typing import Callable, Iterable, Literal, Protocol

from flask import g, request
from sqlalchemy import update
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, ServiceUnavailable, Unauthorized

from models import OAuthAccessToken

logger = logging.getLogger(__name__)


# ============================================================================
# Contract — types, enums, protocols
# ============================================================================


class SubjectType(StrEnum):
    ACCOUNT = "account"
    EXTERNAL_SSO = "external_sso"


@dataclass(frozen=True, slots=True)
class AuthContext:
    """Attached to ``g.auth_ctx``. ``scopes`` / ``subject_type`` / ``source``
    come from the TokenKind, not the DB — corrupt rows can't elevate scope.
    """

    subject_type: SubjectType
    subject_email: str | None
    subject_issuer: str | None
    account_id: uuid.UUID | None
    scopes: frozenset[str]
    token_id: uuid.UUID
    source: str
    expires_at: datetime | None


@dataclass(frozen=True, slots=True)
class ResolvedRow:
    subject_email: str | None
    subject_issuer: str | None
    account_id: uuid.UUID | None
    token_id: uuid.UUID
    expires_at: datetime | None


class Resolver(Protocol):
    def resolve(self, token_hash: str) -> ResolvedRow | None:  # pragma: no cover - contract
        ...


@dataclass(frozen=True, slots=True)
class TokenKind:
    prefix: str
    subject_type: SubjectType
    scopes: frozenset[str]
    source: str
    resolver: Resolver

    def matches(self, token: str) -> bool:
        return token.startswith(self.prefix)


class InvalidBearer(Exception):
    """Token missing, unknown prefix, or no live row."""


class TokenExpired(Exception):
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

    def authenticate(self, token: str) -> AuthContext:
        kind = self._registry.find(token)
        if kind is None:
            raise InvalidBearer("unknown token prefix")
        row = kind.resolver.resolve(sha256_hex(token))
        if row is None:
            raise InvalidBearer("token unknown or revoked")
        return AuthContext(
            subject_type=kind.subject_type,
            subject_email=row.subject_email,
            subject_issuer=row.subject_issuer,
            account_id=row.account_id,
            scopes=kind.scopes,
            token_id=row.token_id,
            source=kind.source,
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
        self._session_factory = session_factory
        self._redis = redis_client
        self._positive_ttl = positive_ttl
        self._negative_ttl = negative_ttl

    def for_account(self) -> Resolver:
        return _VariantResolver(self, variant="account")

    def for_external_sso(self) -> Resolver:
        return _VariantResolver(self, variant="external_sso")

    def _cache_key(self, token_hash: str) -> str:
        return TOKEN_CACHE_KEY_FMT.format(hash=token_hash)

    def _cache_get(self, token_hash: str) -> ResolvedRow | None | Literal["invalid"]:
        raw = self._redis.get(self._cache_key(token_hash))
        if raw is None:
            return None
        text = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
        if text == "invalid":
            return "invalid"
        try:
            data = json.loads(text)
            return _row_from_cache(data)
        except (ValueError, KeyError):
            logger.warning("auth:token cache entry malformed; treating as miss")
            return None

    def _cache_set_positive(self, token_hash: str, row: ResolvedRow) -> None:
        self._redis.setex(
            self._cache_key(token_hash),
            self._positive_ttl,
            json.dumps(_row_to_cache(row)),
        )

    def _cache_set_negative(self, token_hash: str) -> None:
        self._redis.setex(self._cache_key(token_hash), self._negative_ttl, "invalid")

    def _hard_expire(self, session: Session, row_id: uuid.UUID, token_hash: str) -> None:
        """Atomic CAS — only the worker that flips revoked_at emits audit;
        replays are idempotent. Spec: tokens.md §Detection + hard-expire.
        """
        stmt = (
            update(OAuthAccessToken)
            .where(OAuthAccessToken.id == row_id, OAuthAccessToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC), token_hash=None)
        )
        result = session.execute(stmt)
        session.commit()
        if result.rowcount == 1:
            logger.warning(
                "audit: %s token_id=%s", AUDIT_OAUTH_EXPIRED, row_id,
                extra={"audit": True, "token_id": str(row_id)},
            )
        self._redis.delete(self._cache_key(token_hash))
        self._cache_set_negative(token_hash)


class _VariantResolver:

    def __init__(self, parent: OAuthAccessTokenResolver, variant: ScopeVariant) -> None:
        self._parent = parent
        self._variant = variant

    def resolve(self, token_hash: str) -> ResolvedRow | None:
        cached = self._parent._cache_get(token_hash)
        if cached == "invalid":
            return None
        if cached is not None and not isinstance(cached, str):
            if not self._matches_variant(cached):
                return None
            return cached

        # _session_factory returns Flask-SQLAlchemy's scoped_session, which is
        # request-bound and not a context manager; use it directly.
        session = self._parent._session_factory()
        row = self._load_from_db(session, token_hash)
        if row is None:
            self._parent._cache_set_negative(token_hash)
            return None

        now = datetime.now(UTC)
        if row.expires_at is not None and row.expires_at <= now:
            self._parent._hard_expire(session, row.id, token_hash)
            return None

        if not self._matches_variant_model(row):
            logger.error(
                "internal_state_invariant: account_id/prefix mismatch token_id=%s prefix=%s",
                row.id, row.prefix,
            )
            return None

        resolved = ResolvedRow(
            subject_email=row.subject_email,
            subject_issuer=row.subject_issuer,
            account_id=uuid.UUID(str(row.account_id)) if row.account_id else None,
            token_id=uuid.UUID(str(row.id)),
            expires_at=row.expires_at,
        )
        self._parent._cache_set_positive(token_hash, resolved)
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


def _row_to_cache(row: ResolvedRow) -> dict:
    return {
        "subject_email": row.subject_email,
        "subject_issuer": row.subject_issuer,
        "account_id": str(row.account_id) if row.account_id else None,
        "token_id": str(row.token_id),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
    }


def _row_from_cache(data: dict) -> ResolvedRow:
    return ResolvedRow(
        subject_email=data["subject_email"],
        subject_issuer=data["subject_issuer"],
        account_id=uuid.UUID(data["account_id"]) if data["account_id"] else None,
        token_id=uuid.UUID(data["token_id"]),
        expires_at=datetime.fromisoformat(data["expires_at"]) if data["expires_at"] else None,
    )


# ============================================================================
# Decorator — route-level bearer gate
# ============================================================================


class Accepts(StrEnum):
    USER_ACCOUNT = "user_account"
    USER_EXT_SSO = "user_ext_sso"
    APP = "app"


ACCEPT_USER_ANY: frozenset[Accepts] = frozenset({Accepts.USER_ACCOUNT, Accepts.USER_EXT_SSO})


_SUBJECT_TO_ACCEPT: dict[SubjectType, Accepts] = {
    SubjectType.ACCOUNT: Accepts.USER_ACCOUNT,
    SubjectType.EXTERNAL_SSO: Accepts.USER_EXT_SSO,
}


_authenticator: BearerAuthenticator | None = None


def bind_authenticator(authenticator: BearerAuthenticator) -> None:
    global _authenticator
    _authenticator = authenticator


def get_authenticator() -> BearerAuthenticator:
    if _authenticator is None:
        raise RuntimeError("BearerAuthenticator not bound; call bind_authenticator at startup")
    return _authenticator


def _extract_bearer(req) -> str | None:
    header = req.headers.get("Authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


def validate_bearer(*, accept: frozenset[Accepts]) -> Callable:
    """Opt-in: omitting it leaves the route unauthenticated.

    Coexists with legacy ``app-`` keys (tenant+app scoped, resolved in
    ``service_api/wraps.py``) and user-level OAuth bearers (resolved here).
    """

    def wrap(fn: Callable) -> Callable:
        @wraps(fn)
        def inner(*args, **kwargs):
            token = _extract_bearer(request)
            if token is None:
                raise Unauthorized("missing bearer token")

            # app- keys bypass the OAuth authenticator (work even when disabled).
            if token.startswith("app-"):
                if Accepts.APP not in accept:
                    raise Unauthorized("app-scoped keys not accepted here")
                return fn(*args, **kwargs)

            if _authenticator is None:
                raise ServiceUnavailable(
                    "bearer_auth_disabled: set ENABLE_OAUTH_BEARER=true to enable"
                )

            try:
                ctx = get_authenticator().authenticate(token)
            except InvalidBearer as e:
                raise Unauthorized(str(e))

            if _SUBJECT_TO_ACCEPT[ctx.subject_type] not in accept:
                raise Forbidden("token subject type not accepted here")

            g.auth_ctx = ctx
            return fn(*args, **kwargs)

        return inner

    return wrap


# ============================================================================
# Wiring — called once from the app factory
# ============================================================================


def build_registry(session_factory, redis_client) -> TokenKindRegistry:
    oauth = OAuthAccessTokenResolver(session_factory, redis_client)
    return TokenKindRegistry([
        TokenKind(
            prefix="dfoa_",
            subject_type=SubjectType.ACCOUNT,
            scopes=frozenset({"full"}),
            source="oauth_account",
            resolver=oauth.for_account(),
        ),
        TokenKind(
            prefix="dfoe_",
            subject_type=SubjectType.EXTERNAL_SSO,
            scopes=frozenset({"apps:run"}),
            source="oauth_external_sso",
            resolver=oauth.for_external_sso(),
        ),
    ])


def build_and_bind(session_factory, redis_client) -> BearerAuthenticator:
    registry = build_registry(session_factory, redis_client)
    auth = BearerAuthenticator(registry)
    bind_authenticator(auth)
    return auth
