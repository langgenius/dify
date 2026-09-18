"""HS256 compact JWS keyed on the shared Dify SECRET_KEY. Used by the SSO
state envelope, external subject assertion, and approval-grant cookie —
all three share one key-set so api ↔ enterprise can verify each other.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt

from configs import dify_config

AUD_STATE_ENVELOPE = "api.sso.state_envelope"
AUD_EXT_SUBJECT_ASSERTION = "api.device_flow.external_subject_assertion"
AUD_APPROVAL_GRANT = "api.device_flow.approval_grant"

ACTIVE_KID_V1 = "dify-shared-v1"


class KeySetError(Exception):
    pass


class KeySet:
    """``from_entries`` reserves multi-kid construction for rotation slots."""

    def __init__(self, entries: dict[str, bytes], active_kid: str) -> None:
        if active_kid not in entries:
            raise KeySetError(f"active kid {active_kid!r} missing from key-set")
        if not entries[active_kid]:
            raise KeySetError(f"active kid {active_kid!r} has empty secret")
        self._entries: dict[str, bytes] = {k: bytes(v) for k, v in entries.items()}
        self._active_kid = active_kid

    @classmethod
    def from_shared_secret(cls) -> KeySet:
        secret = dify_config.SECRET_KEY
        if not secret:
            raise KeySetError("dify_config.SECRET_KEY is empty; cannot build key-set")
        return cls({ACTIVE_KID_V1: secret.encode("utf-8")}, ACTIVE_KID_V1)

    @classmethod
    def from_entries(cls, entries: dict[str, bytes], active_kid: str) -> KeySet:
        return cls(entries, active_kid)

    @property
    def active_kid(self) -> str:
        return self._active_kid

    def lookup(self, kid: str) -> bytes | None:
        return self._entries.get(kid)


def sign(keyset: KeySet, payload: dict, aud: str, ttl_seconds: int) -> str:
    """``iat`` + ``exp`` are injected here; callers must not set them."""
    if "aud" in payload or "iat" in payload or "exp" in payload:
        raise ValueError("reserved claim present in payload (aud/iat/exp)")
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive")

    kid = keyset.active_kid
    secret = keyset.lookup(kid)
    if secret is None:
        raise KeySetError(f"active kid {kid!r} lookup miss")

    iat = datetime.now(UTC)
    exp = iat + timedelta(seconds=ttl_seconds)
    claims = {**payload, "aud": aud, "iat": iat, "exp": exp}
    return jwt.encode(
        claims,
        secret,
        algorithm="HS256",
        headers={"kid": kid, "typ": "JWT"},
    )


class VerifyError(Exception):
    pass


def verify(keyset: KeySet, token: str, expected_aud: str) -> dict:
    """Unknown kid is rejected — never fall back to the active kid, since
    a past kid value would otherwise be forgeable by anyone who saw it.
    """
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as e:
        raise VerifyError(f"decode header: {e}") from e
    kid = header.get("kid")
    if not kid:
        raise VerifyError("no kid in header")
    secret = keyset.lookup(kid)
    if secret is None:
        raise VerifyError(f"unknown kid {kid!r}")
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=expected_aud,
        )
    except jwt.ExpiredSignatureError as e:
        raise VerifyError("token expired") from e
    except jwt.InvalidAudienceError as e:
        raise VerifyError("aud mismatch") from e
    except jwt.PyJWTError as e:
        raise VerifyError(f"decode: {e}") from e
