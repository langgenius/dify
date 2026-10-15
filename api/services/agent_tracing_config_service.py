"""Agent-scoped tracing configuration, backed by the existing App tracing owners.

Only roster Agent Apps own third-party credentials. Workflow-only Agents inherit
their caller's tracing policy and must not create a hidden configuration owner.
"""

from typing import Any, Protocol

from machinery.context import RequestContext
from services.app_tracing_config_service import AppTracingConfigRecord, AppTracingConfigService
from services.entities.app_entities import AppTraceSettings


class AgentTracingOwner(Protocol):
    def resolve_roster_app_id(self, *, tenant_id: str, agent_id: str) -> str: ...


class AppTracingSettings(Protocol):
    def get_trace(self, context: RequestContext, app_id: str) -> AppTraceSettings: ...

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None: ...


class AgentTracingConfigService:
    def __init__(
        self, *, owners: AgentTracingOwner, settings: AppTracingSettings, configs: AppTracingConfigService
    ) -> None:
        self._owners = owners
        self._settings = settings
        self._configs = configs

    def resolve_app_id(self, context: RequestContext, agent_id: str) -> str:
        """Resolve the roster Agent's tenant-scoped App without creating runtime state."""
        return self._owners.resolve_roster_app_id(tenant_id=context.active_workspace_id, agent_id=agent_id)

    def get_trace(self, context: RequestContext, agent_id: str) -> AppTraceSettings:
        return self._settings.get_trace(context, self.resolve_app_id(context, agent_id))

    def set_trace(self, context: RequestContext, agent_id: str, settings: AppTraceSettings) -> None:
        self._settings.set_trace(context, self.resolve_app_id(context, agent_id), settings)

    def get(self, context: RequestContext, agent_id: str, tracing_provider: str) -> AppTracingConfigRecord | None:
        return self._configs.get(context, self.resolve_app_id(context, agent_id), tracing_provider)

    def create(
        self, context: RequestContext, agent_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None:
        self._configs.create(context, self.resolve_app_id(context, agent_id), tracing_provider, tracing_config)

    def update(
        self, context: RequestContext, agent_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None:
        self._configs.update(context, self.resolve_app_id(context, agent_id), tracing_provider, tracing_config)

    def delete(self, context: RequestContext, agent_id: str, tracing_provider: str) -> None:
        self._configs.delete(context, self.resolve_app_id(context, agent_id), tracing_provider)
