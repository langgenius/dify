"""Shared fixtures for services.plugin test suite."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from services.feature_service import PluginInstallationScope


def make_features(
    restrict_to_marketplace: bool = False,
    scope: PluginInstallationScope = PluginInstallationScope.ALL,
) -> MagicMock:
    """Create a mock FeatureService.get_system_features() result."""
    features = MagicMock()
    features.plugin_installation_permission.restrict_to_marketplace_only = restrict_to_marketplace
    features.plugin_installation_permission.plugin_installation_scope = scope
    return features


@pytest.fixture
def mock_installer(monkeypatch: pytest.MonkeyPatch):
    """Patch PluginInstaller at the service import site."""
    mock = MagicMock()
    monkeypatch.setattr("services.plugin.plugin_service.PluginInstaller", lambda: mock)
    return mock


@pytest.fixture
def mock_features():
    """Patch FeatureService to return permissive defaults."""
    from unittest.mock import patch

    features = make_features()
    with patch("services.plugin.plugin_service.FeatureService") as mock_fs:
        mock_fs.get_system_features.return_value = features
        yield features
