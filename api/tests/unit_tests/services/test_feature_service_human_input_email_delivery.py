from unittest.mock import MagicMock

import pytest

from enums.cloud_plan import CloudPlan
from services import feature_service as feature_service_module
from services.feature_service import FeatureModel, FeatureService


def _make_features(plan: str) -> FeatureModel:
    features = FeatureModel()
    features.billing.enabled = True
    features.billing.subscription.plan = plan
    return features


def test_human_input_email_delivery_available_for_enterprise(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", True)
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", True)
    mock_fulfill = MagicMock()
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_billing_api", mock_fulfill)
    mock_workspace = MagicMock()
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_workspace_info", mock_workspace)

    features = FeatureService.get_features("tenant-1")

    assert features.human_input_email_delivery_enabled is True
    mock_fulfill.assert_called_once()


def test_human_input_email_delivery_available_when_billing_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", False)
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", False)

    features = FeatureService.get_features("tenant-1")

    assert features.human_input_email_delivery_enabled is True


def test_human_input_email_delivery_requires_tenant_id_when_billing_enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", False)
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", True)
    mock_fulfill = MagicMock()
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_billing_api", mock_fulfill)

    features = FeatureService.get_features("")

    assert features.human_input_email_delivery_enabled is False
    mock_fulfill.assert_not_called()


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        (CloudPlan.PROFESSIONAL, True),
        (CloudPlan.SANDBOX, False),
        (CloudPlan.TEAM, False),
    ],
)
def test_human_input_email_delivery_checks_plan(monkeypatch: pytest.MonkeyPatch, plan: str, expected: bool):
    monkeypatch.setattr(feature_service_module.dify_config, "ENTERPRISE_ENABLED", False)
    monkeypatch.setattr(feature_service_module.dify_config, "BILLING_ENABLED", True)
    features = _make_features(plan)
    mock_fulfill = MagicMock()

    def _apply_fulfill(target: FeatureModel, _tenant_id: str) -> None:
        target.billing.enabled = features.billing.enabled
        target.billing.subscription.plan = features.billing.subscription.plan

    mock_fulfill.side_effect = _apply_fulfill
    monkeypatch.setattr(FeatureService, "_fulfill_params_from_billing_api", mock_fulfill)

    result = FeatureService.get_features("tenant-1")

    assert result.human_input_email_delivery_enabled is expected
    mock_fulfill.assert_called_once()
