"""Console access to installed Agent strategy providers."""

from typing import Protocol

from core.plugin.entities.plugin_daemon import PluginAgentProviderEntity
from machinery.context import RequestContext


class AgentProviderUnavailableError(Exception):
    """The plugin runtime rejected a provider lookup."""


class AgentProviderGateway(Protocol):
    def list_providers(self, tenant_id: str) -> list[PluginAgentProviderEntity]: ...

    def get_provider(self, tenant_id: str, provider_name: str) -> PluginAgentProviderEntity: ...


class AgentProviderService:
    def __init__(self, *, providers: AgentProviderGateway) -> None:
        self._providers = providers

    def list_providers(self, context: RequestContext) -> list[PluginAgentProviderEntity]:
        return self._providers.list_providers(context.active_workspace_id)

    def get_provider(self, context: RequestContext, provider_name: str) -> PluginAgentProviderEntity:
        return self._providers.get_provider(context.active_workspace_id, provider_name)
