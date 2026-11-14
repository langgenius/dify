"""Compose MCP connection resolution and serialized reactive token refresh."""

from core.db.session_factory import get_session_maker
from extensions.ext_redis import redis_client
from repositories.credentials.query_repository import CredentialQueryRepository
from services.credentials.mcp_runtime import MCPCredentialService, mcp_credential_digest
from services.credentials.mcp_runtime_adapters import MCPProviderCredentialRuntime
from services.credentials.redis_refresh_lock import RedisCredentialRefreshLock

__all__ = ["mcp_credential_digest", "mcp_credential_service"]


def mcp_credential_service() -> MCPCredentialService:
    """Construct the shared MCP refresh boundary with short DB sessions and Redis leases."""
    return MCPCredentialService(
        credentials=CredentialQueryRepository(session_factory=get_session_maker()),
        runtime=MCPProviderCredentialRuntime(),
        refresh_lock=RedisCredentialRefreshLock(client=redis_client),
    )
