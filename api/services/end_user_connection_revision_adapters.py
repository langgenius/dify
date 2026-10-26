"""Resolve authorization requirements and live tenant plugin artifacts."""

import json
from collections.abc import Mapping
from typing import Any, Protocol

import jwt
from pydantic import ValidationError

from configs import dify_config
from services.end_user_connections.entities import WebConnectionContext
from services.end_user_connections.errors import ConnectionRevisionChangedError
from services.end_user_connections.revision import (
    ConnectionContractSnapshot,
    ProviderContractSnapshot,
)
from services.workflow.tool_credentials import get_tool_authorization_requirements


class PluginIdentifiers(Protocol):
    def plugin_unique_identifier(self, tenant_id: str, provider: str) -> str: ...

    def is_plugin_trusted(self, tenant_id: str, identifier: str) -> bool: ...


class ConnectionRevisionCodec:
    """Signed, deterministic snapshots distinguish trusted upgrades from authorization changes."""

    @staticmethod
    def encode(snapshot: ConnectionContractSnapshot) -> str:
        return jwt.encode(
            {"aud": "connection_revision", "version": 1, "snapshot": json.loads(snapshot.canonical_json())},
            dify_config.SECRET_KEY,
            algorithm="HS256",
        )

    @staticmethod
    def decode(revision: str) -> ConnectionContractSnapshot:
        try:
            claims = jwt.decode(revision, dify_config.SECRET_KEY, algorithms=["HS256"], audience="connection_revision")
            if claims.get("version") != 1:
                raise ValueError("Unsupported connection revision.")
            return ConnectionContractSnapshot.model_validate(claims["snapshot"])
        except (jwt.InvalidTokenError, ValidationError, ValueError, KeyError, TypeError):
            raise ConnectionRevisionChangedError() from None


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
        return ConnectionRevisionCodec.encode(self.snapshot(tenant_id, app_id, graph))

    def require(self, tenant_id: str, app_id: str, graph: Mapping[str, Any], revision: str) -> str:
        previous = ConnectionRevisionCodec.decode(revision)
        if previous.tenant_id != tenant_id or previous.app_id != app_id:
            raise ConnectionRevisionChangedError()
        current = self.snapshot(tenant_id, app_id, graph)
        canonical = ConnectionRevisionCodec.encode(current)
        if previous.revision == current.revision:
            return canonical
        old_providers = {item.provider: item.plugin_unique_identifier for item in previous.providers}
        new_providers = {item.provider: item.plugin_unique_identifier for item in current.providers}
        # Compare normalized requirements independently of plugin artifacts.
        requirements_unchanged = (
            previous.model_copy(update={"providers": ()}).revision
            == current.model_copy(update={"providers": ()}).revision
        )
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
        raise ConnectionRevisionChangedError(previous=previous, current=current, current_revision=canonical)


class PluginConnectionProviderRevisions:
    """Admit owned-Connection operations independently of published authorization nodes."""

    def __init__(self, *, providers: PluginIdentifiers) -> None:
        self._providers = providers

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
        return ConnectionRevisionCodec.encode(self._snapshot(context, self._current(context, provider)))

    def reference(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot:
        snapshot = ConnectionRevisionCodec.decode(revision)
        if snapshot.tenant_id != context.tenant_id or snapshot.app_id != context.app_id:
            raise ConnectionRevisionChangedError()
        references = tuple(item for item in snapshot.providers if item.provider == provider)
        if len(references) != 1:
            raise ConnectionRevisionChangedError()
        return references[0]

    def require(self, context: WebConnectionContext, provider: str, revision: str) -> ProviderContractSnapshot:
        previous = self.reference(context, provider, revision)
        current = self._current(context, provider)
        if previous == current or self._providers.is_plugin_trusted(
            context.tenant_id, current.plugin_unique_identifier
        ):
            return current
        current_snapshot = self._snapshot(context, current)
        raise ConnectionRevisionChangedError(
            previous=self._snapshot(context, previous),
            current=current_snapshot,
            current_revision=ConnectionRevisionCodec.encode(current_snapshot),
        )
