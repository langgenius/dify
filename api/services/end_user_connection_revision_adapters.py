"""Resolve authorization requirements and live tenant plugin artifacts."""

from collections.abc import Mapping
from typing import Any, Protocol

from constants.end_user_connections import OAuthClientSource
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import (
    ConnectionContractSnapshot,
    ConnectionProviderMetadata,
    ConnectionRevisionAcceptance,
    ConnectionRevisionSnapshots,
    ProviderContractSnapshot,
)
from services.workflow.tool_credentials import get_tool_authorization_requirements


class PluginIdentifiers(Protocol):
    def provider_metadata(self, tenant_id: str, provider: str) -> ConnectionProviderMetadata: ...

    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str: ...

    def is_plugin_trusted(self, tenant_id: str, identifier: str) -> bool: ...


class PluginConnectionRevisions:
    def __init__(self, *, providers: PluginIdentifiers, snapshots: ConnectionRevisionSnapshots) -> None:
        self._providers = providers
        self._snapshots = snapshots

    def _snapshot(
        self, tenant_id: str, app_id: str, graph: Mapping[str, Any]
    ) -> tuple[ConnectionContractSnapshot, tuple[ConnectionProviderMetadata, ...]]:
        requirements = get_tool_authorization_requirements(graph)
        providers: dict[str, set[OAuthClientSource]] = {}
        for item in requirements:
            sources = providers.setdefault(item.provider, set())
            if "oauth2" in item.allowed_credential_types and item.oauth_client_type is not None:
                sources.add(
                    OAuthClientSource.WORKSPACE if item.oauth_client_type == "custom" else OAuthClientSource.PLATFORM
                )
        metadata = tuple(self._providers.provider_metadata(tenant_id, provider) for provider in sorted(providers))
        snapshot = ConnectionContractSnapshot(
            tenant_id=tenant_id,
            app_id=app_id,
            providers=tuple(
                ProviderContractSnapshot(
                    provider=item.provider,
                    plugin_unique_identifier=item.plugin_unique_identifier,
                    oauth_clients=tuple(
                        self._snapshots.oauth_client_snapshot(tenant_id, item.provider, source)
                        for source in sorted(providers[item.provider])
                    ),
                )
                for item in metadata
            ),
            requirements=tuple(requirements),
        )
        return snapshot, metadata

    def resolve(
        self, tenant_id: str, app_id: str, graph: Mapping[str, Any]
    ) -> tuple[str, tuple[ConnectionProviderMetadata, ...]]:
        snapshot, metadata = self._snapshot(tenant_id, app_id, graph)
        return self._snapshots.save_revision(snapshot), metadata

    def require(self, tenant_id: str, app_id: str, graph: Mapping[str, Any], revision: str) -> str:
        previous = self._snapshots.get_revision(tenant_id, app_id, revision)
        if previous is None:
            raise ConnectionRevisionChangedError()
        current, _ = self._snapshot(tenant_id, app_id, graph)
        canonical = self._snapshots.save_revision(current)
        if revision == canonical:
            return canonical
        if self._compatible(tenant_id, previous, current):
            return canonical
        raise ConnectionRevisionChangedError(current_revision=canonical)

    def requires_reauthorization(
        self, tenant_id: str, app_id: str, graph: Mapping[str, Any], accepted: tuple[ConnectionContractSnapshot, ...]
    ) -> bool:
        current, _ = self._snapshot(tenant_id, app_id, graph)
        if not current.requirements:
            return False
        return not any(
            previous.tenant_id == tenant_id
            and previous.app_id == app_id
            and self._compatible(tenant_id, previous, current)
            for previous in accepted
        )

    def _compatible(
        self, tenant_id: str, previous: ConnectionContractSnapshot, current: ConnectionContractSnapshot
    ) -> bool:
        old_providers = {item.provider: item for item in previous.providers}
        new_providers = {item.provider: item for item in current.providers}
        # Compare normalized requirements independently of plugin artifacts.
        requirements_unchanged = previous.requirements == current.requirements
        return (
            requirements_unchanged
            and old_providers.keys() == new_providers.keys()
            and all(
                item.oauth_clients == old_providers[provider].oauth_clients
                and (
                    item.plugin_unique_identifier == old_providers[provider].plugin_unique_identifier
                    or self._providers.is_plugin_trusted(tenant_id, item.plugin_unique_identifier)
                )
                for provider, item in new_providers.items()
            )
        )


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

    def _current(
        self, context: WebConnectionContext, provider: str, sources: set[OAuthClientSource]
    ) -> ProviderContractSnapshot:
        return ProviderContractSnapshot(
            provider=provider,
            plugin_unique_identifier=self._providers.plugin_unique_identifier(context.tenant_id, provider),
            oauth_clients=tuple(
                self._snapshots.oauth_client_snapshot(context.tenant_id, provider, source) for source in sorted(sources)
            ),
        )

    def resolve(
        self, context: WebConnectionContext, provider: str, *, oauth_client_source: OAuthClientSource | None = None
    ) -> str:
        sources = {oauth_client_source} if oauth_client_source is not None else set()
        return self._snapshots.save_revision(self._snapshot(context, self._current(context, provider, sources)))

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

    def require(
        self,
        context: WebConnectionContext,
        provider: str,
        revision: str,
        *,
        oauth_client_source: OAuthClientSource | None = None,
    ) -> ProviderContractSnapshot:
        previous = self._reference(context, provider, revision)
        sources = {client.source for client in previous.oauth_clients}
        # A plugin-only API-key revision cannot approve an OAuth Client.
        if oauth_client_source is not None:
            sources.add(oauth_client_source)
        current = self._current(context, provider, sources)
        if previous.oauth_clients == current.oauth_clients and (
            previous.plugin_unique_identifier == current.plugin_unique_identifier
            or self._providers.is_plugin_trusted(context.tenant_id, current.plugin_unique_identifier)
        ):
            return current
        current_snapshot = self._snapshot(context, current)
        raise ConnectionRevisionChangedError(
            current_revision=self._snapshots.save_revision(current_snapshot),
        )
