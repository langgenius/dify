"""Framework-neutral token contracts for Console sessions."""

import re
from collections.abc import Mapping
from datetime import datetime, timedelta
from uuid import UUID

CONSOLE_TOKEN_AUDIENCE = "dify-console"

_REFRESH_TOKEN_PATTERN = re.compile(
    r"v2\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"
    r"\.([0-9a-f]{32})\.[0-9a-f]{64}"
)


def access_token_claims(
    account_id: str,
    session_id: str,
    *,
    issuer: str,
    now: datetime,
    lifetime: timedelta,
) -> dict[str, str | int]:
    return {
        "user_id": account_id,
        "sub": account_id,
        "sid": session_id,
        "iss": issuer,
        "aud": CONSOLE_TOKEN_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
        "token_type": "console_access",
    }


def access_token_account_id(claims: Mapping[str, object]) -> str:
    account_id = claims.get("sub")
    if (
        not isinstance(account_id, str)
        or not account_id
        or claims.get("user_id") != account_id
        or not isinstance(claims.get("sid"), str)
        or not claims["sid"]
        or claims.get("token_type") != "console_access"
        or claims.get("token_source")
    ):
        raise ValueError("Invalid Console access token.")
    return account_id


def csrf_token_claims(account_id: str, nonce: str, *, now: datetime, lifetime: timedelta) -> dict[str, str | int]:
    return {"exp": int((now + lifetime).timestamp()), "sub": account_id, "jti": nonce}


def parse_refresh_token(refresh_token: str) -> tuple[str, str] | None:
    match = _REFRESH_TOKEN_PATTERN.fullmatch(refresh_token)
    return (match[1], match[2]) if match else None


def build_refresh_token(account_id: str, session_id: str, secret: str) -> str:
    token = f"v2.{account_id}.{session_id}.{secret}"
    if parse_refresh_token(token) is None:
        raise ValueError("Invalid refresh token identity or secret.")
    return token


def valid_refresh_csrf_claims(claims: Mapping[str, object], refresh_token: str | None) -> bool:
    account_id = claims.get("sub")
    if not isinstance(account_id, str):
        return False
    try:
        if str(UUID(account_id)) != account_id:
            return False
    except ValueError:
        return False
    token_id = claims.get("jti")
    if (
        type(claims.get("exp")) is not int
        or not isinstance(token_id, str)
        or re.fullmatch(r"[0-9a-f]{32}", token_id) is None
        or any(claim in claims for claim in ("aud", "token_type", "token_source"))
    ):
        return False
    if refresh_token is None:
        return True
    identity = parse_refresh_token(refresh_token)
    return identity is not None and identity[0] == account_id
