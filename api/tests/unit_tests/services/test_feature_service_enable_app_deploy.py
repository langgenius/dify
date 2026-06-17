import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService, SystemFeatureModel


@pytest.mark.parametrize(
    ("enterprise_info", "initial", "expected"),
    [
        # Enterprise reports the feature on -> mirrored through.
        ({"EnableAppDeploy": True}, False, True),
        # Enterprise may turn it off; the read runs after the hardcoded default
        # and overrides it (forward-compat with a future entitlement gate).
        ({"EnableAppDeploy": False}, True, False),
        # Old enterprise without the key -> the existing value is left untouched.
        ({}, True, True),
    ],
    ids=["enabled", "override_off", "missing_keeps_default"],
)
def test_fulfill_params_from_enterprise_enable_app_deploy(
    monkeypatch: pytest.MonkeyPatch,
    enterprise_info: dict,
    initial: bool,
    expected: bool,
):
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: enterprise_info),
    )

    features = SystemFeatureModel()
    features.enable_app_deploy = initial

    FeatureService._fulfill_params_from_enterprise(features)

    assert features.enable_app_deploy is expected
