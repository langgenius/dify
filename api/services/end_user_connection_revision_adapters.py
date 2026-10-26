"""Resolve live plugin artifacts for the published EndUser authorization contract."""

from collections.abc import Mapping
from typing import Any, Protocol

from services.end_user_connections.revision import connection_revision
from services.workflow.tool_credentials import get_tool_connection_requirements


class PluginIdentifiers(Protocol):
    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str: ...


class PluginConnectionRevisions:
    def __init__(self, *, providers: PluginIdentifiers) -> None:
        self._providers = providers

    def resolve(self, tenant_id: str, workflow_id: str, graph: Mapping[str, Any]) -> str:
        providers = {item.provider for item in get_tool_connection_requirements(graph)}
        return connection_revision(
            workflow_id,
            (self._providers.plugin_unique_identifier(tenant_id, provider) for provider in sorted(providers)),
        )
