import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService, LicenseModel, LicenseStatus

_ENTERPRISE_INFO = {"License": {"licensedSeats": {"enabled": True, "limit": 3, "used": 1}}}


def test_get_license_parses_licensed_seats(monkeypatch: pytest.MonkeyPatch):
    """The authenticated license accessor copies the licensed-seat quota out of the enterprise payload."""
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", True)
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _ENTERPRISE_INFO),
    )

    license_model = FeatureService.get_license()

    assert isinstance(license_model, LicenseModel)
    assert license_model.seats.enabled is True
    assert license_model.seats.limit == 3
    assert license_model.seats.size == 1


def test_get_license_non_enterprise_is_unconstrained(monkeypatch: pytest.MonkeyPatch):
    """Non-enterprise deployments have no license; seat allocation is unconstrained."""
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", False)

    license_model = FeatureService.get_license()

    assert license_model.status == LicenseStatus.NONE
    assert license_model.seats.enabled is False
    assert license_model.seats.is_available() is True
