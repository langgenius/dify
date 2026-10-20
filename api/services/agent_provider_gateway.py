"""Plugin-runtime adapter for Console Agent provider discovery."""

from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.exc import PluginDaemonClientSideError
from services.agent_provider_service import AgentProviderUnavailableError


class PluginAgentProviderGateway:
    def list_providers(self, tenant_id: str) -> list[PluginAgentProviderEntity]:
        return PluginAgentClient().fetch_agent_strategy_providers(tenant_id)

    def get_provider(self, tenant_id: str, provider_name: str) -> PluginAgentProviderEntity:
        try:
            return PluginAgentClient().fetch_agent_strategy_provider(tenant_id, provider_name)
        except PluginDaemonClientSideError as error:
            raise AgentProviderUnavailableError(str(error)) from error
