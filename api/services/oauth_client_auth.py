"""Client authentication for the OAuth protocol endpoints (RFC 6749 §2.3)."""

from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode


def authenticate_client(
    registry: OAuthClientRegistry, *, client_id: str | None, client_secret: str | None
) -> ResolvedClient:
    """Every client is public, so a request that sends a client secret fails."""
    if not client_id:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    if client_secret is not None:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    client = registry.resolve(client_id)
    if client is None:
        raise TokenEndpointError(TokenErrorCode.INVALID_CLIENT)
    return client
