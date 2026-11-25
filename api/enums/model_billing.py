"""Model billing cohorts shared by application contracts and persistence adapters."""

from enum import StrEnum


class ModelBillingSource(StrEnum):
    LEGACY_MESSAGE_CREDITS = "legacy_message_credits"
    TOKENER = "tokener"


class TenantTokenerIntegrationStatus(StrEnum):
    """Durable non-secret stages of a new-registration bootstrap."""

    PENDING = "pending"
    INSTALLING_PLUGIN = "installing_plugin"
    PROVISIONING = "provisioning"
    CONFIGURING_PROVIDER = "configuring_provider"
    READY = "ready"
    FAILED = "failed"


class TokenerBootstrapStatus(StrEnum):
    """Status of the private Billing bootstrap exchange."""

    PENDING = "pending"
    READY = "ready"


class TokenerEntitlementStatus(StrEnum):
    """Activity reported by the Tokener entitlement metering endpoint."""

    ACTIVE = "active"
    PROCESSING = "processing"
    RETRYING = "retrying"
    FAILED = "failed"
