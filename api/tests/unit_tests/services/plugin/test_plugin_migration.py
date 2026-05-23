from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture

from services.plugin.plugin_migration import PluginMigration

MIGRATION_MODULE = "services.plugin.plugin_migration"


def test_fetch_plugin_unique_identifier_returns_none_when_disabled(mocker: MockerFixture) -> None:
    mocker.patch("services.plugin.plugin_migration.dify_config.MARKETPLACE_ENABLED", False)
    batch_fetch = mocker.patch("services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests")

    result = PluginMigration._fetch_plugin_unique_identifier("langgenius/openai")

    assert result is None
    batch_fetch.assert_not_called()


def test_fetch_plugin_unique_identifier_calls_marketplace_when_enabled(mocker: MockerFixture) -> None:
    mocker.patch("services.plugin.plugin_migration.dify_config.MARKETPLACE_ENABLED", True)
    manifest = mocker.MagicMock()
    manifest.latest_package_identifier = "langgenius/openai:1.0.0@abc"
    mocker.patch(
        "services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests",
        return_value=[manifest],
    )

    result = PluginMigration._fetch_plugin_unique_identifier("langgenius/openai")

    assert result == "langgenius/openai:1.0.0@abc"


class TestHandlePluginInstanceInstall:
    def test_raises_when_disabled_and_map_nonempty(self) -> None:
        with patch(f"{MIGRATION_MODULE}.dify_config") as mock_cfg:
            mock_cfg.MARKETPLACE_ENABLED = False

            with pytest.raises(ValueError, match="Marketplace disabled"):
                PluginMigration.handle_plugin_instance_install(
                    "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
                )

    def test_no_raise_when_disabled_and_map_empty(self) -> None:
        with (
            patch(f"{MIGRATION_MODULE}.dify_config") as mock_cfg,
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
        ):
            mock_cfg.MARKETPLACE_ENABLED = False
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            mock_installer.install_from_identifiers.return_value = MagicMock(all_installed=True)

            result = PluginMigration.handle_plugin_instance_install("tenant1", {})

        assert isinstance(result, dict)

    def test_proceeds_when_enabled(self) -> None:
        with (
            patch(f"{MIGRATION_MODULE}.dify_config") as mock_cfg,
            patch(f"{MIGRATION_MODULE}.marketplace") as mock_marketplace,
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(f"{MIGRATION_MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_cfg.MARKETPLACE_ENABLED = True
            mock_marketplace.download_plugin_pkg.return_value = b"pkg_data"
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            mock_installer.install_from_identifiers.return_value = MagicMock(all_installed=True)

            result = PluginMigration.handle_plugin_instance_install(
                "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
            )

        mock_marketplace.download_plugin_pkg.assert_called_once()
        invalidate_cache.assert_called_once_with("tenant1")
        assert "success" in result or "failed" in result

    def test_install_plugins_invalidates_cache_after_direct_tenant_install(self, tmp_path) -> None:
        extracted_plugins = tmp_path / "plugins.jsonl"
        output_file = tmp_path / "output.json"
        extracted_plugins.write_text('{"tenant_id":"tenant1","plugins":["langgenius/openai"]}\n')

        with (
            patch(
                f"{MIGRATION_MODULE}.PluginMigration.extract_unique_plugins",
                return_value={
                    "plugins": {"langgenius/openai": "langgenius/openai:1.0.0@abc"},
                    "plugin_not_exist": [],
                },
            ),
            patch(f"{MIGRATION_MODULE}.PluginMigration.handle_plugin_instance_install", return_value={}),
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(f"{MIGRATION_MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_installer = MagicMock()
            mock_installer.list_plugins.return_value = []
            mock_installer_cls.return_value = mock_installer

            PluginMigration.install_plugins(str(extracted_plugins), str(output_file), workers=1)

        mock_installer.install_from_identifiers.assert_called_once()
        invalidate_cache.assert_called_once_with("tenant1")
