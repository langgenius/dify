from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.exc import PluginDaemonClientSideError


class AgentService:
    @classmethod
    def list_agent_providers(cls, user_id: str, tenant_id: str) -> list[PluginAgentProviderEntity]:
        """
        List agent providers
        """
        manager = PluginAgentClient()
        return manager.fetch_agent_strategy_providers(tenant_id)

    @classmethod
    def get_agent_provider(cls, user_id: str, tenant_id: str, provider_name: str) -> PluginAgentProviderEntity:
        """
        Get agent provider
        """
        manager = PluginAgentClient()
        try:
            return manager.fetch_agent_strategy_provider(tenant_id, provider_name)
        except PluginDaemonClientSideError as e:
            raise ValueError(str(e)) from e
