from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from core.plugin.entities.marketplace import MarketplacePluginSnapshot
from core.plugin.entities.plugin import PluginInstallationSource
from models.account import TenantPluginAutoUpgradeStrategy

MODULE = "tasks.process_tenant_plugin_autoupgrade_check_task"


def _make_plugin(plugin_id: str, version: str, source=PluginInstallationSource.Marketplace):
    """Build a minimal stand-in for a PluginInstallation entry returned by manager.list_plugins."""
    return SimpleNamespace(
        plugin_id=plugin_id,
        version=version,
        plugin_unique_identifier=f"{plugin_id}:{version}@deadbeef",
        source=source,
    )


def _make_manifest(plugin_id: str, latest_version: str) -> MarketplacePluginSnapshot:
    org, name = plugin_id.split("/", 1)
    return MarketplacePluginSnapshot(
        org=org,
        name=name,
        latest_version=latest_version,
        latest_package_identifier=f"{plugin_id}:{latest_version}@cafe1234",
        latest_package_url=f"https://marketplace.example/{plugin_id}/{latest_version}.difypkg",
    )


def _run_task(
    *,
    plugins: list,
    manifests: list[MarketplacePluginSnapshot],
    strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
    upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
    exclude_plugins=None,
    include_plugins=None,
):
    """
    Execute the celery task synchronously with mocks for the plugin manager,
    the marketplace cache and PluginService.upgrade_plugin_with_marketplace.
    Returns the upgrade-call recorder so each test can assert on it.
    """
    fake_manager = MagicMock()
    fake_manager.list_plugins.return_value = plugins

    upgrade_calls: list[tuple[str, str, str]] = []

    def _record_upgrade(tenant_id, original, new):
        upgrade_calls.append((tenant_id, original, new))

    with (
        patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
        patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=manifests),
        patch(
            f"{MODULE}.PluginService.upgrade_plugin_with_marketplace",
            side_effect=_record_upgrade,
        ) as upgrade_mock,
    ):
        from tasks.process_tenant_plugin_autoupgrade_check_task import (
            process_tenant_plugin_autoupgrade_check_task,
        )

        process_tenant_plugin_autoupgrade_check_task(
            "tenant-1",
            strategy_setting,
            0,
            upgrade_mode,
            exclude_plugins or [],
            include_plugins or [],
        )

    return upgrade_mock, upgrade_calls


class TestUpgradeCallsMarketplaceService:
    """
    Regression test for the bug where the auto-upgrade task called
    manager.upgrade_plugin directly, which skipped downloading the new package
    from marketplace and uploading it to the daemon. The daemon then failed with
    "package file not found" and the upgrade silently never completed.
    """

    def test_upgrade_routes_through_plugin_service(self):
        plugin = _make_plugin("acme/foo", "1.0.0")
        manifest = _make_manifest("acme/foo", "1.0.1")

        upgrade_mock, calls = _run_task(plugins=[plugin], manifests=[manifest])

        upgrade_mock.assert_called_once()
        assert calls == [("tenant-1", plugin.plugin_unique_identifier, manifest.latest_package_identifier)]

    def test_does_not_call_manager_upgrade_plugin_directly(self):
        """Locks in that we never go back to the broken path that bypassed download/upload."""
        plugin = _make_plugin("acme/foo", "1.0.0")
        manifest = _make_manifest("acme/foo", "1.0.1")

        fake_manager = MagicMock()
        fake_manager.list_plugins.return_value = [plugin]

        with (
            patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
            patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=[manifest]),
            patch(f"{MODULE}.PluginService.upgrade_plugin_with_marketplace"),
        ):
            from tasks.process_tenant_plugin_autoupgrade_check_task import (
                process_tenant_plugin_autoupgrade_check_task,
            )

            process_tenant_plugin_autoupgrade_check_task(
                "tenant-1",
                TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
                0,
                TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
                [],
                [],
            )

        fake_manager.upgrade_plugin.assert_not_called()


class TestStrategySetting:
    def test_disabled_strategy_skips_everything(self):
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.1")],
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.DISABLED,
        )
        upgrade_mock.assert_not_called()

    def test_fix_only_upgrades_patch_version(self):
        upgrade_mock, calls = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.5")],
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_called_once()
        assert calls[0][2].endswith(":1.0.5@cafe1234")

    def test_fix_only_skips_minor_bump(self):
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.1.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_not_called()

    def test_fix_only_skips_major_bump(self):
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "2.0.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.FIX_ONLY,
        )
        upgrade_mock.assert_not_called()

    def test_latest_strategy_skips_when_versions_equal(self):
        upgrade_mock, _ = _run_task(
            plugins=[_make_plugin("acme/foo", "1.0.0")],
            manifests=[_make_manifest("acme/foo", "1.0.0")],
            strategy_setting=TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
        )
        upgrade_mock.assert_not_called()


class TestUpgradeMode:
    def test_mode_all_upgrades_every_marketplace_plugin(self):
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        assert upgrade_mock.call_count == 2
        upgraded_ids = sorted(c[1] for c in calls)
        assert upgraded_ids == sorted(p.plugin_unique_identifier for p in plugins)

    def test_mode_all_skips_non_marketplace_sources(self):
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0", source=PluginInstallationSource.Github),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier

    def test_mode_partial_only_upgrades_included_plugins(self):
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.PARTIAL,
            include_plugins=["acme/foo"],
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier

    def test_mode_exclude_skips_excluded_plugins(self):
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]

        upgrade_mock, calls = _run_task(
            plugins=plugins,
            manifests=manifests,
            upgrade_mode=TenantPluginAutoUpgradeStrategy.UpgradeMode.EXCLUDE,
            exclude_plugins=["acme/bar"],
        )

        assert upgrade_mock.call_count == 1
        assert calls[0][1] == plugins[0].plugin_unique_identifier


class TestErrorIsolation:
    def test_one_plugin_failure_does_not_block_others(self):
        plugins = [
            _make_plugin("acme/foo", "1.0.0"),
            _make_plugin("acme/bar", "2.0.0"),
        ]
        manifests = [
            _make_manifest("acme/foo", "1.0.1"),
            _make_manifest("acme/bar", "2.0.1"),
        ]
        fake_manager = MagicMock()
        fake_manager.list_plugins.return_value = plugins

        seen: list[str] = []

        def _upgrade(tenant_id, original, new):
            seen.append(original)
            if "foo" in original:
                raise RuntimeError("boom")

        with (
            patch(f"{MODULE}.PluginInstaller", return_value=fake_manager),
            patch(f"{MODULE}.marketplace_batch_fetch_plugin_manifests", return_value=manifests),
            patch(f"{MODULE}.PluginService.upgrade_plugin_with_marketplace", side_effect=_upgrade),
        ):
            from tasks.process_tenant_plugin_autoupgrade_check_task import (
                process_tenant_plugin_autoupgrade_check_task,
            )

            process_tenant_plugin_autoupgrade_check_task(
                "tenant-1",
                TenantPluginAutoUpgradeStrategy.StrategySetting.LATEST,
                0,
                TenantPluginAutoUpgradeStrategy.UpgradeMode.ALL,
                [],
                [],
            )

        assert any("foo" in s for s in seen)
        assert any("bar" in s for s in seen)
