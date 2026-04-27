"""Device-flow security primitives: enterprise_only gate, approval-grant
cookie mint/verify/consume, and anti-framing headers.
"""
from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Callable

from flask import Blueprint
from werkzeug.exceptions import NotFound

from libs import jws
from libs.token import is_secure
from services.feature_service import FeatureService, LicenseStatus

logger = logging.getLogger(__name__)


# ============================================================================
# enterprise_only decorator
# ============================================================================


# Fail-closed: any non-EE-active status (default NONE on CE, plus INACTIVE / EXPIRED / LOST)
# is denied. Future LicenseStatus values default to denial unless explicitly admitted.
_EE_ENABLED_STATUSES = {LicenseStatus.ACTIVE, LicenseStatus.EXPIRING}


def enterprise_only[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """404 on CE, passthrough on EE. Apply before rate-limit so CE
    responses don't consume the bucket.
    """

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs):
        settings = FeatureService.get_system_features()
        if settings.license.status not in _EE_ENABLED_STATUSES:
            raise NotFound()
        return view(*args, **kwargs)

    return decorated


# ============================================================================
# approval_grant cookie
# ============================================================================


APPROVAL_GRANT_COOKIE_NAME = "device_approval_grant"
APPROVAL_GRANT_COOKIE_PATH = "/v1/oauth/device"
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
    data = jws.verify(keyset, token, expected_aud=jws.AUD_APPROVAL_GRANT)
    return ApprovalGrantClaims(
        subject_email=data["subject_email"],
        subject_issuer=data["subject_issuer"],
        user_code=data["user_code"],
        nonce=data["nonce"],
        csrf_token=data["csrf_token"],
        expires_at=datetime.fromtimestamp(data["exp"], tz=UTC),
    )


def consume_approval_grant_nonce(redis_client, nonce: str) -> bool:
    if not nonce:
        return False
    return bool(
        redis_client.set(
            NONCE_KEY_FMT.format(nonce=nonce), "1", nx=True, ex=NONCE_TTL_SECONDS,
        )
    )


def consume_sso_assertion_nonce(redis_client, nonce: str) -> bool:
    if not nonce:
        return False
    return bool(
        redis_client.set(
            SSO_ASSERTION_NONCE_KEY_FMT.format(nonce=nonce), "1", nx=True, ex=NONCE_TTL_SECONDS,
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
    def _apply_headers(response):
        for name, value in _ANTI_FRAMING_HEADERS.items():
            response.headers.setdefault(name, value)
        return response
