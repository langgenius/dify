"""Ports and provider registry for rendered Email delivery."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.human_input_v2.channel_identity import ChannelProvider, ChannelRef
from core.human_input_v2.shared import TenantId

from .contracts import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcome,
    PreparedRenderedEmailDelivery,
    ResolvedEmailChannelSnapshot,
)


class EmailProviderConfigurationSnapshotResolver(Protocol):
    def resolve(
        self,
        tenant_id: TenantId,
        channel: ChannelRef,
        *,
        expected: ConfigurationSnapshotIdentity | None = None,
    ) -> ResolvedEmailChannelSnapshot: ...


class EmailProviderAdapter(Protocol):
    provider: ChannelProvider

    def send(self, prepared: PreparedRenderedEmailDelivery) -> DeliveryOutcome: ...


class DuplicateEmailProviderAdapterError(ValueError):
    """More than one adapter was registered for the same provider."""


class EmailProviderAdapterRegistry:
    def __init__(self, adapters: Sequence[EmailProviderAdapter] = ()) -> None:
        self._adapters: dict[ChannelProvider, EmailProviderAdapter] = {}
        for adapter in adapters:
            self.register(adapter)

    def register(self, adapter: EmailProviderAdapter) -> None:
        if adapter.provider in self._adapters:
            raise DuplicateEmailProviderAdapterError(adapter.provider.value)
        self._adapters[adapter.provider] = adapter

    def get(self, provider: ChannelProvider) -> EmailProviderAdapter:
        try:
            return self._adapters[provider]
        except KeyError as error:
            raise LookupError(f"email provider adapter is not registered: {provider.value}") from error
