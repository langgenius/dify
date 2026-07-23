import pytest

from services.feature_service import FeatureService


@pytest.mark.parametrize("enabled", [False, True])
def test_get_system_features_reads_enable_change_email(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENABLE_CHANGE_EMAIL", enabled)

    result = FeatureService.get_system_features()

    assert result.enable_change_email is enabled


def test_enterprise_disables_change_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENABLE_CHANGE_EMAIL", True)
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", True)
    monkeypatch.setattr("services.feature_service.FeatureService._fulfill_params_from_enterprise", lambda *_: None)

    result = FeatureService.get_system_features()

    assert result.enable_change_email is False
