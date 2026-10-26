"""Resolve authorization requirements and live tenant plugin artifacts."""

from collections.abc import Mapping
from typing import Any, Protocol

from services.end_user_connections.revision import (
    ConnectionContractSnapshot,
    ProviderContractSnapshot,
)
from services.workflow.tool_credentials import get_tool_authorization_requirements


class PluginIdentifiers(Protocol):
    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str: ...


class PluginConnectionRevisions:
    def __init__(self, *, providers: PluginIdentifiers) -> None:
        self._providers = providers

    def snapshot(self, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> ConnectionContractSnapshot:
        requirements = get_tool_authorization_requirements(graph)
        providers = sorted({item.provider for item in requirements})
        return ConnectionContractSnapshot(
            tenant_id=tenant_id,
            app_id=app_id,
            providers=tuple(
                ProviderContractSnapshot(
                    provider=provider,
                    plugin_unique_identifier=self._providers.plugin_unique_identifier(tenant_id, provider),
                )
                for provider in providers
            ),
            requirements=tuple(requirements),
        )

    def resolve(self, tenant_id: str, app_id: str, graph: Mapping[str, Any]) -> str:
        return self.snapshot(tenant_id, app_id, graph).revision
