"""Issue short-lived tenant credentials for KnowledgeFS requests."""

from __future__ import annotations

from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

from clients.knowledge_fs.errors import KnowledgeFSConfigurationError

KnowledgeFSScope = Literal["knowledge-spaces:read", "knowledge-spaces:write"]


@dataclass(frozen=True, slots=True)
class BearerCredential:
    """A bearer token and its expiry, with the secret excluded from representations."""

    token: str = field(repr=False)
    expires_at: datetime


class KnowledgeFSCredentialProvider(Protocol):
    """Issue one tenant- and subject-scoped credential for an outbound operation."""

    def issue(
        self,
        *,
        tenant_id: str,
        subject_id: str,
        scope: KnowledgeFSScope,
    ) -> BearerCredential:
        """Return a bearer credential containing the requested minimum scope."""


class StaticKnowledgeFSCredentialProvider:
    """Issue a development credential only for its explicitly configured Dify tenant."""

    _expected_tenant_id: str
    _token: str

    def __init__(self, *, token: str, expected_tenant_id: str) -> None:
        self._expected_tenant_id = expected_tenant_id
        self._token = token

    def issue(
        self,
        *,
        tenant_id: str,
        subject_id: str,
        scope: KnowledgeFSScope,
    ) -> BearerCredential:
        """Return the static credential, rejecting another tenant before external I/O."""
        if tenant_id != self._expected_tenant_id:
            raise KnowledgeFSConfigurationError(
                "KNOWLEDGE_FS_STATIC_TENANT_ID does not match the current Dify workspace"
            )
        return BearerCredential(token=self._token, expires_at=datetime.max.replace(tzinfo=UTC))


_request_credential: ContextVar[BearerCredential | None] = ContextVar(
    "knowledge_fs_request_credential",
    default=None,
)


class KnowledgeFSRequestAuth(httpx.Auth):
    """Inject the current context-local credential into one outbound request."""

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        credential = _request_credential.get()
        if credential is None:
            raise RuntimeError("KnowledgeFS request credential is not set")
        request.headers["Authorization"] = f"Bearer {credential.token}"
        yield request


@contextmanager
def use_knowledge_fs_credential(credential: BearerCredential) -> Iterator[None]:
    """Bind a credential to the current request context and always restore it."""
    reset_token = _request_credential.set(credential)
    try:
        yield
    finally:
        _request_credential.reset(reset_token)


class RS256KnowledgeFSCredentialProvider:
    """Sign KnowledgeFS access tokens with a dedicated RSA private key."""

    _private_key: RSAPrivateKey
    _key_id: str
    _issuer: str
    _audience: str
    _ttl_seconds: int
    _now: Callable[[], datetime]
    _jti_factory: Callable[[], str]

    def __init__(
        self,
        *,
        private_key: RSAPrivateKey,
        key_id: str,
        issuer: str,
        audience: str,
        ttl_seconds: int,
        now: Callable[[], datetime],
        jti_factory: Callable[[], str],
    ) -> None:
        self._private_key = private_key
        self._key_id = key_id
        self._issuer = issuer
        self._audience = audience
        self._ttl_seconds = ttl_seconds
        self._now = now
        self._jti_factory = jti_factory

    def issue(
        self,
        *,
        tenant_id: str,
        subject_id: str,
        scope: KnowledgeFSScope,
    ) -> BearerCredential:
        """Sign and return one short-lived tenant credential."""
        issued_at = self._now().replace(microsecond=0)
        expires_at = issued_at + timedelta(seconds=self._ttl_seconds)
        issued_at_timestamp = int(issued_at.timestamp())
        token = jwt.encode(
            {
                "iss": self._issuer,
                "aud": self._audience,
                "sub": subject_id,
                "tenant_id": tenant_id,
                "scope": scope,
                "iat": issued_at_timestamp,
                "nbf": issued_at_timestamp,
                "exp": int(expires_at.timestamp()),
                "jti": self._jti_factory(),
            },
            self._private_key,
            algorithm="RS256",
            headers={"kid": self._key_id, "typ": "dify-kfs+jwt"},
        )
        return BearerCredential(token=token, expires_at=expires_at)


__all__ = [
    "BearerCredential",
    "KnowledgeFSCredentialProvider",
    "KnowledgeFSRequestAuth",
    "KnowledgeFSScope",
    "RS256KnowledgeFSCredentialProvider",
    "StaticKnowledgeFSCredentialProvider",
    "use_knowledge_fs_credential",
]
