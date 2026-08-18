import pytest

from enums import DeploymentEdition
from services import feature_service as feature_service_module
from services.entities.feature_entities import LicenseModel, LicenseStatus
from services.feature_service import FeatureService

_ENTERPRISE_INFO = {"License": {"status": LicenseStatus.EXPIRING, "expiredAt": "2026-12-31"}}


def test_license_model_defaults_license_expiry_notice_disabled() -> None:
    """Without a license there is no expiry to announce, so the notice is off unless enabled explicitly."""
    assert LicenseModel().license_expiry_notice_enabled is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_license_non_enterprise_ignores_expiry_notice_config(
    monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    """Non-enterprise deployments have no license, so the env toggle never turns the notice on."""
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_LICENSE_EXPIRY_NOTICE", enabled)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "DEPLOYMENT_EDITION",
        DeploymentEdition.COMMUNITY,
    )

    result = FeatureService.get_license()

    assert result.license_expiry_notice_enabled is False


@pytest.mark.parametrize("enabled", [True, False])
def test_get_license_enterprise_reads_license_expiry_notice_enabled(
    monkeypatch: pytest.MonkeyPatch, enabled: bool
) -> None:
    """The enterprise-sourced license carries the env-resolved notice flag alongside its real status."""
    monkeypatch.setattr(feature_service_module.dify_config, "ENABLE_LICENSE_EXPIRY_NOTICE", enabled)
    monkeypatch.setattr(
        feature_service_module.dify_config,
        "DEPLOYMENT_EDITION",
        DeploymentEdition.ENTERPRISE,
    )
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _ENTERPRISE_INFO),
    )

    result = FeatureService.get_license()

    assert result.status == LicenseStatus.EXPIRING
    assert result.expired_at == "2026-12-31"
    assert result.license_expiry_notice_enabled is enabled
