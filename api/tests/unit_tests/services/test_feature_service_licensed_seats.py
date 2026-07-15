import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService, SystemFeatureModel

_ENTERPRISE_INFO = {"License": {"licensedSeats": {"enabled": True, "limit": 3, "used": 1}}}


def test_fulfill_params_from_enterprise_parses_licensed_seats(monkeypatch: pytest.MonkeyPatch):
    """Authenticated fill copies the licensed-seat quota out of the enterprise payload."""
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _ENTERPRISE_INFO),
    )

    features = SystemFeatureModel()
    FeatureService._fulfill_params_from_enterprise(features, is_authenticated=True)

    assert features.license.seats.enabled is True
    assert features.license.seats.limit == 3
    assert features.license.seats.size == 1


def test_fulfill_params_from_enterprise_withholds_seats_when_unauthenticated(monkeypatch: pytest.MonkeyPatch):
    """Seat counts are auth-gated: unauthenticated callers keep the zeroed default."""
    monkeypatch.setattr(
        feature_service_module.EnterpriseService,
        "get_info",
        staticmethod(lambda: _ENTERPRISE_INFO),
    )

    features = SystemFeatureModel()
    FeatureService._fulfill_params_from_enterprise(features, is_authenticated=False)

    assert features.license.seats.enabled is False
    assert features.license.seats.limit == 0
    assert features.license.seats.size == 0
