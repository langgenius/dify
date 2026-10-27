"""Client authentication for the OAuth protocol endpoints (RFC 6749 §2.3)."""

from libs.rate_limit import LIMIT_CLIENT_AUTH_FAILURE, is_limited, record_hit
from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode


def _failure_key(client_id: str, source_ip: str) -> str:
    return f"client:{client_id}:ip:{source_ip}"


def authenticate_client(
    registry: OAuthClientRegistry, *, client_id: str | None, client_secret: str | None, source_ip: str
) -> ResolvedClient:
    """Count only wrong secrets for a known client, per client and source IP.

    Keying by IP keeps a caller from locking a public ``client_id`` for everyone.
    An unknown client has no secret to guess, so it is never counted.
    """
    if not client_id:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    client = registry.resolve(client_id)
    if client is None:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    key = _failure_key(client_id, source_ip)
    if is_limited(LIMIT_CLIENT_AUTH_FAILURE, key=key):
        raise TokenEndpointError(TokenErrorCode.TEMPORARILY_UNAVAILABLE)
    if not registry.verify_secret(client, client_secret):
        record_hit(LIMIT_CLIENT_AUTH_FAILURE, key=key)
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    return client
