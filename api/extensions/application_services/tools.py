"""Compose tool metadata, management, and provider-scoped credential resolution."""

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.db.session_factory import get_session_maker
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.plugin_tool.provider import PluginToolProviderController
from extensions.ext_redis import redis_client
from models.provider_ids import ToolProviderID
from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.credentials.query_repository import CredentialQueryRepository
from repositories.tools.provider_repository import ToolProviderRepository
from repositories.tools.workflow_repository import WorkflowToolRepository
from services.credentials.redis_refresh_lock import RedisCredentialRefreshLock
from services.credentials.tool_runtime import ToolCredentialService
from services.credentials.tool_runtime_adapters import ProviderToolCredentialRuntime
from services.plugin.dispatch_identity import PluginOAuthClientConfig
from services.tools.builtin.credentials import resolve_oauth_client
from services.tools.provider_queries import ToolProviders
from services.tools.tool_manager import ToolManager
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


@dataclass(frozen=True)
class ToolServices:
    workflow_queries: WorkflowToolQueries
    tool_providers: ToolProviders
    workflows: WorkflowToolManageService


def build_tool_services(database_client: sessionmaker[Session]) -> ToolServices:
    repository = WorkflowToolRepository(database_client)
    return ToolServices(
        workflow_queries=repository,
        tool_providers=ToolProviderRepository(database_client),
        workflows=WorkflowToolManageService(repository),
    )


def resolve_tool_credentials(
    *, controller: BuiltinToolProviderController, provider_id: str, workspace_id: str, credential_id: str | None
) -> tuple[Mapping[str, object], CredentialType]:
    if isinstance(controller, PluginToolProviderController):
        provider = ToolProviderID(provider_id)
        providers = (str(provider), provider.provider_name)
    else:
        providers = (provider_id,)
    session_maker = get_session_maker()
    tool_providers = ToolProviderRepository(session_maker)
    runtime = ProviderToolCredentialRuntime(
        controller=controller,
        provider_id=provider_id,
        console_api_url=dify_config.CONSOLE_API_URL,
        oauth_client_resolver=lambda tenant_id: resolve_tool_oauth_client(
            providers=tool_providers,
            controller=controller,
            provider_id=provider_id,
            workspace_id=tenant_id,
        ),
    )
    service = ToolCredentialService(
        credentials=CredentialQueryRepository(session_factory=session_maker),
        runtime=runtime,
        refresh_lock=RedisCredentialRefreshLock(client=redis_client),
        providers=providers,
    )
    return runtime.resolve(service=service, workspace_id=workspace_id, credential_id=credential_id)


def resolve_tool_oauth_client(
    *,
    providers: ToolProviders,
    controller: BuiltinToolProviderController,
    provider_id: str,
    workspace_id: str,
) -> PluginOAuthClientConfig | None:
    plugin_controller = (
        controller
        if isinstance(controller, PluginToolProviderController)
        else ToolManager.get_plugin_provider(provider_id, workspace_id)
    )
    return resolve_oauth_client(
        providers=providers,
        controller=plugin_controller,
        tenant_id=workspace_id,
        provider_id=provider_id,
    )
