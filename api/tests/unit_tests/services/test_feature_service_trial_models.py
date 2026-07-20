import pytest

from enums.hosted_provider import HostedTrialProvider
from services import feature_service as feature_service_module
from services.feature_service import FeatureService


def test_get_system_features_excludes_trial_models():
    result = FeatureService.get_system_features().model_dump()

    assert "trial_models" not in result


def test_get_trial_models_returns_providers_enabled_for_paid_and_trial(monkeypatch: pytest.MonkeyPatch):
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
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_ANTHROPIC_PAID_ENABLED", True, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_ANTHROPIC_TRIAL_ENABLED", False, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_GEMINI_PAID_ENABLED", False, raising=False)
    monkeypatch.setattr(feature_service_module.dify_config, "HOSTED_GEMINI_TRIAL_ENABLED", True, raising=False)

    result = FeatureService.get_trial_models()

    assert result == [HostedTrialProvider.OPENAI.value]
