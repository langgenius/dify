"""Shared fixtures for services.plugin test suite."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from services.entities.feature_entities import PluginInstallationScope


def make_features(
    restrict_to_marketplace: bool = False,
    scope: PluginInstallationScope = PluginInstallationScope.ALL,
) -> MagicMock:
    """Create a mock plugin installation permission."""
    permission = MagicMock()
    permission.restrict_to_marketplace_only = restrict_to_marketplace
    permission.plugin_installation_scope = scope
    return permission


@pytest.fixture
def mock_installer(monkeypatch: pytest.MonkeyPatch):
    """Patch PluginInstaller at the service import site."""
    mock = MagicMock()
    monkeypatch.setattr("core.plugin.plugin_service.PluginInstaller", lambda: mock)
    return mock


@pytest.fixture
def mock_features():
    """Patch SystemFeatureService to return permissive defaults."""
    from unittest.mock import patch

    features = make_features()
    with patch("core.plugin.plugin_service.SystemFeatureService") as mock_fs:
        mock_fs.get_plugin_installation_permission.return_value = features
        yield features
