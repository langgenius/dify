"""Signing and verification services for the Console session token contracts."""

import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from configs import dify_config
from services.account.console_session import (
    CONSOLE_TOKEN_AUDIENCE,
    access_token_account_id,
    access_token_claims,
    csrf_token_claims,
    valid_refresh_csrf_claims,
)
from services.account_errors import InvalidConsoleAccessTokenError


def issue_console_access_token(account_id: str, session_id: str) -> str:
    return jwt.encode(
        access_token_claims(
            account_id,
            session_id,
            issuer=dify_config.DEPLOYMENT_EDITION.value,
            now=datetime.now(UTC),
            lifetime=timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES),
        ),
        dify_config.SECRET_KEY,
        algorithm="HS256",
    )


def verify_console_access_token(token: str) -> str:
    """Reject tokens issued for other purposes, including legacy Console tokens."""
    try:
        claims = jwt.decode(
            token,
            dify_config.SECRET_KEY,
            algorithms=["HS256"],
            audience=CONSOLE_TOKEN_AUDIENCE,
            issuer=dify_config.DEPLOYMENT_EDITION.value,
            options={"require": ["sub", "sid", "iss", "aud", "iat", "exp", "token_type"]},
        )
    except jwt.PyJWTError as error:
        raise InvalidConsoleAccessTokenError("Invalid or expired Console access token.") from error
    try:
        return access_token_account_id(claims)
    except ValueError as error:
        raise InvalidConsoleAccessTokenError(str(error)) from error


def issue_console_csrf_token(account_id: str) -> str:
    return jwt.encode(
        csrf_token_claims(
            account_id,
            secrets.token_hex(16),
            now=datetime.now(UTC),
            lifetime=timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES),
        ),
        dify_config.SECRET_KEY,
        algorithm="HS256",
    )


def verify_refresh_csrf_proof(csrf_header: str | None, csrf_cookie: str | None, refresh_token: str | None) -> bool:
    if not csrf_header or not csrf_cookie or not hmac.compare_digest(csrf_header.encode(), csrf_cookie.encode()):
        return False
    try:
        # Refresh and logout must still work after the access and CSRF JWTs expire.
        claims = jwt.decode(
            csrf_header,
            dify_config.SECRET_KEY,
            algorithms=["HS256"],
            options={"verify_exp": False, "require": ["sub", "exp", "jti"]},
        )
    except (jwt.PyJWTError, ValueError):
        return False
    return valid_refresh_csrf_claims(claims, refresh_token)
