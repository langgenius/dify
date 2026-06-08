"""Server-only compact-JWE codec for shell back proxy bearer tokens.

The shell back proxy route accepts only encrypted bearer tokens issued by this
server process. The root secret comes from ``DIFY_AGENT_SERVER_SECRET_KEY``
and is never used directly as a content-encryption key; a purpose-specific HKDF
derivation isolates shell back proxy tokens from any future server-side token
families that may reuse the same root secret.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
import hashlib
import hmac
import json
import re
import time
from typing import ClassVar
from uuid import uuid4

from jwcrypto import jwe, jwk
from jwcrypto.common import JWException
from pydantic import BaseModel, ConfigDict, ValidationError

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig


BACK_PROXY_TOKEN_ISSUER = "dify-agent-server"
BACK_PROXY_TOKEN_AUDIENCE = "dify-agent-shell-back-proxy"
BACK_PROXY_TOKEN_SCOPE_CONNECT = "shell_back_proxy:connect"
BACK_PROXY_TOKEN_TTL_SECONDS = 24 * 60 * 60
_BACK_PROXY_JWE_PURPOSE = b"dify-agent:shell-back-proxy:jwe:v1"
_REQUIRED_SERVER_SECRET_BYTES = 32
_BASE64URL_TEXT_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_DEFAULT_SERVER_SECRET_ENV_VAR = "DIFY_AGENT_SERVER_SECRET_KEY"


class BackProxyTokenError(RuntimeError):
    """Raised when a shell back proxy bearer token is missing or invalid."""


class BackProxyShellClaims(BaseModel):
    """Optional shell-session claims embedded in back proxy tokens."""

    session_id: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BackProxyTokenClaims(BaseModel):
    """Authenticated claim set carried by one compact JWE bearer token."""

    iss: str
    aud: str
    iat: int
    nbf: int
    exp: int
    jti: str
    scope: list[str]
    execution_context: DifyExecutionContextLayerConfig
    shell: BackProxyShellClaims | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


@dataclass(slots=True)
class BackProxyPrincipal:
    """Decoded request principal for one authenticated back proxy call."""

    execution_context: DifyExecutionContextLayerConfig
    session_id: str | None
    scope: list[str]
    token_id: str


class BackProxyTokenCodec:
    """Encode and decode compact JWE shell back proxy bearer tokens."""

    _content_encryption_key: bytes
    _jwe_key: jwk.JWK

    def __init__(self, content_encryption_key: bytes) -> None:
        self._content_encryption_key = content_encryption_key
        self._jwe_key = jwk.JWK(
            kty="oct",
            k=_base64url_encode(content_encryption_key),
        )

    @classmethod
    def from_server_secret(cls, server_secret_key: str) -> BackProxyTokenCodec:
        """Construct a codec from the configured base64url-encoded server secret."""
        return cls(derive_back_proxy_jwe_key(server_secret_key))

    def build_connection_claims(
        self,
        execution_context: DifyExecutionContextLayerConfig,
        *,
        session_id: str | None = None,
        now: int | None = None,
    ) -> BackProxyTokenClaims:
        """Build the fixed-24h claim set for one shell back proxy connection token."""
        issued_at = _timestamp(now)
        shell_claims = BackProxyShellClaims(session_id=session_id) if session_id is not None else None
        return BackProxyTokenClaims(
            iss=BACK_PROXY_TOKEN_ISSUER,
            aud=BACK_PROXY_TOKEN_AUDIENCE,
            iat=issued_at,
            nbf=issued_at,
            exp=issued_at + BACK_PROXY_TOKEN_TTL_SECONDS,
            jti=str(uuid4()),
            scope=[BACK_PROXY_TOKEN_SCOPE_CONNECT],
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
        """Encode one fixed-24h shell back proxy compact JWE bearer token."""
        return self.encode_claims(self.build_connection_claims(execution_context, session_id=session_id, now=now))

    def encode_claims(self, claims: BackProxyTokenClaims) -> str:
        """Encrypt one validated back proxy claim set as compact JWE."""
        token = jwe.JWE(
            plaintext=json.dumps(claims.model_dump(mode="json", exclude_none=True), separators=(",", ":")).encode(
                "utf-8"
            ),
            protected=json.dumps({"alg": "dir", "enc": "A256GCM"}),
        )
        token.add_recipient(self._jwe_key)
        return token.serialize(compact=True)

    def decode_authorization_header(self, authorization: str | None, *, now: int | None = None) -> BackProxyPrincipal:
        """Decode a ``Bearer <compact-jwe>`` header into a request principal."""
        if authorization is None or not authorization.startswith("Bearer "):
            raise BackProxyTokenError("Authorization must be a Bearer compact JWE token")
        token = authorization.removeprefix("Bearer ").strip()
        if not token:
            raise BackProxyTokenError("Authorization bearer token must not be empty")
        return self.decode_token(token, now=now)

    def decode_token(self, token: str, *, now: int | None = None) -> BackProxyPrincipal:
        """Decrypt and validate one compact JWE token string."""
        decrypted = jwe.JWE()
        try:
            decrypted.deserialize(token, key=self._jwe_key)
        except JWException as exc:
            raise BackProxyTokenError("failed to decrypt back proxy bearer token") from exc

        try:
            claims = BackProxyTokenClaims.model_validate_json(decrypted.payload)
        except ValidationError as exc:
            raise BackProxyTokenError("back proxy bearer token payload is invalid") from exc

        current_time = _timestamp(now)
        _validate_claims(claims, now=current_time)
        return BackProxyPrincipal(
            execution_context=claims.execution_context,
            session_id=claims.shell.session_id if claims.shell is not None else None,
            scope=list(claims.scope),
            token_id=claims.jti,
        )


def decode_server_secret_key(server_secret_key: str, *, env_var_name: str = _DEFAULT_SERVER_SECRET_ENV_VAR) -> bytes:
    """Decode and validate the configured server root secret.

    The secret must be strict unpadded base64url text and must decode to
    exactly 32 bytes. Settings validation uses this helper so operator
    misconfiguration fails fast before the server starts issuing or accepting
    back proxy tokens.
    """
    normalized = server_secret_key.strip()
    if not normalized or not _BASE64URL_TEXT_PATTERN.fullmatch(normalized):
        raise ValueError(f"{env_var_name} must be valid unpadded base64url text")
    try:
        decoded = _base64url_decode(normalized)
    except ValueError as exc:
        raise ValueError(f"{env_var_name} must be valid unpadded base64url text") from exc
    if len(decoded) != _REQUIRED_SERVER_SECRET_BYTES:
        raise ValueError(f"{env_var_name} must decode to exactly {_REQUIRED_SERVER_SECRET_BYTES} decoded bytes")
    return decoded


def derive_back_proxy_jwe_key(server_secret_key: str) -> bytes:
    """Derive the purpose-scoped 32-byte JWE content-encryption key."""
    return _hkdf_sha256(decode_server_secret_key(server_secret_key), info=_BACK_PROXY_JWE_PURPOSE, length=32)


def _validate_claims(claims: BackProxyTokenClaims, *, now: int) -> None:
    if claims.iss != BACK_PROXY_TOKEN_ISSUER:
        raise BackProxyTokenError(f"back proxy bearer token issuer must be {BACK_PROXY_TOKEN_ISSUER!r}")
    if claims.aud != BACK_PROXY_TOKEN_AUDIENCE:
        raise BackProxyTokenError(f"back proxy bearer token audience must be {BACK_PROXY_TOKEN_AUDIENCE!r}")
    if now < claims.nbf:
        raise BackProxyTokenError("back proxy bearer token is not valid yet")
    if now >= claims.exp:
        raise BackProxyTokenError("back proxy bearer token is expired")
    if BACK_PROXY_TOKEN_SCOPE_CONNECT not in claims.scope:
        raise BackProxyTokenError(f"back proxy bearer token scope must include {BACK_PROXY_TOKEN_SCOPE_CONNECT!r}")


def _hkdf_sha256(input_key_material: bytes, *, info: bytes, length: int) -> bytes:
    hash_len = hashlib.sha256().digest_size
    salt = b"\x00" * hash_len
    pseudorandom_key = hmac.new(salt, input_key_material, hashlib.sha256).digest()
    output = bytearray()
    previous_block = b""
    counter = 1
    while len(output) < length:
        previous_block = hmac.new(
            pseudorandom_key,
            previous_block + info + bytes([counter]),
            hashlib.sha256,
        ).digest()
        output.extend(previous_block)
        counter += 1
    return bytes(output[:length])


def _timestamp(value: int | None) -> int:
    return int(time.time() if value is None else value)


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(f"{value}{padding}", altchars=b"-_", validate=True)
    except binascii.Error as exc:
        raise ValueError("invalid base64url") from exc


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


__all__ = [
    "BACK_PROXY_TOKEN_AUDIENCE",
    "BACK_PROXY_TOKEN_ISSUER",
    "BACK_PROXY_TOKEN_SCOPE_CONNECT",
    "BACK_PROXY_TOKEN_TTL_SECONDS",
    "BackProxyPrincipal",
    "BackProxyTokenClaims",
    "BackProxyTokenCodec",
    "BackProxyTokenError",
    "decode_server_secret_key",
    "derive_back_proxy_jwe_key",
]
