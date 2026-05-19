from __future__ import annotations

from factories.agent_factory import get_plugin_agent_strategy

from .strategy_protocols import AgentStrategyPresentationProvider, AgentStrategyResolver, ResolvedAgentStrategy


class PluginAgentStrategyResolver(AgentStrategyResolver):
    def resolve(
        self,
        *,
        tenant_id: str,
        agent_strategy_provider_name: str,
        agent_strategy_name: str,
    ) -> ResolvedAgentStrategy:
        return get_plugin_agent_strategy(
            tenant_id=tenant_id,
            agent_strategy_provider_name=agent_strategy_provider_name,
            agent_strategy_name=agent_strategy_name,
        )


class PluginAgentStrategyPresentationProvider(AgentStrategyPresentationProvider):
    def get_icon(self, *, tenant_id: str, agent_strategy_provider_name: str) -> str | None:
        from core.plugin.impl.plugin import PluginInstaller

        manager = PluginInstaller()
        try:
            plugins = manager.list_plugins(tenant_id)
        except Exception:
            return None

        try:
            current_plugin = next(
                plugin for plugin in plugins if f"{plugin.plugin_id}/{plugin.name}" == agent_strategy_provider_name
            )
        except StopIteration:
            return None

        return current_plugin.declaration.icon
