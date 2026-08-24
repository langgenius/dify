"""Two-phase rendered Email runtime keeping provider I/O after preparation."""

from __future__ import annotations

from .contracts import (
    ConfigurationSnapshotIdentity,
    DeliveryOutcome,
    PreparedRenderedEmailDelivery,
    RenderedEmailDeliveryRequest,
    fingerprint_rendered_email,
)
from .ports import EmailProviderAdapterRegistry, EmailProviderConfigurationSnapshotResolver


class DeliveryPreparationError(RuntimeError):
    """A safe stable code describing why provider preparation could not continue."""

    code: str

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class HumanInputRenderedEmailDeliveryRuntime:
    def __init__(
        self,
        resolver: EmailProviderConfigurationSnapshotResolver,
        adapters: EmailProviderAdapterRegistry,
    ) -> None:
        self._resolver = resolver
        self._adapters = adapters
        self._runtime_token = object()

    def prepare(
        self,
        request: RenderedEmailDeliveryRequest,
        *,
        expected_snapshot: ConfigurationSnapshotIdentity | None = None,
    ) -> PreparedRenderedEmailDelivery:
        snapshot = self._resolver.resolve(
            request.tenant_id,
            request.provider,
            expected=expected_snapshot,
        )
        if snapshot.provider is not request.provider:
            raise DeliveryPreparationError("provider_configuration_mismatch")
        return PreparedRenderedEmailDelivery(
            request=request,
            snapshot=snapshot,
            payload_fingerprint=fingerprint_rendered_email(request),
            _runtime_token=self._runtime_token,
        )

    def send(self, prepared: PreparedRenderedEmailDelivery) -> DeliveryOutcome:
        if prepared._runtime_token is not self._runtime_token:
            raise ValueError("prepared delivery was not created by this runtime")
        return self._adapters.get(prepared.snapshot.provider).send(prepared)
