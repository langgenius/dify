"""Server-only compact-JWE codec for Agent Stub bearer tokens.

The Agent Stub accepts only encrypted bearer tokens issued by this
server process. The root secret comes from ``DIFY_AGENT_SERVER_SECRET_KEY``
and is never used directly as a content-encryption key; a purpose-specific HKDF
derivation isolates Agent Stub tokens from any future server-side token
families that may reuse the same root secret.
"""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import ClassVar
from uuid import uuid4

from jwcrypto import jwk
from pydantic import BaseModel, ConfigDict

from dify_agent.agent_stub.server.tokens._compact_jwe import (
    build_symmetric_jwe_key,
    decode_compact_jwe,
    decode_server_secret_key,
    derive_server_jwe_key,
    encode_compact_jwe,
    extract_bearer_token,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


AGENT_STUB_TOKEN_ISSUER = "dify-agent-server"
AGENT_STUB_TOKEN_AUDIENCE = "dify-agent-agent-stub"
AGENT_STUB_TOKEN_SCOPE_CONNECT = "agent_stub:connect"
AGENT_STUB_TOKEN_TTL_SECONDS = 24 * 60 * 60
_AGENT_STUB_JWE_PURPOSE = b"dify-agent:agent-stub:jwe:v1"


class AgentStubTokenError(RuntimeError):
    """Raised when an Agent Stub bearer token is missing or invalid."""


class AgentStubShellClaims(BaseModel):
    """Optional shell-session claims embedded in Agent Stub tokens."""

    session_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class AgentStubTokenClaims(BaseModel):
    """Authenticated claim set carried by one compact JWE bearer token."""

    iss: str
    aud: str
    iat: int
    nbf: int
    exp: int
    jti: str
    scope: list[str]
    execution_context: DifyExecutionContextLayerConfig
    shell: AgentStubShellClaims | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True)
class AgentStubPrincipal:
    """Decoded request principal for one authenticated Agent Stub call."""

    execution_context: DifyExecutionContextLayerConfig
    session_id: str | None
    scope: list[str]
    token_id: str


class AgentStubTokenCodec:
    """Encode and decode compact JWE Agent Stub bearer tokens."""

    _content_encryption_key: bytes
    _jwe_key: jwk.JWK

    def __init__(self, content_encryption_key: bytes) -> None:
        self._content_encryption_key = content_encryption_key
        self._jwe_key = build_symmetric_jwe_key(content_encryption_key)

    @classmethod
    def from_server_secret(cls, server_secret_key: str) -> AgentStubTokenCodec:
        """Construct a codec from the configured base64url-encoded server secret."""
        return cls(derive_agent_stub_jwe_key(server_secret_key))

    def build_connection_claims(
        self,
        execution_context: DifyExecutionContextLayerConfig,
        *,
        session_id: str | None = None,
        now: int | None = None,
    ) -> AgentStubTokenClaims:
        """Build the fixed-24h claim set for one Agent Stub connection token."""
        issued_at = _timestamp(now)
        shell_claims = AgentStubShellClaims(session_id=session_id) if session_id is not None else None
        return AgentStubTokenClaims(
            iss=AGENT_STUB_TOKEN_ISSUER,
            aud=AGENT_STUB_TOKEN_AUDIENCE,
            iat=issued_at,
            nbf=issued_at,
            exp=issued_at + AGENT_STUB_TOKEN_TTL_SECONDS,
            jti=str(uuid4()),
            scope=[AGENT_STUB_TOKEN_SCOPE_CONNECT],
            execution_context=execution_context,
            shell=shell_claims,
        )

    def encode_connection_token(
        self,
        execution_context: DifyExecutionContextLayerConfig,
        *,
        session_id: str | None = None,
        now: int | None = None,
    ) -> str:
        """Encode one fixed-24h Agent Stub compact JWE bearer token."""
        return self.encode_claims(self.build_connection_claims(execution_context, session_id=session_id, now=now))

    def encode_claims(self, claims: AgentStubTokenClaims) -> str:
        """Encrypt one validated Agent Stub claim set as compact JWE."""
        return encode_compact_jwe(claims, key=self._jwe_key)

    def decode_authorization_header(self, authorization: str | None, *, now: int | None = None) -> AgentStubPrincipal:
        """Decode a ``Bearer <compact-jwe>`` header into a request principal."""
        token = extract_bearer_token(
            authorization,
            token_name="compact JWE token",
            error_type=AgentStubTokenError,
        )
        return self.decode_token(token, now=now)

    def decode_token(self, token: str, *, now: int | None = None) -> AgentStubPrincipal:
        """Decrypt and validate one compact JWE token string."""
        claims = decode_compact_jwe(
            token,
            key=self._jwe_key,
            claims_type=AgentStubTokenClaims,
            token_name="Agent Stub bearer token",
            error_type=AgentStubTokenError,
        )

        current_time = _timestamp(now)
        _validate_claims(claims, now=current_time)
        return AgentStubPrincipal(
            execution_context=claims.execution_context,
            session_id=claims.shell.session_id if claims.shell is not None else None,
            scope=list(claims.scope),
            token_id=claims.jti,
        )


def derive_agent_stub_jwe_key(server_secret_key: str) -> bytes:
    """Derive the purpose-scoped 32-byte JWE content-encryption key."""
    return derive_server_jwe_key(server_secret_key, purpose=_AGENT_STUB_JWE_PURPOSE)


def _validate_claims(claims: AgentStubTokenClaims, *, now: int) -> None:
    if claims.iss != AGENT_STUB_TOKEN_ISSUER:
        raise AgentStubTokenError(f"Agent Stub bearer token issuer must be {AGENT_STUB_TOKEN_ISSUER!r}")
    if claims.aud != AGENT_STUB_TOKEN_AUDIENCE:
        raise AgentStubTokenError(f"Agent Stub bearer token audience must be {AGENT_STUB_TOKEN_AUDIENCE!r}")
    if now < claims.nbf:
        raise AgentStubTokenError("Agent Stub bearer token is not valid yet")
    if now >= claims.exp:
        raise AgentStubTokenError("Agent Stub bearer token is expired")
    if AGENT_STUB_TOKEN_SCOPE_CONNECT not in claims.scope:
        raise AgentStubTokenError(f"Agent Stub bearer token scope must include {AGENT_STUB_TOKEN_SCOPE_CONNECT!r}")


def _timestamp(value: int | None) -> int:
    return int(time.time() if value is None else value)


__all__ = [
    "AGENT_STUB_TOKEN_AUDIENCE",
    "AGENT_STUB_TOKEN_ISSUER",
    "AGENT_STUB_TOKEN_SCOPE_CONNECT",
    "AGENT_STUB_TOKEN_TTL_SECONDS",
    "AgentStubPrincipal",
    "AgentStubTokenClaims",
    "AgentStubTokenCodec",
    "AgentStubTokenError",
    "decode_server_secret_key",
    "derive_agent_stub_jwe_key",
]
