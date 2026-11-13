"""Compose provider-scoped tool credential resolution for workflow execution."""

from collections.abc import Mapping

from configs import dify_config
from core.db.session_factory import get_session_maker
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.plugin_tool.provider import PluginToolProviderController
from extensions.ext_redis import redis_client
from models.provider_ids import ToolProviderID
from repositories.credentials.query_repository import CredentialQueryRepository
from services.credentials.redis_refresh_lock import RedisCredentialRefreshLock
from services.credentials.tool_runtime import ToolCredentialService
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime


def resolve_tool_credentials(
    *, controller: BuiltinToolProviderController, provider_id: str, workspace_id: str, credential_id: str | None
) -> tuple[Mapping[str, object], CredentialType]:
    if isinstance(controller, PluginToolProviderController):
        provider = ToolProviderID(provider_id)
        providers = (str(provider), provider.provider_name)
    else:
        providers = (provider_id,)
    runtime = ProviderToolCredentialRuntime(
        controller=controller, provider_id=provider_id, console_api_url=dify_config.CONSOLE_API_URL
    )
    service = ToolCredentialService(
        credentials=CredentialQueryRepository(session_factory=get_session_maker()),
        runtime=runtime,
        refresh_lock=RedisCredentialRefreshLock(client=redis_client),
        providers=providers,
    )
    return runtime.resolve(service=service, workspace_id=workspace_id, credential_id=credential_id)
