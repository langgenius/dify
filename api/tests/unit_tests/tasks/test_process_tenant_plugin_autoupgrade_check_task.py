"""Tests for the plugin auto-upgrade task's decode + download fallback logic.

Covers the fix in process_tenant_plugin_autoupgrade_check_task that ensures
the .difypkg file exists on disk before calling upgrade_plugin(). If the
package file is missing (e.g. PVC recreation), the task should re-download
it from the marketplace.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from core.plugin.entities.plugin import PluginInstallationSource
from models.account import TenantPluginAutoUpgradeStrategy


@pytest.fixture
def manager_mock():
    """Create a mock PluginInstaller."""
    m = MagicMock()
    m.upgrade_plugin.return_value = MagicMock()
    return m


@pytest.fixture
def make_plugin():
    """Factory for mock plugin entities."""

    def factory(plugin_id: str, version: str, uid: str, source=PluginInstallationSource.Marketplace):
        p = MagicMock()
        p.plugin_id = plugin_id
        p.version = version
        p.plugin_unique_identifier = uid
        p.source = source
        return p

    return factory


@pytest.fixture
def cache_manifests():
    """Seed Redis cache with marketplace manifest data."""

    def seed(redis_mock, manifests: list[dict]):
        """Each dict: {org, name, latest_version, latest_package_identifier}"""
        from core.plugin.entities.marketplace import MarketplacePluginSnapshot

        def get_side_effect(key: str):
            for m in manifests:
                plugin_id = f"{m['org']}/{m['name']}"
                if key.endswith(plugin_id):
                    snap = MarketplacePluginSnapshot(
                        org=m["org"],
                        name=m["name"],
                        latest_version=m["latest_version"],
                        latest_package_identifier=m["latest_package_identifier"],
                        latest_package_url=m.get("latest_package_url", "https://example.com/pkg"),
                    )
                    return json.dumps(snap.model_dump())
            return None

        redis_mock.get.side_effect = get_side_effect

    return seed


class TestAutoUpgradeDecodeCheck:
    """Tests for the decode_plugin_from_identifier fallback in the upgrade loop."""

    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.download_plugin_pkg")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.redis_client")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.PluginInstaller")
    def test_skips_download_when_pkg_exists(
        self, mock_installer_cls, mock_redis, mock_download, manager_mock, make_plugin, cache_manifests
    ):
        """When decode_plugin_from_identifier succeeds, no download should happen."""
        mock_installer_cls.return_value = manager_mock
        manager_mock.list_plugins.return_value = [make_plugin("org/p1", "1.0.0", "p1:1.0.0@old")]
        manager_mock.decode_plugin_from_identifier.return_value = MagicMock()  # pkg exists

        cache_manifests(
            mock_redis,
            [{"org": "org", "name": "p1", "latest_version": "2.0.0", "latest_package_identifier": "p1:2.0.0@new"}],
        )

        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            process_tenant_plugin_autoupgrade_check_task,
        )

        process_tenant_plugin_autoupgrade_check_task(
            tenant_id="t1",
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )

        manager_mock.decode_plugin_from_identifier.assert_called_once_with("t1", "p1:2.0.0@new")
        mock_download.assert_not_called()
        manager_mock.upgrade_plugin.assert_called_once()

    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.download_plugin_pkg")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.redis_client")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.PluginInstaller")
    def test_downloads_when_pkg_missing(
        self, mock_installer_cls, mock_redis, mock_download, manager_mock, make_plugin, cache_manifests
    ):
        """When decode_plugin_from_identifier fails, should download and upload pkg before upgrading."""
        mock_installer_cls.return_value = manager_mock
        manager_mock.list_plugins.return_value = [make_plugin("org/p1", "1.0.0", "p1:1.0.0@old")]
        manager_mock.decode_plugin_from_identifier.side_effect = RuntimeError("package not found")
        mock_download.return_value = b"pkg-bytes"
        upload_resp = MagicMock()
        manager_mock.upload_pkg.return_value = upload_resp

        cache_manifests(
            mock_redis,
            [{"org": "org", "name": "p1", "latest_version": "2.0.0", "latest_package_identifier": "p1:2.0.0@new"}],
        )

        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            process_tenant_plugin_autoupgrade_check_task,
        )

        process_tenant_plugin_autoupgrade_check_task(
            tenant_id="t1",
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )

        mock_download.assert_called_once_with("p1:2.0.0@new")
        manager_mock.upload_pkg.assert_called_once_with("t1", b"pkg-bytes", verify_signature=False)
        manager_mock.upgrade_plugin.assert_called_once()

    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.download_plugin_pkg")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.redis_client")
    @patch("tasks.process_tenant_plugin_autoupgrade_check_task.PluginInstaller")
    def test_no_upgrade_when_version_matches(
        self, mock_installer_cls, mock_redis, mock_download, manager_mock, make_plugin, cache_manifests
    ):
        """When plugin is already at latest version, no upgrade should be attempted."""
        mock_installer_cls.return_value = manager_mock
        manager_mock.list_plugins.return_value = [make_plugin("org/p1", "2.0.0", "p1:2.0.0@cur")]

        cache_manifests(
            mock_redis,
            [{"org": "org", "name": "p1", "latest_version": "2.0.0", "latest_package_identifier": "p1:2.0.0@cur"}],
        )

        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            process_tenant_plugin_autoupgrade_check_task,
        )

        process_tenant_plugin_autoupgrade_check_task(
            tenant_id="t1",
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
            upgrade_time_of_day=0,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
            exclude_plugins=[],
            include_plugins=[],
        )

        manager_mock.decode_plugin_from_identifier.assert_not_called()
        mock_download.assert_not_called()
        manager_mock.upgrade_plugin.assert_not_called()
