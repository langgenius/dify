"""Client authentication for the OAuth protocol endpoints (RFC 6749 §2.3)."""

from libs.rate_limit import LIMIT_CLIENT_AUTH_FAILURE, is_limited, record_hit
from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode


def _failure_key(client_id: str) -> str:
    return f"client:{client_id}"


def authenticate_client(
    registry: OAuthClientRegistry, *, client_id: str | None, client_secret: str | None
) -> ResolvedClient:
    """Only failures count toward the limit, so normal logins and polling never reach it."""
    if not client_id:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    key = _failure_key(client_id)
    if is_limited(LIMIT_CLIENT_AUTH_FAILURE, key=key):
        raise TokenEndpointError(TokenErrorCode.TEMPORARILY_UNAVAILABLE)
    client = registry.resolve(client_id)
    if client is None or not registry.verify_secret(client, client_secret):
        record_hit(LIMIT_CLIENT_AUTH_FAILURE, key=key)
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    return client
