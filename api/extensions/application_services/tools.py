"""Compose provider-scoped tool credential resolution for workflow execution."""

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.plugin_tool.provider import PluginToolProviderController
from extensions.ext_redis import redis_client
from models.provider_ids import ToolProviderID
from repositories.credentials.query_repository import CredentialQueryRepository
from services.credentials.redis_refresh_lock import RedisCredentialRefreshLock
from services.credentials.refresh import CredentialRefreshUnavailableError
from services.credentials.tool_runtime import (
    ToolCredentialNotFoundError,
    ToolCredentialRefreshError,
    ToolCredentialService,
)
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime

__all__ = [
    "CredentialRefreshUnavailableError",
    "ToolCredentialNotFoundError",
    "ToolCredentialRefreshError",
    "build_tool_credential_service",
]


def build_tool_credential_service(
    *, database_client: sessionmaker[Session], controller: BuiltinToolProviderController, provider_id: str
) -> ToolCredentialService:
    if isinstance(controller, PluginToolProviderController):
        provider = ToolProviderID(provider_id)
        providers = (str(provider), provider.provider_name)
    else:
        providers = (provider_id,)
    return ToolCredentialService(
        credentials=CredentialQueryRepository(session_factory=database_client),
        runtime=ProviderToolCredentialRuntime(
            controller=controller, provider_id=provider_id, console_api_url=dify_config.CONSOLE_API_URL
        ),
        refresh_lock=RedisCredentialRefreshLock(client=redis_client),
        providers=providers,
    )
