"""Device-flow approval-grant security and anti-framing primitives."""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from flask import Blueprint
from pydantic import BaseModel, Field, ValidationError

from libs import jws
from libs.token import is_secure

logger = logging.getLogger(__name__)


# ============================================================================
# approval_grant cookie
# ============================================================================


APPROVAL_GRANT_COOKIE_NAME = "device_approval_grant"
APPROVAL_GRANT_COOKIE_PATH = "/openapi/v1/oauth/device"
APPROVAL_GRANT_COOKIE_TTL_SECONDS = 300  # 5 min
NONCE_TTL_SECONDS = 600  # 2x cookie TTL — defeats clock-skew late replay
NONCE_KEY_FMT = "device_approval_grant_nonce:{nonce}"
SSO_ASSERTION_NONCE_KEY_FMT = "sso_assertion_nonce:{nonce}"


@dataclass(frozen=True, slots=True)
class ApprovalGrantClaims:
    subject_email: str
    subject_issuer: str
    user_code: str
    nonce: str
    csrf_token: str
    expires_at: datetime


_EMAIL_FIELD = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")


class _ApprovalGrantClaimsPayload(BaseModel):
    subject_email: str = _EMAIL_FIELD
    subject_issuer: str = Field(min_length=1, max_length=255)
    user_code: str = Field(min_length=1, max_length=32)
    nonce: str = Field(min_length=1, max_length=128)
    csrf_token: str = Field(min_length=1, max_length=128)


def mint_approval_grant(
    *,
    keyset: jws.KeySet,
    iss: str,
    subject_email: str,
    subject_issuer: str,
    user_code: str,
) -> tuple[str, ApprovalGrantClaims]:
    """Use ``approval_grant_cookie_kwargs`` to set the cookie — single
    source of truth for Path/HttpOnly/Secure/SameSite.
    """
    now = datetime.now(UTC)
    exp = now + timedelta(seconds=APPROVAL_GRANT_COOKIE_TTL_SECONDS)
    nonce = _random_opaque()
    csrf_token = _random_opaque()

    payload = {
        "iss": iss,
        "subject_email": subject_email,
        "subject_issuer": subject_issuer,
        "user_code": user_code,
        "nonce": nonce,
        "csrf_token": csrf_token,
    }
    token = jws.sign(keyset, payload, aud=jws.AUD_APPROVAL_GRANT, ttl_seconds=APPROVAL_GRANT_COOKIE_TTL_SECONDS)

    return token, ApprovalGrantClaims(
        subject_email=subject_email,
        subject_issuer=subject_issuer,
        user_code=user_code,
        nonce=nonce,
        csrf_token=csrf_token,
        expires_at=exp,
    )


def verify_approval_grant(keyset: jws.KeySet, token: str) -> ApprovalGrantClaims:
    """Sig + aud + exp only — nonce consumption is the caller's job."""
    raw = jws.verify(keyset, token, expected_aud=jws.AUD_APPROVAL_GRANT)
    try:
        parsed = _ApprovalGrantClaimsPayload.model_validate(raw)
    except ValidationError as e:
        raise jws.VerifyError(f"claim shape invalid: {e}") from e

    return ApprovalGrantClaims(
        subject_email=parsed.subject_email,
        subject_issuer=parsed.subject_issuer,
        user_code=parsed.user_code,
        nonce=parsed.nonce,
        csrf_token=parsed.csrf_token,
        expires_at=datetime.fromtimestamp(raw["exp"], tz=UTC),
    )


def consume_sso_assertion_nonce(redis_client, nonce: str) -> bool:
    if not nonce:
        return False
    return bool(
        redis_client.set(
            SSO_ASSERTION_NONCE_KEY_FMT.format(nonce=nonce),
            "1",
            nx=True,
            ex=NONCE_TTL_SECONDS,
        )
    )


def approval_grant_cookie_kwargs(value: str) -> dict:
    """``secure`` follows is_secure() so HTTP-only deployments don't
    silently drop the cookie.
    """
    return {
        "key": APPROVAL_GRANT_COOKIE_NAME,
        "value": value,
        "max_age": APPROVAL_GRANT_COOKIE_TTL_SECONDS,
        "path": APPROVAL_GRANT_COOKIE_PATH,
        "secure": is_secure(),
        "httponly": True,
        "samesite": "Lax",
    }


def approval_grant_cleared_cookie_kwargs() -> dict:
    return {
        "key": APPROVAL_GRANT_COOKIE_NAME,
        "value": "",
        "max_age": 0,
        "path": APPROVAL_GRANT_COOKIE_PATH,
        "secure": is_secure(),
        "httponly": True,
        "samesite": "Lax",
    }


def _random_opaque() -> str:
    return secrets.token_urlsafe(16)


# ============================================================================
# Anti-framing headers
# ============================================================================


_ANTI_FRAMING_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
}


def attach_anti_framing(bp: Blueprint) -> None:
    """X-Frame-Options + CSP on every response from ``bp`` (CI invariant #4)."""

    @bp.after_request
    def _apply_headers(response):  # pyright: ignore[reportUnusedFunction]
        for name, value in _ANTI_FRAMING_HEADERS.items():
            response.headers.setdefault(name, value)
        return response
