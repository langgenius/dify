from core.agent.strategy.plugin import PluginAgentStrategy
from core.plugin.manager.agent import PluginAgentManager


def get_plugin_agent_strategy(
    tenant_id: str, agent_strategy_provider_name: str, agent_strategy_name: str
) -> PluginAgentStrategy:
    # TODO: use contexts to cache the agent provider
    manager = PluginAgentManager()
    agent_provider = manager.fetch_agent_strategy_provider(tenant_id, agent_strategy_provider_name)
    for agent_strategy in agent_provider.declaration.strategies:
        if agent_strategy.identity.name == agent_strategy_name:
            return PluginAgentStrategy(tenant_id, agent_strategy)

    raise ValueError(f"Agent strategy {agent_strategy_name} not found")
