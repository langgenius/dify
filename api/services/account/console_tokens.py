"""The signed access-token contract for Console sessions."""

from datetime import UTC, datetime, timedelta

import jwt
from werkzeug.exceptions import Unauthorized

from configs import dify_config
from libs.passport import PassportService

CONSOLE_TOKEN_AUDIENCE = "dify-console"


def issue_console_access_token(account_id: str, session_id: str) -> str:
    now = datetime.now(UTC)
    return PassportService().issue(
        {
            "user_id": account_id,
            "sub": account_id,
            "sid": session_id,
            "iss": dify_config.DEPLOYMENT_EDITION.value,
            "aud": CONSOLE_TOKEN_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=dify_config.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
            "token_type": "console_access",
        }
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
        raise Unauthorized("Invalid or expired Console access token.") from error
    account_id = claims["sub"]
    if (
        not isinstance(account_id, str)
        or not account_id
        or claims.get("user_id") != account_id
        or not isinstance(claims["sid"], str)
        or not claims["sid"]
        or claims["token_type"] != "console_access"
        or claims.get("token_source")
    ):
        raise Unauthorized("Invalid Console access token.")
    return account_id
