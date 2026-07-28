"""Purpose-scoped compact-JWE tokens for Home Snapshot byte transfer."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import ClassVar, Literal

from jwcrypto import jwk
from pydantic import BaseModel, ConfigDict

from dify_agent.agent_stub.server.tokens._compact_jwe import (
    build_symmetric_jwe_key,
    decode_compact_jwe,
    derive_server_jwe_key,
    encode_compact_jwe,
    extract_bearer_token,
)
from dify_agent.runtime_backend.home_snapshot_refs import validate_home_snapshot_ref

HOME_SNAPSHOT_SCOPE_READ = "home_snapshot:read"
HOME_SNAPSHOT_SCOPE_WRITE = "home_snapshot:write"
HOME_SNAPSHOT_TOKEN_TTL_SECONDS = 10 * 60
_HOME_SNAPSHOT_JWE_PURPOSE = b"dify-agent:home-snapshot-transfer:jwe:v1"

type HomeSnapshotTransferScope = Literal["home_snapshot:read", "home_snapshot:write"]


class HomeSnapshotTransferTokenError(RuntimeError):
    """Raised when a Home Snapshot transfer bearer token is invalid."""


class HomeSnapshotTransferTokenClaims(BaseModel):
    exp: int
    scope: HomeSnapshotTransferScope
    snapshot_ref: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class HomeSnapshotTransferPrincipal:
    scope: HomeSnapshotTransferScope
    snapshot_ref: str


class HomeSnapshotTransferTokenCodec:
    """Encode and validate compact JWE tokens for one archive and direction."""

    _jwe_key: jwk.JWK

    def __init__(self, content_encryption_key: bytes) -> None:
        self._jwe_key = build_symmetric_jwe_key(content_encryption_key)

    @classmethod
    def from_server_secret(cls, server_secret_key: str) -> "HomeSnapshotTransferTokenCodec":
        return cls(derive_server_jwe_key(server_secret_key, purpose=_HOME_SNAPSHOT_JWE_PURPOSE))

    def encode_token(
        self,
        *,
        scope: HomeSnapshotTransferScope,
        snapshot_ref: str,
        now: int | None = None,
    ) -> str:
        issued_at = _timestamp(now)
        claims = HomeSnapshotTransferTokenClaims(
            exp=issued_at + HOME_SNAPSHOT_TOKEN_TTL_SECONDS,
            scope=scope,
            snapshot_ref=validate_home_snapshot_ref(snapshot_ref),
        )
        return encode_compact_jwe(claims, key=self._jwe_key)

    def decode_authorization_header(
        self,
        authorization: str | None,
        *,
        required_scope: HomeSnapshotTransferScope,
        now: int | None = None,
    ) -> HomeSnapshotTransferPrincipal:
        token = extract_bearer_token(
            authorization,
            token_name="compact JWE token",
            error_type=HomeSnapshotTransferTokenError,
        )
        return self.decode_token(token, required_scope=required_scope, now=now)

    def decode_token(
        self,
        token: str,
        *,
        required_scope: HomeSnapshotTransferScope,
        now: int | None = None,
    ) -> HomeSnapshotTransferPrincipal:
        claims = decode_compact_jwe(
            token,
            key=self._jwe_key,
            claims_type=HomeSnapshotTransferTokenClaims,
            token_name="Home Snapshot bearer token",
            error_type=HomeSnapshotTransferTokenError,
        )
        if _timestamp(now) >= claims.exp:
            raise HomeSnapshotTransferTokenError("Home Snapshot bearer token is expired")
        if claims.scope != required_scope:
            raise HomeSnapshotTransferTokenError(f"Home Snapshot bearer token scope must be {required_scope!r}")
        try:
            snapshot_ref = validate_home_snapshot_ref(claims.snapshot_ref)
        except ValueError as exc:
            raise HomeSnapshotTransferTokenError("Home Snapshot bearer token ref is invalid") from exc
        return HomeSnapshotTransferPrincipal(scope=claims.scope, snapshot_ref=snapshot_ref)


def _timestamp(value: int | None) -> int:
    return int(time.time() if value is None else value)


__all__ = [
    "HOME_SNAPSHOT_SCOPE_READ",
    "HOME_SNAPSHOT_SCOPE_WRITE",
    "HOME_SNAPSHOT_TOKEN_TTL_SECONDS",
    "HomeSnapshotTransferPrincipal",
    "HomeSnapshotTransferScope",
    "HomeSnapshotTransferTokenClaims",
    "HomeSnapshotTransferTokenCodec",
    "HomeSnapshotTransferTokenError",
]
