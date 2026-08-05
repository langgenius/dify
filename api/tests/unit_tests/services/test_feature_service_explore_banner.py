import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService


@pytest.mark.parametrize(
    ("edition", "enterprise_enabled", "configured", "expected"),
    [
        ("CLOUD", False, True, True),
        ("CLOUD", False, False, False),
        ("SELF_HOSTED", False, True, False),
        ("SELF_HOSTED", True, True, False),
    ],
)
def test_get_system_features_enables_explore_banner_only_for_cloud(
    monkeypatch: pytest.MonkeyPatch,
    edition: str,
    enterprise_enabled: bool,
    configured: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr(feature_service_module.dify_config, "EDITION", edition)
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", enterprise_enabled)
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_EXPLORE_BANNER", configured)
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_enterprise", lambda *_: None)

    result = FeatureService.get_system_features()

    assert FeatureService.is_explore_banner_enabled() is expected
    assert result.enable_explore_banner is expected
