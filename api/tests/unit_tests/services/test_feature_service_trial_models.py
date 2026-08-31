from collections.abc import Callable
from unittest.mock import Mock

import pytest

from enums import CloudPlan, DeploymentEdition, HostedTrialProvider
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


def test_get_system_features_excludes_trial_models():
    result = FeatureService.get_system_features().model_dump()

    assert "trial_models" not in result


def test_get_trial_models_returns_providers_with_paid_or_trial_enabled(
    config_overrides: Callable[..., None],
):
    values: dict[str, bool] = {}
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
