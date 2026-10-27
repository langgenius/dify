from collections.abc import Callable
from dataclasses import dataclass
from typing import cast
from unittest.mock import Mock, patch

import pytest

from enums import CloudPlan, DeploymentEdition, HostedTrialProvider
from services import feature_service as feature_service_module
from services.account_education_service import EDUCATION_EDITIONS
from services.billing_service import BillingInfo
from services.entities.feature_entities import FeatureModel, LimitationModel
from services.feature_service import FeatureService
from services.system_feature_service import SystemFeatureService


def test_education_feature_is_disabled_by_default() -> None:
    assert FeatureModel().education.enabled is False


@pytest.mark.parametrize("edition", list(DeploymentEdition))
def test_education_is_advertised_only_where_its_endpoints_exist(
    config_overrides: Callable[..., None], edition: DeploymentEdition
) -> None:
    """The frontend gates its /account/education* calls on this flag, and the admission
    decorator answers 404 on every edition outside EDUCATION_EDITIONS."""
    config_overrides(DEPLOYMENT_EDITION=edition, EDUCATION_ENABLED=True)

    with patch("services.feature_service.EnterpriseService.get_workspace_info", return_value={}):
        features = FeatureService.get_features("")

    assert features.education.enabled is (edition in EDUCATION_EDITIONS)


def test_education_stays_disabled_on_cloud_without_the_env_flag(
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, EDUCATION_ENABLED=False)

    features = FeatureService.get_features("")

    assert features.education.enabled is False


@dataclass(frozen=True)
class HumanInputEmailDeliveryCase:
    name: str
    deployment_edition: DeploymentEdition
    tenant_id: str | None
    plan: CloudPlan
    expected: bool


CASES = [
    HumanInputEmailDeliveryCase(
        name="enterprise_edition",
        deployment_edition=DeploymentEdition.ENTERPRISE,
        tenant_id=None,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="community_edition",
        deployment_edition=DeploymentEdition.COMMUNITY,
        tenant_id=None,
        plan=CloudPlan.SANDBOX,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="cloud_edition_requires_tenant",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id=None,
        plan=CloudPlan.PROFESSIONAL,
        expected=False,
    ),
    HumanInputEmailDeliveryCase(
        name="professional_plan",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        plan=CloudPlan.PROFESSIONAL,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="team_plan",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        plan=CloudPlan.TEAM,
        expected=True,
    ),
    HumanInputEmailDeliveryCase(
        name="sandbox_plan",
        deployment_edition=DeploymentEdition.CLOUD,
        tenant_id="tenant-1",
        plan=CloudPlan.SANDBOX,
        expected=False,
    ),
]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.name)
def test_resolve_human_input_email_delivery_enabled_matrix(
    config_overrides: Callable[..., None],
    case: HumanInputEmailDeliveryCase,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=case.deployment_edition)
    features = FeatureModel()
    features.billing.subscription.plan = case.plan

    result = FeatureService._resolve_human_input_email_delivery_enabled(
        features=features,
        tenant_id=case.tenant_id,
    )

    assert result is case.expected


def test_get_vector_space_converts_billing_float_size(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_vector_space",
        lambda _tenant_id: {"size": 5120.75, "limit": 20480},
    )

    result = FeatureService.get_vector_space("tenant-1")

    assert result.size == 5120
    assert result.limit == 20480
    assert result.usage_unknown is False


def test_get_vector_space_preserves_unknown_usage(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_vector_space",
        lambda _tenant_id: {"size": 0.0, "limit": 50, "usage_unknown": True},
    )

    result = FeatureService.get_vector_space("tenant-1")

    assert result.size == 0
    assert result.limit == 50
    assert result.usage_unknown is True


@pytest.mark.parametrize(
    ("deployment_edition", "tenant_id", "plan", "expected"),
    [
        (DeploymentEdition.COMMUNITY, "tenant-1", CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.ENTERPRISE, "tenant-1", CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.CLOUD, None, CloudPlan.PROFESSIONAL, 15),
        (DeploymentEdition.CLOUD, "tenant-1", CloudPlan.SANDBOX, 15),
        (DeploymentEdition.CLOUD, "tenant-1", CloudPlan.PROFESSIONAL, 50),
        (DeploymentEdition.CLOUD, "tenant-1", CloudPlan.TEAM, 50),
    ],
)
def test_get_knowledge_file_size_limit(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    deployment_edition: DeploymentEdition,
    tenant_id: str | None,
    plan: CloudPlan,
    expected: int,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=deployment_edition,
        UPLOAD_FILE_SIZE_LIMIT=15,
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN=50,
    )
    get_info = Mock(
        return_value={
            "subscription": {"plan": plan},
        }
    )
    monkeypatch.setattr(feature_service_module.BillingService, "get_info", get_info)

    assert FeatureService.get_knowledge_file_size_limit(tenant_id) == expected

    if deployment_edition == DeploymentEdition.CLOUD and tenant_id:
        get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)
    else:
        get_info.assert_not_called()


def test_paid_knowledge_file_size_limit_never_reduces_default(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        UPLOAD_FILE_SIZE_LIMIT=100,
        KNOWLEDGE_UPLOAD_FILE_SIZE_LIMIT_FOR_PAID_PLAN=50,
    )
    monkeypatch.setattr(
        feature_service_module.BillingService,
        "get_info",
        lambda *_args, **_kwargs: {
            "subscription": {"plan": CloudPlan.PROFESSIONAL},
        },
    )

    assert FeatureService.get_knowledge_file_size_limit("tenant-1") == 100


@pytest.mark.parametrize(
    ("edition", "plan", "expected"),
    [
        (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, True),
        (DeploymentEdition.ENTERPRISE, CloudPlan.SANDBOX, True),
        (DeploymentEdition.CLOUD, CloudPlan.SANDBOX, False),
        (DeploymentEdition.CLOUD, CloudPlan.PROFESSIONAL, True),
    ],
)
def test_site_import_entitlement(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    edition: DeploymentEdition,
    plan: CloudPlan,
    expected: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    get_plan = Mock(return_value=plan)
    monkeypatch.setattr(FeatureService, "get_workspace_plan", get_plan)

    assert FeatureService.can_import_premium_site_settings("tenant-1") is expected
    assert get_plan.call_count == (1 if edition == DeploymentEdition.CLOUD else 0)


def test_skill_feature_is_disabled_by_default() -> None:
    assert FeatureModel().enable_skill is True


def test_skill_feature_follows_env_config(config_overrides: Callable[..., None]) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_SKILL=True)

    features = FeatureService.get_features("")

    assert features.enable_skill is True


def test_get_public_system_features_excludes_trial_models() -> None:
    result = SystemFeatureService.get_public_system_features().model_dump()

    assert "trial_models" not in result


def test_get_trial_models_returns_providers_with_paid_or_trial_enabled(
    config_overrides: Callable[..., None],
) -> None:
    values: dict[str, object] = {}
    for provider in HostedTrialProvider:
        values[f"HOSTED_{provider.config_key}_PAID_ENABLED"] = False
        values[f"HOSTED_{provider.config_key}_TRIAL_ENABLED"] = False

    values.update(
        HOSTED_OPENAI_PAID_ENABLED=True,
        HOSTED_OPENAI_TRIAL_ENABLED=True,
        HOSTED_XAI_PAID_ENABLED=True,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
    )
    config_overrides(**values)

    result = FeatureService.get_trial_models("tenant_1")

    assert result == [
        HostedTrialProvider.OPENAI.value,
        HostedTrialProvider.X.value,
    ]


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        (CloudPlan.SANDBOX, [HostedTrialProvider.OPENAI.value]),
        (CloudPlan.PROFESSIONAL, [HostedTrialProvider.OPENAI.value, HostedTrialProvider.X.value]),
    ],
)
def test_get_trial_models_filters_providers_by_workspace_plan(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    plan: CloudPlan,
    expected: list[str],
) -> None:
    values: dict[str, object] = {}
    for provider in HostedTrialProvider:
        values[f"HOSTED_{provider.config_key}_PAID_ENABLED"] = False
        values[f"HOSTED_{provider.config_key}_TRIAL_ENABLED"] = False
    values.update(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        HOSTED_OPENAI_TRIAL_ENABLED=True,
        HOSTED_XAI_PAID_ENABLED=True,
    )
    config_overrides(**values)
    get_workspace_plan = Mock(return_value=plan)
    monkeypatch.setattr(feature_service_module.FeatureService, "get_workspace_plan", get_workspace_plan)

    result = FeatureService.get_trial_models("tenant_1")

    assert result == expected
    get_workspace_plan.assert_called_once_with("tenant_1")


def test_get_features_exclude_vector_space_sets_vector_space_to_none(config_overrides: Callable[..., None]) -> None:
    tenant_id = "tenant-id"
    billing_info = {
        "subscription": {"plan": CloudPlan.PROFESSIONAL, "interval": "monthly", "education": False},
        "members": {"size": 1, "limit": 10},
        "apps": {"size": 2, "limit": 20},
        "documents_upload_quota": {"size": 3, "limit": 100},
        "annotation_quota_limit": {"size": 4, "limit": 50},
        "can_replace_logo": True,
        "model_load_balancing_enabled": True,
        "knowledge_pipeline_publish_enabled": True,
    }

    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.CLOUD,
        CAN_REPLACE_LOGO=False,
        MODEL_LB_ENABLED=False,
        EDUCATION_ENABLED=False,
    )
    with (
        patch("services.feature_service.BillingService.get_info", return_value=billing_info) as get_info,
        patch("services.feature_service.BillingService.get_quota_info", return_value={}),
    ):
        features = FeatureService.get_features(tenant_id, exclude_vector_space=True)

    assert features.vector_space is None
    get_info.assert_called_once_with(tenant_id, exclude_vector_space=True)


def test_full_features_keep_treating_unknown_vector_usage_as_zero() -> None:
    vector_space = LimitationModel()

    FeatureService._fulfill_vector_space_from_billing_info(
        vector_space,
        cast(BillingInfo, {"vector_space": {"size": 0.0, "limit": 50, "usage_unknown": True}}),
    )

    assert vector_space.size == 0
    assert vector_space.limit == 50
