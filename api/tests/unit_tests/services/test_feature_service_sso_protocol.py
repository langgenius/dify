import logging

import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import SSOProtocol, SystemFeatureModel
from services.feature_service import FeatureService


def test_system_features_exposes_valid_enterprise_sso_protocols(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": "saml",
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": "oidc",
            }
        ),
    )
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.ENTERPRISE)

    FeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is SSOProtocol.SAML
    assert features.webapp_auth.sso_config.protocol is SSOProtocol.OIDC


@pytest.mark.parametrize("empty_protocol", [None, "", "   "])
def test_system_features_normalizes_empty_enterprise_sso_protocols_to_none(
    monkeypatch: pytest.MonkeyPatch,
    empty_protocol: object,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": empty_protocol,
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": empty_protocol,
            }
        ),
    )
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.ENTERPRISE)

    FeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None


@pytest.mark.parametrize("invalid_protocol", ["unknown", 42])
def test_system_features_rejects_invalid_enterprise_sso_protocols(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    invalid_protocol: object,
) -> None:
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(
            lambda: {
                "SSOEnforcedForSigninProtocol": invalid_protocol,
                "WebAppAuth": {},
                "SSOEnforcedForWebProtocol": invalid_protocol,
            }
        ),
    )
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.ENTERPRISE)

    with caplog.at_level(logging.ERROR, logger="services.feature_service"):
        FeatureService._fulfill_params_from_enterprise(features)

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None
    assert caplog.text.count("Invalid Enterprise SSO protocol") == 2


def test_system_features_defaults_sso_protocols_to_none() -> None:
    features = SystemFeatureModel(deployment_edition=DeploymentEdition.COMMUNITY)

    assert features.sso_enforced_for_signin_protocol is None
    assert features.webapp_auth.sso_config.protocol is None
