from dataclasses import dataclass, field

import pytest

from enums import DeploymentEdition
from enums.model_billing import ModelBillingSource, TenantTokenerIntegrationStatus
from services.entities.model_billing import StoredModelBillingProfile
from services.model_billing_profile_service import (
    InvalidModelBillingProfileError,
    ModelBillingProfileResolutionError,
    ModelBillingProfileService,
)


@dataclass
class ProfileQuery:
    value: StoredModelBillingProfile | None
    fail: bool = False
    tenants: list[str] = field(default_factory=list)

    def get(self, tenant_id: str) -> StoredModelBillingProfile | None:
        self.tenants.append(tenant_id)
        if self.fail:
            raise RuntimeError("private database diagnostic")
        return self.value


@pytest.mark.parametrize("stored", [None, StoredModelBillingProfile(None, None)])
def test_missing_or_null_profile_keeps_grandfathered_legacy(stored: StoredModelBillingProfile | None) -> None:
    query = ProfileQuery(stored)
    result = ModelBillingProfileService(profiles=query).resolve("owned-tenant")
    assert result.model_billing_source == ModelBillingSource.LEGACY_MESSAGE_CREDITS
    assert result.uses_legacy_message_credits
    assert query.tenants == ["owned-tenant"]


@pytest.mark.parametrize("status", list(TenantTokenerIntegrationStatus))
def test_explicit_native_profile_never_reopens_legacy_for_pending_or_failed_status(
    status: TenantTokenerIntegrationStatus,
) -> None:
    result = ModelBillingProfileService(profiles=ProfileQuery(StoredModelBillingProfile("tokener", status))).resolve(
        "t"
    )
    assert result.uses_tokener
    assert not result.uses_legacy_message_credits
    assert result.tokener_bootstrap_status == status


def test_unavailable_or_unknown_profile_fails_closed_without_private_details() -> None:
    with pytest.raises(ModelBillingProfileResolutionError, match="^model_billing_profile_unavailable$"):
        ModelBillingProfileService(profiles=ProfileQuery(None, fail=True)).resolve("t")
    with pytest.raises(InvalidModelBillingProfileError, match="^model_billing_profile_invalid$"):
        ModelBillingProfileService(profiles=ProfileQuery(StoredModelBillingProfile("future", None))).resolve("t")


@pytest.mark.parametrize("edition", [DeploymentEdition.COMMUNITY, DeploymentEdition.ENTERPRISE])
def test_non_cloud_features_keep_legacy_without_a_profile_database_dependency(
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
) -> None:
    from extensions.application_services import model_billing
    from services.feature_service import FeatureService
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=edition, TOKENER_NEW_TENANT_COHORT_ENABLED=True)

    def forbidden() -> ModelBillingProfileService:
        raise AssertionError("non-Cloud legacy hot path must not create a profile DB reader")

    monkeypatch.setattr(model_billing, "build_model_billing_profiles", forbidden)
    assert FeatureService.get_model_billing_resolution("legacy-tenant").uses_legacy_message_credits


@pytest.mark.parametrize("tenant_id", [None, ""])
def test_tenantless_cloud_defaults_do_not_read_profiles_or_billing(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str | None,
) -> None:
    from extensions.application_services import model_billing
    from services.billing_service import BillingService
    from services.feature_service import FeatureService
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(
        monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, TOKENER_NEW_TENANT_COHORT_ENABLED=True
    )

    def forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("tenant-less feature defaults must not access a profile or Billing")

    monkeypatch.setattr(model_billing, "build_model_billing_profiles", forbidden)
    monkeypatch.setattr(BillingService, "get_info", forbidden)
    assert FeatureService.get_model_billing_resolution(tenant_id).uses_legacy_message_credits
    features = FeatureService.get_features(tenant_id or "")
    assert features.model_billing_source == "legacy_message_credits"
    assert features.tokener_bootstrap_status is None
    assert features.members.limit == 1
    assert features.apps.limit == 10


@pytest.mark.parametrize("admission", [False, True])
def test_real_cloud_scope_still_fails_closed_when_profile_store_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    admission: bool,
) -> None:
    from extensions.application_services import model_billing
    from services.feature_service import FeatureService
    from tests.helpers.unit.config_override import apply_config_overrides

    apply_config_overrides(
        monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, TOKENER_NEW_TENANT_COHORT_ENABLED=admission
    )
    service = ModelBillingProfileService(profiles=ProfileQuery(None, fail=True))
    monkeypatch.setattr(model_billing, "build_model_billing_profiles", lambda: service)
    with pytest.raises(ModelBillingProfileResolutionError, match="model_billing_profile_unavailable"):
        FeatureService.get_model_billing_resolution("real-tenant-scope")
