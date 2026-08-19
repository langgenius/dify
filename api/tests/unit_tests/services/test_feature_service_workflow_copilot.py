import pytest

from services import feature_service as feature_service_module
from services.feature_service import FeatureService


def test_workflow_copilot_flag_follows_config_true(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "WORKFLOW_COPILOT_ENABLED", True)

    features = FeatureService.get_features("tenant-1")

    assert features.workflow_copilot_enabled is True


def test_workflow_copilot_flag_defaults_false(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(feature_service_module.dify_config, "WORKFLOW_COPILOT_ENABLED", False)

    features = FeatureService.get_features("tenant-1")

    assert features.workflow_copilot_enabled is False
