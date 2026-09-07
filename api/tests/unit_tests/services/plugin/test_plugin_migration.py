import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from models.model import App, AppMode
from services.plugin.plugin_migration import PluginMigration

MIGRATION_MODULE = "services.plugin.plugin_migration"


@pytest.fixture(autouse=True)
def _marketplace_enabled(config_overrides) -> None:
    config_overrides(MARKETPLACE_ENABLED=True)


def test_fetch_latest_package_identifier_returns_none_when_disabled(mocker: MockerFixture, config_overrides) -> None:
    config_overrides(MARKETPLACE_ENABLED=False)
    batch_fetch = mocker.patch("services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests")

    result = PluginMigration._fetch_latest_package_identifier("langgenius/openai")

    assert result is None
    batch_fetch.assert_not_called()


def test_fetch_latest_package_identifier_calls_marketplace_when_enabled(mocker: MockerFixture) -> None:
    manifest = mocker.MagicMock()
    manifest.latest_package_identifier = "langgenius/openai:1.0.0@abc"
    mocker.patch(
        "services.plugin.plugin_migration.marketplace.batch_fetch_plugin_manifests",
        return_value=[manifest],
    )

    result = PluginMigration._fetch_latest_package_identifier("langgenius/openai")

    assert result == "langgenius/openai:1.0.0@abc"


def test_extract_app_tables_checks_agent_mode_with_its_session(mocker: MockerFixture, sqlite_session: Session) -> None:
    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Chat app",
        description="",
        mode=AppMode.CHAT,
        icon_type=None,
        icon="",
        icon_background=None,
        enable_site=False,
        enable_api=False,
        created_by="account-1",
        max_active_requests=0,
    )
    sqlite_session.add(app)
    sqlite_session.commit()
    mocker.patch(f"{MIGRATION_MODULE}.db", SimpleNamespace(engine=sqlite_session.get_bind()))

    result = PluginMigration.extract_app_tables("tenant-1")

    assert result == []


class TestHandlePluginInstanceInstall:
    def test_raises_when_disabled_and_map_nonempty(self, config_overrides) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)
        with pytest.raises(ValueError, match="Marketplace disabled"):
            PluginMigration.handle_plugin_instance_install(
                "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
            )

    def test_no_raise_when_disabled_and_map_empty(self, config_overrides) -> None:
        config_overrides(MARKETPLACE_ENABLED=False)
        with patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls:
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            mock_installer.install_from_identifiers.return_value = MagicMock(all_installed=True)

            result = PluginMigration.handle_plugin_instance_install("tenant1", {})

        assert isinstance(result, dict)

    def test_proceeds_when_enabled(self) -> None:
        with (
            patch(f"{MIGRATION_MODULE}.marketplace") as mock_marketplace,
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(f"{MIGRATION_MODULE}.PluginService.invalidate_plugin_model_providers_cache") as invalidate_cache,
        ):
            mock_marketplace.download_plugin_pkg.return_value = b"pkg_data"
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            mock_installer.install_from_identifiers.return_value = MagicMock(all_installed=True)

            result = PluginMigration.handle_plugin_instance_install(
                "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
            )

        mock_marketplace.download_plugin_pkg.assert_called_once()
        invalidate_cache.assert_called_once_with("tenant1")
        assert result["success"] == ["langgenius/openai"]
        assert result["failed"] == []

    def test_reports_failed_plugin_ids_when_install_batch_raises(self) -> None:
        with (
            patch(f"{MIGRATION_MODULE}.marketplace") as mock_marketplace,
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
        ):
            mock_marketplace.download_plugin_pkg.return_value = b"pkg_data"
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            mock_installer.install_from_identifiers.side_effect = RuntimeError("install failed")

            result = PluginMigration.handle_plugin_instance_install(
                "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
            )

        assert result["success"] == []
        assert result["failed"] == ["langgenius/openai"]

    def test_install_plugins_invalidates_cache_after_direct_tenant_install(self, tmp_path: Path) -> None:
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

    def test_install_plugins_reports_missing_plugin_ids(self, tmp_path: Path) -> None:
        extracted_plugins = tmp_path / "plugins.jsonl"
        output_file = tmp_path / "output.json"
        extracted_plugins.write_text('{"tenant_id":"tenant1","plugins":["langgenius/openai","langgenius/missing"]}\n')

        with (
            patch(
                f"{MIGRATION_MODULE}.PluginMigration.extract_unique_plugins",
                return_value={
                    "plugins": {"langgenius/openai": "langgenius/openai:1.0.0@abc"},
                    "plugin_not_exist": ["langgenius/missing"],
                },
            ),
            patch(f"{MIGRATION_MODULE}.PluginMigration.handle_plugin_instance_install", return_value={}),
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(f"{MIGRATION_MODULE}.PluginService.invalidate_plugin_model_providers_cache"),
        ):
            mock_installer = MagicMock()
            mock_installer.list_plugins.return_value = []
            mock_installer_cls.return_value = mock_installer

            PluginMigration.install_plugins(str(extracted_plugins), str(output_file), workers=1)

        assert json.loads(output_file.read_text())["not_installed"] == [
            {
                "tenant_id": "tenant1",
                "plugin_not_exist": ["langgenius/missing"],
            }
        ]
        mock_installer.install_from_identifiers.assert_called_once()

    def test_install_plugins_skips_unresolved_plugins(self, tmp_path: Path) -> None:
        extracted_plugins = tmp_path / "plugins.jsonl"
        output_file = tmp_path / "output.json"
        extracted_plugins.write_text('{"tenant_id":"tenant1","plugins":["langgenius/missing"]}\n')

        with (
            patch(
                f"{MIGRATION_MODULE}.PluginMigration.extract_unique_plugins",
                return_value={
                    "plugins": {},
                    "plugin_not_exist": ["langgenius/missing"],
                },
            ),
            patch(f"{MIGRATION_MODULE}.PluginMigration.handle_plugin_instance_install", return_value={}),
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
        ):
            mock_installer = MagicMock()
            mock_installer.list_plugins.return_value = []
            mock_installer_cls.return_value = mock_installer

            PluginMigration.install_plugins(str(extracted_plugins), str(output_file), workers=1)

        output = json.loads(output_file.read_text())
        assert output["not_installed"] == [{"tenant_id": "tenant1", "plugin_not_exist": ["langgenius/missing"]}]
        mock_installer.install_from_identifiers.assert_not_called()
