"""Provider-neutral runtime for already-rendered Human Input notifications."""

from .contracts import (
    ConfigurationSnapshotIdentity,
    DeliveryFailure,
    DeliveryOutcome,
    DeliveryOutcomeStatus,
    DeliveryReceipt,
    PreparedRenderedEmailDelivery,
    ProviderCredential,
    RenderedEmailDeliveryRequest,
    ResolvedEmailChannelSnapshot,
    RetryGuidance,
    derive_idempotency_key,
    fingerprint_rendered_email,
)
from .ports import (
    DuplicateEmailProviderAdapterError,
    EmailProviderAdapter,
    EmailProviderAdapterRegistry,
    EmailProviderConfigurationSnapshotResolver,
)
from .runtime import DeliveryPreparationError, HumanInputRenderedEmailDeliveryRuntime

__all__ = [
    "ConfigurationSnapshotIdentity",
    "DeliveryFailure",
    "DeliveryOutcome",
    "DeliveryOutcomeStatus",
    "DeliveryPreparationError",
    "DeliveryReceipt",
    "DuplicateEmailProviderAdapterError",
    "EmailProviderAdapter",
    "EmailProviderAdapterRegistry",
    "EmailProviderConfigurationSnapshotResolver",
    "HumanInputRenderedEmailDeliveryRuntime",
    "PreparedRenderedEmailDelivery",
    "ProviderCredential",
    "RenderedEmailDeliveryRequest",
    "ResolvedEmailChannelSnapshot",
    "RetryGuidance",
    "derive_idempotency_key",
    "fingerprint_rendered_email",
]
