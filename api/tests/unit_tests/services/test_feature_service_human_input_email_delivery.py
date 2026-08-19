from dataclasses import dataclass

import pytest

from enums import CloudPlan, DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import FeatureModel
from services.feature_service import FeatureService


@dataclass(frozen=True)
class HumanInputEmailDeliveryCase:
    name: str
    deployment_edition: DeploymentEdition
    tenant_id: str | None
    billing_feature_enabled: bool
    plan: str
    expected: bool


CASES = [
    HumanInputEmailDeliveryCase(
        name="enterprise_edition",
        deployment_edition=DeploymentEdition.ENTERPRISE,
        tenant_id=None,
        billing_feature_enabled=False,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="community_edition",
        deployment_edition=DeploymentEdition.COMMUNITY,
        tenant_id=None,
        billing_feature_enabled=False,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="cloud_edition_requires_tenant",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id=None,
        billing_feature_enabled=True,
        plan=CloudPlan.PROFESSIONAL,
        expected=False,
    ),
    HumanInputEmailDeliveryCase(
        name="billing_feature_off",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        billing_feature_enabled=False,
        plan=CloudPlan.PROFESSIONAL,
        expected=False,
    ),
    HumanInputEmailDeliveryCase(
        name="professional_plan",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        billing_feature_enabled=True,
        plan=CloudPlan.PROFESSIONAL,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="team_plan",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        billing_feature_enabled=True,
        plan=CloudPlan.TEAM,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="sandbox_plan",
        deployment_edition=DeploymentEdition.CLOUD,
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
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", case.deployment_edition)
    features = FeatureModel()
    features.billing.enabled = case.billing_feature_enabled
    features.billing.subscription.plan = case.plan

    result = FeatureService._resolve_human_input_email_delivery_enabled(
        features=features,
        tenant_id=case.tenant_id,
    )

    assert result is case.expected


def test_get_vector_space_converts_billing_float_size(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_vector_space",
        lambda tenant_id: {"size": 5120.75, "limit": 20480},
    )

    result = FeatureService.get_vector_space("tenant-1")

    assert result.size == 5120
    assert result.limit == 20480
    assert result.usage_unknown is False


def test_get_vector_space_preserves_unknown_usage(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_vector_space",
        lambda tenant_id: {"size": 0.0, "limit": 50, "usage_unknown": True},
    )

    result = FeatureService.get_vector_space("tenant-1")

    assert result.size == 0
    assert result.limit == 50
    assert result.usage_unknown is True
