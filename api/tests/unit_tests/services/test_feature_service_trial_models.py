from collections.abc import Callable

from enums import HostedTrialProvider
from services.feature_service import FeatureService


def test_get_system_features_excludes_trial_models():
    result = FeatureService.get_system_features().model_dump()

    assert "trial_models" not in result


def test_get_trial_models_returns_providers_enabled_for_paid_and_trial(
    config_overrides: Callable[..., None],
):
    values: dict[str, bool] = {}
    for provider in HostedTrialProvider:
        values[f"HOSTED_{provider.config_key}_PAID_ENABLED"] = False
        values[f"HOSTED_{provider.config_key}_TRIAL_ENABLED"] = False

    values.update(
        HOSTED_OPENAI_PAID_ENABLED=True,
        HOSTED_OPENAI_TRIAL_ENABLED=True,
        HOSTED_ANTHROPIC_PAID_ENABLED=True,
        HOSTED_ANTHROPIC_TRIAL_ENABLED=False,
        HOSTED_GEMINI_PAID_ENABLED=False,
        HOSTED_GEMINI_TRIAL_ENABLED=True,
    )
    config_overrides(**values)

    result = FeatureService.get_trial_models()

    assert result == [HostedTrialProvider.OPENAI.value]
