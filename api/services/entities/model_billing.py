"""Plain native billing-cohort values; no routing or migration state."""

from dataclasses import dataclass

from enums.model_billing import ModelBillingSource, TenantTokenerIntegrationStatus


@dataclass(frozen=True, slots=True)
class StoredModelBillingProfile:
    source: str | None
    bootstrap_status: TenantTokenerIntegrationStatus | None


@dataclass(frozen=True, slots=True)
class TenantModelBillingResolution:
    model_billing_source: ModelBillingSource
    tokener_bootstrap_status: TenantTokenerIntegrationStatus | None = None

    @property
    def uses_legacy_message_credits(self) -> bool:
        return self.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS

    @property
    def uses_tokener(self) -> bool:
        return self.model_billing_source == ModelBillingSource.TOKENER
