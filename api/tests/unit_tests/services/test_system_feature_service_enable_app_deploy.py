"""Tests for the SystemFeatureService app-deployment policy."""

import pytest

from enums import DeploymentEdition
from services import system_feature_service as feature_service_module
from services.entities.feature_entities import SystemFeatureModel
from services.system_feature_service import SystemFeatureService


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
    enterprise_info: dict[str, object],
    initial: bool,
    expected: bool,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: enterprise_info),
    )

    features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)
    features.enable_app_deploy = initial

    SystemFeatureService._fulfill_params_from_enterprise(features)

    assert features.enable_app_deploy is expected
