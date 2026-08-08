import pytest

from services.feature_service import FeatureService


def test_workspace_creation_uses_environment_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", False)
    monkeypatch.setattr("services.feature_service.dify_config.ALLOW_CREATE_WORKSPACE", True)
    monkeypatch.setattr(
        "services.feature_service.EnterpriseService.get_info",
        lambda: (_ for _ in ()).throw(AssertionError("enterprise API should not be called")),
    )

    assert FeatureService.is_workspace_creation_allowed() is True


def test_workspace_creation_uses_enterprise_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", True)
    monkeypatch.setattr(
        "services.feature_service.EnterpriseService.get_info",
        lambda: {"IsAllowCreateWorkspace": False},
    )

    assert FeatureService.is_workspace_creation_allowed() is False


def test_workspace_creation_keeps_environment_policy_when_enterprise_value_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", True)
    monkeypatch.setattr("services.feature_service.dify_config.ALLOW_CREATE_WORKSPACE", True)
    monkeypatch.setattr("services.feature_service.EnterpriseService.get_info", lambda: {})

    assert FeatureService.is_workspace_creation_allowed() is True


def test_plugin_manager_is_enabled_only_for_enterprise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", True)
    assert FeatureService.is_plugin_manager_enabled() is True

    monkeypatch.setattr("services.feature_service.dify_config.ENTERPRISE_ENABLED", False)
    assert FeatureService.is_plugin_manager_enabled() is False
