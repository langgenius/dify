"""Read the immutable signup cohort without falling open on storage failure.

Missing/NULL profiles retain legacy behavior. Only an explicit stored Tokener
profile enables native Tokener. Unknown data or an unavailable store is a safe
failure, never an instruction to initialize or bill legacy credits.
"""

from typing import Protocol

from enums.model_billing import ModelBillingSource
from services.entities.model_billing import StoredModelBillingProfile, TenantModelBillingResolution


class ModelBillingProfileResolutionError(RuntimeError):
    """A secret-free failure; transport consumers choose the HTTP mapping."""


class InvalidModelBillingProfileError(ModelBillingProfileResolutionError):
    pass


class ModelBillingProfileQuery(Protocol):
    def get(self, tenant_id: str) -> StoredModelBillingProfile | None:
        """Return only this tenant's detached profile/status; own and close the read session."""
        ...


class ModelBillingProfileService:
    def __init__(self, *, profiles: ModelBillingProfileQuery) -> None:
        self._profiles = profiles

    def resolve(self, tenant_id: str) -> TenantModelBillingResolution:
        """Resolve a persisted cohort without mutation or a default-on fallback.

        Preconditions: the caller supplies its authenticated/internal tenant ID.
        Postconditions: a missing/NULL row is legacy; explicit Tokener retains
        its durable setup status. Failed/unknown reads raise safe exceptions.
        """
        try:
            profile = self._profiles.get(tenant_id)
        except Exception:
            raise ModelBillingProfileResolutionError("model_billing_profile_unavailable") from None
        if profile is None or profile.source is None:
            return TenantModelBillingResolution(ModelBillingSource.LEGACY_MESSAGE_CREDITS)
        if profile.source == ModelBillingSource.TOKENER:
            return TenantModelBillingResolution(ModelBillingSource.TOKENER, profile.bootstrap_status)
        raise InvalidModelBillingProfileError("model_billing_profile_invalid")
