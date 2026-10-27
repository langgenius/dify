"""Resolve authorization requirements and live tenant plugin artifacts."""

from collections.abc import Mapping
from typing import Any, Protocol

from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import (
    ConnectionContractSnapshot,
    ConnectionRevisionAcceptance,
    ConnectionRevisionSnapshots,
    ProviderContractSnapshot,
)
from services.workflow.tool_credentials import get_tool_authorization_requirements


class PluginIdentifiers(Protocol):
    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str: ...

    def is_plugin_trusted(self, tenant_id: str, identifier: str) -> bool: ...


class PluginConnectionRevisions:
    def __init__(self, *, providers: PluginIdentifiers, snapshots: ConnectionRevisionSnapshots) -> None:
        self._providers = providers
        self._snapshots = snapshots

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
        return self._snapshots.save_revision(self.snapshot(tenant_id, app_id, graph))

    def require(self, tenant_id: str, app_id: str, graph: Mapping[str, Any], revision: str) -> str:
        previous = self._snapshots.get_revision(tenant_id, app_id, revision)
        if previous is None:
            raise ConnectionRevisionChangedError()
        current = self.snapshot(tenant_id, app_id, graph)
        canonical = self._snapshots.save_revision(current)
        if revision == canonical:
            return canonical
        old_providers = {item.provider: item.plugin_unique_identifier for item in previous.providers}
        new_providers = {item.provider: item.plugin_unique_identifier for item in current.providers}
        # Compare normalized requirements independently of plugin artifacts.
        requirements_unchanged = previous.requirements == current.requirements
        if (
            requirements_unchanged
            and old_providers.keys() == new_providers.keys()
            and all(
                self._providers.is_plugin_trusted(tenant_id, identifier)
                for provider, identifier in new_providers.items()
                if identifier != old_providers[provider]
            )
        ):
            return canonical
        raise ConnectionRevisionChangedError(current_revision=canonical)


class PluginConnectionProviderRevisions:
    """Admit owned-Connection operations independently of published authorization nodes."""

    def __init__(self, *, providers: PluginIdentifiers, snapshots: ConnectionRevisionSnapshots) -> None:
        self._providers = providers
        self._snapshots = snapshots

    @staticmethod
    def _snapshot(context: WebConnectionContext, provider: ProviderContractSnapshot) -> ConnectionContractSnapshot:
        return ConnectionContractSnapshot(
            tenant_id=context.tenant_id, app_id=context.app_id, providers=(provider,), requirements=()
        )

    def _current(self, context: WebConnectionContext, provider: str) -> ProviderContractSnapshot:
        return ProviderContractSnapshot(
            provider=provider,
            plugin_unique_identifier=self._providers.plugin_unique_identifier(context.tenant_id, provider),
        )

    def resolve(self, context: WebConnectionContext, provider: str) -> str:
        return self._snapshots.save_revision(self._snapshot(context, self._current(context, provider)))

    def _reference(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot:
        snapshot = self._snapshots.get_revision(context.tenant_id, context.app_id, revision)
        if snapshot is None:
            raise ConnectionRevisionChangedError()
        references = tuple(item for item in snapshot.providers if item.provider == provider)
        if len(references) != 1:
            raise ConnectionRevisionChangedError()
        return references[0]

    def acceptance(
        self, context: WebConnectionContext, provider: str, revision: str, admitted: ProviderContractSnapshot
    ) -> ConnectionRevisionAcceptance:
        previous = self._reference(context, provider, revision)
        if admitted.provider != provider:
            raise ConnectionRevisionChangedError()
        # A Provider mutation approves only its projection of an App contract.
        source = self._snapshots.save_revision(self._snapshot(context, previous))
        current = self._snapshots.save_revision(self._snapshot(context, admitted))
        return ConnectionRevisionAcceptance.from_revisions(source, current)

    def require(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot:
        previous = self._reference(context, provider, revision)
        current = self._current(context, provider)
        if previous == current or self._providers.is_plugin_trusted(
            context.tenant_id, current.plugin_unique_identifier
        ):
            return current
        current_snapshot = self._snapshot(context, current)
        raise ConnectionRevisionChangedError(
            current_revision=self._snapshots.save_revision(current_snapshot),
        )
