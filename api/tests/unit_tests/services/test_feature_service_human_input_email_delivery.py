from dataclasses import dataclass

import pytest

from enums.cloud_plan import CloudPlan
from services import feature_service as feature_service_module
from services.feature_service import FeatureModel, FeatureService


@dataclass(frozen=True)
class HumanInputEmailDeliveryCase:
    name: str
    enterprise_enabled: bool
    billing_enabled: bool
    tenant_id: str | None
    billing_feature_enabled: bool
    plan: str
    expected: bool


CASES = [
    HumanInputEmailDeliveryCase(
        name="enterprise_enabled",
        enterprise_enabled=True,
        billing_enabled=True,
        tenant_id=None,
        billing_feature_enabled=False,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="billing_disabled",
        enterprise_enabled=False,
        billing_enabled=False,
        tenant_id=None,
        billing_feature_enabled=False,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="billing_enabled_requires_tenant",
        enterprise_enabled=False,
        billing_enabled=True,
        tenant_id=None,
        billing_feature_enabled=True,
        plan=CloudPlan.PROFESSIONAL,
        expected=False,
    ),
    HumanInputEmailDeliveryCase(
        name="billing_feature_off",
        enterprise_enabled=False,
        billing_enabled=True,
        tenant_id="tenant-1",
        billing_feature_enabled=False,
        plan=CloudPlan.PROFESSIONAL,
        expected=False,
    ),
    HumanInputEmailDeliveryCase(
        name="professional_plan",
        enterprise_enabled=False,
        billing_enabled=True,
        tenant_id="tenant-1",
        billing_feature_enabled=True,
        plan=CloudPlan.PROFESSIONAL,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="team_plan",
        enterprise_enabled=False,
        billing_enabled=True,
        tenant_id="tenant-1",
        billing_feature_enabled=True,
        plan=CloudPlan.TEAM,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="sandbox_plan",
        enterprise_enabled=False,
        billing_enabled=True,
        tenant_id="tenant-1",
        billing_feature_enabled=True,
        plan=CloudPlan.SANDBOX,
        expected=False,
    ),
]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_resolve_human_input_email_delivery_enabled_matrix(
    monkeypatch: pytest.MonkeyPatch,
    case: HumanInputEmailDeliveryCase,
):
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", case.enterprise_enabled)
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", case.billing_enabled)
    features = FeatureModel()
    features.billing.enabled = case.billing_feature_enabled
    features.billing.subscription.plan = case.plan

    result = FeatureService._resolve_human_input_email_delivery_enabled(
        features=features,
        tenant_id=case.tenant_id,
    )

    assert result is case.expected
