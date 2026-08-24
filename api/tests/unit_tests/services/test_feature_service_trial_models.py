from unittest.mock import Mock

import pytest

from enums import CloudPlan, DeploymentEdition, HostedTrialProvider
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


def test_get_trial_models_returns_providers_with_paid_or_trial_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    for provider in HostedTrialProvider:
        monkeypatch.setattr(
            feature_service_module.dify_config,
            f"HOSTED_{provider.config_key}_PAID_ENABLED",
            False,
            raising=False,
        )
        monkeypatch.setattr(
            feature_service_module.dify_config,
            f"HOSTED_{provider.config_key}_TRIAL_ENABLED",
            False,
            raising=False,
        )

    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_OPENAI_PAID_ENABLED", True, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_OPENAI_TRIAL_ENABLED", True, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_XAI_PAID_ENABLED", True, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY)

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
    plan: CloudPlan,
    expected: list[str],
) -> None:
    for provider in HostedTrialProvider:
        monkeypatch.setattr(
            feature_service_module.dify_config,
            f"HOSTED_{provider.config_key}_PAID_ENABLED",
            False,
            raising=False,
        )
        monkeypatch.setattr(
            feature_service_module.dify_config,
            f"HOSTED_{provider.config_key}_TRIAL_ENABLED",
            False,
            raising=False,
        )

    monkeypatch.setattr(feature_service_module.dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_OPENAI_TRIAL_ENABLED", True, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_XAI_PAID_ENABLED", True, raising=False)
    get_workspace_plan = Mock(return_value=plan)
    monkeypatch.setattr(feature_service_module.FeatureService, "get_workspace_plan", get_workspace_plan)

    result = FeatureService.get_trial_models("tenant_1")

    assert result == expected
    get_workspace_plan.assert_called_once_with("tenant_1")
