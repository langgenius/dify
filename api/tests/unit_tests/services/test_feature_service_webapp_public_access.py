import pytest

from services.feature_service import FeatureService, SystemFeatureModel


@pytest.mark.parametrize(
    ("env_value", "expected"),
    [
        (False, False),
        (True, True),
    ],
    ids=["disabled_by_env", "enabled_by_env"],
)
def test_fulfill_system_params_from_env_sets_allow_public_access(
    monkeypatch: pytest.MonkeyPatch,
    env_value: bool,
    expected: bool,
):
    monkeypatch.setattr("services.feature_service.dify_config.WEBAPP_PUBLIC_ACCESS_ENABLED", env_value)

    system_features = SystemFeatureModel()
    FeatureService._fulfill_system_params_from_env(system_features)

    assert system_features.webapp_auth.allow_public_access is expected


def test_get_system_features_defaults_allow_public_access_to_true():
    system_features = FeatureService.get_system_features()

    assert system_features.webapp_auth.allow_public_access is True
