"""Private compact-JWE primitives shared by strict server token families."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import re
from typing import TypeVar

from jwcrypto import jwe, jwk
from jwcrypto.common import JWException
from pydantic import BaseModel, ValidationError

_REQUIRED_SERVER_SECRET_BYTES = 32
_BASE64URL_TEXT_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_DEFAULT_SERVER_SECRET_ENV_VAR = "DIFY_AGENT_SERVER_SECRET_KEY"
ClaimsT = TypeVar("ClaimsT", bound=BaseModel)


def decode_server_secret_key(
    server_secret_key: str,
    *,
    env_var_name: str = _DEFAULT_SERVER_SECRET_ENV_VAR,
) -> bytes:
    """Decode one strict unpadded base64url 32-byte server root secret."""
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


def derive_server_jwe_key(server_secret_key: str, *, purpose: bytes) -> bytes:
    """Derive a purpose-isolated 32-byte content-encryption key."""
    return _hkdf_sha256(decode_server_secret_key(server_secret_key), info=purpose, length=32)


def build_symmetric_jwe_key(content_encryption_key: bytes) -> jwk.JWK:
    return jwk.JWK(kty="oct", k=_base64url_encode(content_encryption_key))


def encode_compact_jwe(claims: BaseModel, *, key: jwk.JWK) -> str:
    token = jwe.JWE(
        plaintext=json.dumps(claims.model_dump(mode="json", exclude_none=True), separators=(",", ":")).encode("utf-8"),
        protected=json.dumps({"alg": "dir", "enc": "A256GCM"}),
    )
    token.add_recipient(key)
    return token.serialize(compact=True)


def decode_compact_jwe(
    token: str,
    *,
    key: jwk.JWK,
    claims_type: type[ClaimsT],
    token_name: str,
    error_type: type[RuntimeError],
) -> ClaimsT:
    decrypted = jwe.JWE()
    try:
        decrypted.deserialize(token, key=key)
    except JWException as exc:
        raise error_type(f"failed to decrypt {token_name}") from exc
    try:
        return claims_type.model_validate_json(decrypted.payload)
    except ValidationError as exc:
        raise error_type(f"{token_name} payload is invalid") from exc


def extract_bearer_token(
    authorization: str | None,
    *,
    token_name: str,
    error_type: type[RuntimeError],
) -> str:
    if authorization is None or not authorization.startswith("Bearer "):
        raise error_type(f"Authorization must be a Bearer {token_name}")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise error_type("Authorization bearer token must not be empty")
    return token


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


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(f"{value}{padding}", altchars=b"-_", validate=True)
    except binascii.Error as exc:
        raise ValueError("invalid base64url") from exc


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


__all__ = [
    "build_symmetric_jwe_key",
    "decode_compact_jwe",
    "decode_server_secret_key",
    "derive_server_jwe_key",
    "encode_compact_jwe",
    "extract_bearer_token",
]
