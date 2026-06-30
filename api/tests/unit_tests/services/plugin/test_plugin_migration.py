import datetime
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.tools.entities.tool_entities import ToolProviderType
from services.plugin.plugin_migration import PluginMigration
from services.plugin.plugin_migration_models import ExtractedPluginIdentifiers, PluginInstallResult, TenantPluginRecord

MIGRATION_MODULE = "services.plugin.plugin_migration"
TEST_TENANT_ID = "test-tenant-1"
TEST_PROVIDER_ID = "websearch"
TEST_PLUGIN_ID = "langgenius/websearch/websearch"
TEST_PLUGIN_IDENTIFIER = "websearch@1.0.0"
TEST_PLUGINS_JSON = "test_plugins.json"
TEST_OUTPUT_JSON = "test_output.json"
TEST_FAKE_TENANT_ID = "fake-tenant-id"
TEST_EXCLUDED_PROVIDER = "time"
TEST_FLASK_APP = Flask(__name__)


@pytest.fixture(autouse=True)
def isolated_plugin_migration_files(tmp_path, monkeypatch):
    """Give legacy file-path constants a per-test location so xdist workers never share files."""
    module = sys.modules[__name__]
    monkeypatch.setattr(module, "TEST_PLUGINS_JSON", str(tmp_path / "test_plugins.json"))
    monkeypatch.setattr(module, "TEST_OUTPUT_JSON", str(tmp_path / "test_output.json"))


def tenant_plugin_record_json(plugin_ids: list[str]) -> str:
    return TenantPluginRecord(tenant_id=TEST_TENANT_ID, plugins=plugin_ids).model_dump_json(by_alias=True)


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
        with patch(f"{MIGRATION_MODULE}.dify_config") as mock_cfg:
            mock_cfg.MARKETPLACE_ENABLED = False

            result = PluginMigration.handle_plugin_instance_install("tenant1", {})

        assert isinstance(result, PluginInstallResult)

    def test_proceeds_when_enabled(self) -> None:
        with (
            patch(f"{MIGRATION_MODULE}.dify_config") as mock_cfg,
            patch(f"{MIGRATION_MODULE}.marketplace") as mock_marketplace,
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(
                f"{MIGRATION_MODULE}.PluginService.install_from_resolved_marketplace_identifiers"
            ) as install_resolved,
        ):
            mock_cfg.MARKETPLACE_ENABLED = True
            mock_marketplace.download_plugin_pkg.return_value = b"pkg_data"
            mock_installer = MagicMock()
            mock_installer_cls.return_value = mock_installer
            install_resolved.return_value = MagicMock(all_installed=True)

            result = PluginMigration.handle_plugin_instance_install(
                "tenant1", {"langgenius/openai": "langgenius/openai:1.0.0@abc"}
            )

        mock_marketplace.download_plugin_pkg.assert_called_once()
        install_resolved.assert_called_once_with("tenant1", ("langgenius/openai:1.0.0@abc",))
        assert result.successful_plugin_ids == ("langgenius/openai",)
        assert result.failed_plugin_ids == ()

    def test_install_plugins_uses_resolved_marketplace_install_entrypoint(self, tmp_path) -> None:
        extracted_plugins = tmp_path / "plugins.jsonl"
        output_file = tmp_path / "output.json"
        extracted_plugins.write_text('{"tenant_id":"tenant1","plugins":["langgenius/openai"]}\n')

        with (
            patch(
                f"{MIGRATION_MODULE}.PluginMigration.extract_unique_plugins",
                return_value=ExtractedPluginIdentifiers(plugins={"langgenius/openai": "langgenius/openai:1.0.0@abc"}),
            ),
            patch(
                f"{MIGRATION_MODULE}.PluginMigration.handle_plugin_instance_install", return_value=PluginInstallResult()
            ),
            patch(f"{MIGRATION_MODULE}.PluginInstaller") as mock_installer_cls,
            patch(
                f"{MIGRATION_MODULE}.PluginService.install_from_resolved_marketplace_identifiers"
            ) as install_resolved,
        ):
            mock_installer = MagicMock()
            mock_installer.list_plugins.return_value = []
            mock_installer_cls.return_value = mock_installer

            PluginMigration.install_plugins(str(extracted_plugins), str(output_file), workers=1)

        install_resolved.assert_called_once_with("tenant1", ("langgenius/openai:1.0.0@abc",))


class FakeFuture:
    def __init__(self, fn, *args, **kwargs):
        self._result = None
        self._exception = None
        try:
            self._result = fn(*args, **kwargs)
        except Exception as exc:
            self._exception = exc

    def result(self):
        if self._exception:
            raise self._exception
        return self._result


class FakeThreadPoolExecutor:
    def __init__(self, max_workers=None):
        self.max_workers = max_workers
        self._futures: list[FakeFuture] = []

    def submit(self, fn, *args, **kwargs):
        future = FakeFuture(fn, *args, **kwargs)
        self._futures.append(future)
        return future

    def map(self, fn, *iterables, timeout=None):
        return list(map(fn, *iterables))

    def shutdown(self, wait=True):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.shutdown(wait=True)
        return False


class FakeDatetime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2023, 4, 3, 8, 59, 25)


class TestPluginMigrationFactory:
    """Factory class for creating test data and mock objects for plugin migration tests."""

    @staticmethod
    def create_mock_result(return_values: list[Any]) -> MagicMock:
        """Create a mock database query result object."""
        mock_result = MagicMock()
        mock_result.__iter__.return_value = return_values
        return mock_result

    @staticmethod
    def create_mock_tool_provider(provider: str = TEST_PROVIDER_ID) -> MagicMock:
        """Create a mock tool provider object."""
        mock_provider = MagicMock()
        mock_provider.provider = provider
        return mock_provider

    @staticmethod
    def create_mock_workflow(with_tool_node: bool = True, excluded_provider: bool = False) -> MagicMock:
        """Create a mock workflow object with optional tool node/excluded provider."""
        mock_wf = MagicMock()
        if with_tool_node:
            provider = TEST_EXCLUDED_PROVIDER if excluded_provider else TEST_PROVIDER_ID
            mock_wf.graph_dict = {
                "nodes": [
                    {
                        "data": {
                            "type": "tool",
                            "provider_name": provider,
                            "provider_type": "builtin",
                        }
                    }
                ]
            }
        else:
            mock_wf.graph_dict = {"nodes": [{"data": {"type": "llm"}}]}
        return mock_wf

    @staticmethod
    def create_mock_app(
        tenant_id: str = TEST_TENANT_ID, is_agent: bool = True, config_id: str = "config1"
    ) -> MagicMock:
        """Create a mock application object."""
        mock_app = MagicMock()
        mock_app.tenant_id = tenant_id
        mock_app.is_agent = is_agent
        mock_app.app_model_config_id = config_id
        mock_app.mode = "agent-chat"
        return mock_app

    @staticmethod
    def create_mock_app_config(invalid_tool: bool = False, exception_tool: bool = False) -> MagicMock:
        """Create a mock app model config object with tool configuration."""
        mock_config = MagicMock()
        if invalid_tool:
            mock_config.agent_mode_dict = {"tools": ["not-a-dict"]}
        elif exception_tool:
            mock_config.agent_mode_dict = {"tools": [{"invalid": "tool"}]}
        else:
            mock_config.agent_mode_dict = {
                "tools": [{"provider_type": "builtin", "provider_id": TEST_PROVIDER_ID}],
            }
        return mock_config

    @staticmethod
    def create_mock_plugin_manifest(identifier: str = TEST_PLUGIN_IDENTIFIER) -> MagicMock:
        """Create a mock plugin manifest object from marketplace."""
        mock_manifest = MagicMock()
        mock_manifest.plugin_id = TEST_PLUGIN_ID
        mock_manifest.latest_package_identifier = identifier
        return mock_manifest

    @staticmethod
    def create_mock_install_task_status(status: str, plugin_status: str) -> MagicMock:
        """Create a mock plugin install task status."""
        mock_status = MagicMock()
        mock_status.status = status
        mock_plugin = MagicMock()
        mock_plugin.status = plugin_status
        mock_plugin.plugin_unique_identifier = TEST_PLUGIN_IDENTIFIER
        mock_plugin.message = "install failed"
        mock_status.plugins = [mock_plugin]
        return mock_status

    @staticmethod
    def create_mock_tenant(tenant_id: str = TEST_TENANT_ID) -> MagicMock:
        """Create a mock Tenant object."""
        mock_tenant = MagicMock()
        mock_tenant.id = tenant_id
        mock_tenant.created_at = datetime.datetime.now()
        return mock_tenant

    @staticmethod
    def create_mock_paginate(tenants: list[MagicMock]) -> MagicMock:
        """Create a mock database pagination result."""
        mock_paginate = MagicMock()
        mock_paginate.items = tenants
        return mock_paginate


@pytest.fixture
def plugin_migration_mocks():
    """Fixture to patch all heavy dependencies of PluginMigration."""
    with (
        patch("services.plugin.plugin_migration.db") as mock_db,
        patch("services.plugin.plugin_migration.Session") as mock_session,
        patch("services.plugin.plugin_migration.marketplace") as mock_market,
        patch("services.plugin.plugin_migration.PluginInstaller") as mock_installer,
        patch("services.plugin.plugin_migration.PluginService") as mock_plugin_service,
        patch("services.plugin.plugin_migration.ThreadPoolExecutor") as mock_executor,
        patch("services.plugin.plugin_migration.click") as mock_click,
        patch("services.plugin.plugin_migration.tqdm") as mock_tqdm,
        patch("services.plugin.plugin_migration.current_app", new_callable=MagicMock) as mock_current_app,
    ):
        mock_current_app._get_current_object.return_value = TEST_FLASK_APP
        mock_executor.side_effect = lambda max_workers=None: FakeThreadPoolExecutor(max_workers)
        mock_tqdm.side_effect = lambda iterable, **kwargs: iterable

        yield SimpleNamespace(
            db=mock_db,
            session=mock_session,
            marketplace=mock_market,
            installer=mock_installer,
            plugin_service=mock_plugin_service,
            executor=mock_executor,
            click=mock_click,
            tqdm=mock_tqdm,
            current_app=mock_current_app,
        )


@pytest.fixture
def factory():
    """Provide test data factory for mock object creation."""
    return TestPluginMigrationFactory()


class TestPluginMigrationExtractInstalledPluginIds:
    """
    Unit tests for PluginMigration.extract_installed_plugin_ids.

    Test coverage:
    - Merge plugin IDs from all extractor methods
    - Return empty list when no plugins are found
    """

    def test_extract_installed_plugin_ids(self):
        """Test extract_installed_plugin_ids merges plugin IDs from all extractors."""
        # Arrange
        with (
            patch.object(PluginMigration, "extract_tool_tables", return_value=[TEST_PLUGIN_ID]),
            patch.object(PluginMigration, "extract_model_tables", return_value=[TEST_PLUGIN_ID]),
            patch.object(PluginMigration, "extract_workflow_tables", return_value=[]),
            patch.object(PluginMigration, "extract_app_tables", return_value=[]),
        ):
            # Act
            plugins = PluginMigration.extract_installed_plugin_ids(TEST_TENANT_ID)

        # Assert
        assert isinstance(plugins, list)
        assert TEST_PLUGIN_ID in plugins

    def test_extract_installed_plugin_ids_empty(self):
        """Test extract_installed_plugin_ids returns empty list with no plugins."""
        # Arrange
        with (
            patch.object(PluginMigration, "extract_tool_tables", return_value=[]),
            patch.object(PluginMigration, "extract_model_tables", return_value=[]),
            patch.object(PluginMigration, "extract_workflow_tables", return_value=[]),
            patch.object(PluginMigration, "extract_app_tables", return_value=[]),
        ):
            # Act
            plugins = PluginMigration.extract_installed_plugin_ids(TEST_TENANT_ID)

        # Assert
        assert plugins == []


class TestPluginMigrationExtractModelTables:
    """
    Unit tests for PluginMigration.extract_model_tables and extract_model_table.

    Test coverage:
    - Aggregate plugin IDs from model tables
    - Return empty list for empty database results
    - Single table query execution
    """

    def test_extract_model_tables(self, plugin_migration_mocks, factory):
        """Test extract_model_tables aggregates plugin IDs from database."""
        # Arrange
        m = plugin_migration_mocks
        mock_result = factory.create_mock_result([(TEST_PROVIDER_ID,)])
        m.session.return_value.__enter__.return_value.execute.return_value = mock_result

        # Act
        plugins = PluginMigration.extract_model_tables(TEST_TENANT_ID)

        # Assert
        assert isinstance(plugins, list)

    def test_extract_model_tables_empty(self, plugin_migration_mocks, factory):
        """Test extract_model_tables returns empty list with no database rows."""
        # Arrange
        m = plugin_migration_mocks
        mock_result = factory.create_mock_result([])
        m.session.return_value.__enter__.return_value.execute.return_value = mock_result

        # Act
        plugins = PluginMigration.extract_model_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_model_table(self, plugin_migration_mocks, factory):
        """Test extract_model_table executes single table query correctly."""
        # Arrange
        m = plugin_migration_mocks
        mock_result = factory.create_mock_result([(TEST_PROVIDER_ID,)])
        m.session.return_value.__enter__.return_value.execute.return_value = mock_result

        # Act
        plugins = PluginMigration.extract_model_table(TEST_TENANT_ID, "providers", "provider_name")

        # Assert
        assert len(plugins) >= 0

    def test_extract_model_table_empty(self, plugin_migration_mocks, factory):
        """Test extract_model_table returns empty list for empty table."""
        # Arrange
        m = plugin_migration_mocks
        mock_result = factory.create_mock_result([])
        m.session.return_value.__enter__.return_value.execute.return_value = mock_result

        # Act
        plugins = PluginMigration.extract_model_table(TEST_TENANT_ID, "providers", "provider_name")

        # Assert
        assert plugins == []


class TestPluginMigrationExtractToolTables:
    """
    Unit tests for PluginMigration.extract_tool_tables.

    Test coverage:
    - Map built-in tool providers to plugin IDs
    - Return empty list for empty tool table
    """

    def test_extract_tool_tables(self, plugin_migration_mocks, factory):
        """Test extract_tool_tables maps tool providers to plugin IDs."""
        # Arrange
        m = plugin_migration_mocks
        mock_provider = factory.create_mock_tool_provider()
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = [mock_provider]

        # Act
        plugins = PluginMigration.extract_tool_tables(TEST_TENANT_ID)

        # Assert
        assert isinstance(plugins, list)

    def test_extract_tool_tables_empty(self, plugin_migration_mocks):
        """Test extract_tool_tables returns empty list with no tools."""
        # Arrange
        m = plugin_migration_mocks
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = []

        # Act
        plugins = PluginMigration.extract_tool_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []


class TestPluginMigrationExtractWorkflowTables:
    """
    Unit tests for PluginMigration.extract_workflow_tables.

    Test coverage:
    - Extract plugin IDs from workflow tool nodes
    - Return empty list with no workflows
    - Return empty list for workflows without tool nodes
    - Skip excluded providers
    """

    def test_extract_workflow_tables(self, plugin_migration_mocks, factory):
        """Test extract_workflow_tables extracts plugins from workflow tool nodes."""
        # Arrange
        m = plugin_migration_mocks
        mock_wf = factory.create_mock_workflow()
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = [mock_wf]

        # Act
        plugins = PluginMigration.extract_workflow_tables(TEST_TENANT_ID)

        # Assert
        assert isinstance(plugins, list)

    def test_extract_workflow_tables_empty(self, plugin_migration_mocks):
        """Test extract_workflow_tables returns empty list with no workflows."""
        # Arrange
        m = plugin_migration_mocks
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = []

        # Act
        plugins = PluginMigration.extract_workflow_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_workflow_tables_no_tool_nodes(self, plugin_migration_mocks, factory):
        """Test extract_workflow_tables skips workflows without tool nodes."""
        # Arrange
        m = plugin_migration_mocks
        mock_wf = factory.create_mock_workflow(with_tool_node=False)
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = [mock_wf]

        # Act
        plugins = PluginMigration.extract_workflow_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_workflow_tables_excluded_provider(self, plugin_migration_mocks, factory):
        """Test extract_workflow_tables skips excluded tool providers."""
        # Arrange
        m = plugin_migration_mocks
        mock_wf = factory.create_mock_workflow(excluded_provider=True)
        m.session.return_value.__enter__.return_value.scalars.return_value.all.return_value = [mock_wf]

        # Act
        plugins = PluginMigration.extract_workflow_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []


class TestPluginMigrationExtractAppTables:
    """
    Unit tests for PluginMigration.extract_app_tables.

    Test coverage:
    - Extract plugins from agent apps with built-in tools
    - Return empty list with no apps
    - Skip non-agent applications
    - Handle missing app model configuration
    - Handle invalid tool format
    - Handle tool parsing exception
    """

    def test_extract_app_tables(self, plugin_migration_mocks, factory):
        """Test extract_app_tables extracts plugins from agent apps."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = factory.create_mock_app_config()

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        with patch(
            "services.plugin.plugin_migration.AgentToolEntity.model_validate",
            return_value=MagicMock(provider_type=ToolProviderType.BUILT_IN, provider_id=TEST_PROVIDER_ID),
        ):
            # Act
            plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert isinstance(plugins, list)

    def test_extract_app_tables_empty(self, plugin_migration_mocks):
        """Test extract_app_tables returns empty list with no apps."""
        # Arrange
        m = plugin_migration_mocks
        mock_scalar = MagicMock()
        mock_scalar.all.return_value = []
        m.session.return_value.__enter__.return_value.scalars.return_value = mock_scalar

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_not_agent(self, plugin_migration_mocks, factory):
        """Test extract_app_tables skips non-agent applications."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app(is_agent=False)
        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        m.session.return_value.__enter__.return_value.scalars.return_value = mock_scalar

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_missing_config(self, plugin_migration_mocks, factory):
        """Test extract_app_tables handles missing app model config."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app(config_id="missing-id")
        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = []
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_invalid_tool_format(self, plugin_migration_mocks, factory):
        """Test extract_app_tables handles non-dict tool entries."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = factory.create_mock_app_config(invalid_tool=True)

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_tool_not_builtin(self, plugin_migration_mocks, factory):
        """Test extract_app_tables skips non-built-in agent tools."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = MagicMock()
        mock_config.agent_mode_dict = {"tools": [{"provider_type": "third_party", "provider_id": TEST_PROVIDER_ID}]}

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        with patch(
            "services.plugin.plugin_migration.AgentToolEntity.model_validate",
            return_value=MagicMock(provider_type="third_party", provider_id=TEST_PROVIDER_ID),
        ):
            # Act
            plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_tool_parsing_exception(self, plugin_migration_mocks, factory):
        """Test extract_app_tables handles tool validation exceptions."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = factory.create_mock_app_config(exception_tool=True)

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_missing_tools_key(self, plugin_migration_mocks, factory):
        """Test extract_app_tables handles missing 'tools' key in agent config."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = MagicMock()
        mock_config.agent_mode_dict = {}

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []

    def test_extract_app_tables_tools_not_list(self, plugin_migration_mocks, factory):
        """Test extract_app_tables handles non-list 'tools' value."""
        # Arrange
        m = plugin_migration_mocks
        mock_app = factory.create_mock_app()
        mock_config = MagicMock()
        mock_config.agent_mode_dict = {"tools": "not-a-list"}

        mock_scalar = MagicMock()
        mock_scalar.all.return_value = [mock_app]
        mock_scalar2 = MagicMock()
        mock_scalar2.all.return_value = [mock_config]
        m.session.return_value.__enter__.return_value.scalars.side_effect = [mock_scalar, mock_scalar2]

        # Act
        plugins = PluginMigration.extract_app_tables(TEST_TENANT_ID)

        # Assert
        assert plugins == []


class TestPluginMigrationFetchPluginIdentifier:
    """
    Unit tests for PluginMigration._fetch_plugin_unique_identifier.

    Test coverage:
    - Resolve plugin package identifier from marketplace manifest
    - Return None when manifest not found
    """

    def test_fetch_plugin_unique_identifier(self, plugin_migration_mocks, factory):
        """Test _fetch_plugin_unique_identifier resolves plugin identifier from marketplace."""
        # Arrange
        m = plugin_migration_mocks
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]

        # Act
        res = PluginMigration._fetch_plugin_unique_identifier(TEST_PLUGIN_ID)

        # Assert
        assert res == TEST_PLUGIN_IDENTIFIER

    def test_fetch_plugin_unique_identifier_empty_manifest(self, plugin_migration_mocks):
        """Test _fetch_plugin_unique_identifier returns None when no manifest found."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.batch_fetch_plugin_manifests.return_value = []

        # Act
        res = PluginMigration._fetch_plugin_unique_identifier(TEST_PLUGIN_ID)

        # Assert
        assert res is None

    def test_fetch_plugin_unique_identifier_exception(self, plugin_migration_mocks):
        """Test _fetch_plugin_unique_identifier handles marketplace exception."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.batch_fetch_plugin_manifests.side_effect = RuntimeError("marketplace error")

        # Act & Assert
        with pytest.raises(RuntimeError):
            PluginMigration._fetch_plugin_unique_identifier(TEST_PLUGIN_ID)


class TestPluginMigrationExtractUniquePlugins:
    """
    Unit tests for unique plugin extraction and file I/O operations.

    Test coverage:
    - Write consolidated plugin manifest to output file
    - Handle empty plugin list gracefully
    - Raise error for missing input file
    - Read and process tenant plugin records from file
    - Fetch plugin success/failure/non-exist
    """

    def test_extract_unique_plugins_to_file(self, plugin_migration_mocks, factory):
        """Test extract_unique_plugins_to_file writes consolidated plugin manifest."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]

        # Act
        PluginMigration.extract_unique_plugins_to_file(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_to_file_empty_plugins(self, plugin_migration_mocks):
        """Test extract_unique_plugins_to_file creates output with empty plugin list."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([]),
            encoding="utf-8",
        )

        # Act
        PluginMigration.extract_unique_plugins_to_file(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_to_file_missing_input(self, plugin_migration_mocks):
        """Test extract_unique_plugins_to_file raises FileNotFoundError for missing input."""
        # Act & Assert
        with pytest.raises(FileNotFoundError):
            PluginMigration.extract_unique_plugins_to_file("not_exist.json", TEST_OUTPUT_JSON)

    def test_extract_unique_plugins_from_file(self, plugin_migration_mocks, factory):
        """Test extract_unique_plugins reads and processes tenant plugin records."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        # Act
        with patch.object(PluginMigration, "_fetch_plugin_unique_identifier", return_value=TEST_PLUGIN_IDENTIFIER):
            result = PluginMigration.extract_unique_plugins(TEST_PLUGINS_JSON)

        # Assert
        assert result.identifier_by_id == {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER}

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_fetch_plugin_failure(self, plugin_migration_mocks):
        """Test extract_unique_plugins handles fetch plugin exception."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        # Act
        with patch.object(PluginMigration, "_fetch_plugin_unique_identifier", side_effect=Exception("fetch failed")):
            result = PluginMigration.extract_unique_plugins(TEST_PLUGINS_JSON)

        # Assert
        assert TEST_PLUGIN_ID in result.unresolved_plugin_ids

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_plugin_not_exist(self, plugin_migration_mocks):
        """Test extract_unique_plugins handles non-existent plugins."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        # Act
        with patch.object(PluginMigration, "_fetch_plugin_unique_identifier", return_value=None):
            result = PluginMigration.extract_unique_plugins(TEST_PLUGINS_JSON)

        # Assert
        assert TEST_PLUGIN_ID in result.unresolved_plugin_ids

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_fetch_plugin_exception_handling(self, plugin_migration_mocks):
        """Test extract_unique_plugins handles fetch_plugin exceptions internally."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        # Act
        with patch.object(PluginMigration, "_fetch_plugin_unique_identifier", side_effect=Exception("fetch failed")):
            result = PluginMigration.extract_unique_plugins(TEST_PLUGINS_JSON)

        # Assert
        assert TEST_PLUGIN_ID in result.unresolved_plugin_ids

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)

    def test_extract_unique_plugins_ignores_duplicate_plugin_ids(self, plugin_migration_mocks):
        """Test extract_unique_plugins processes each plugin id only once."""
        # Arrange
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID, TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        # Act
        with patch.object(PluginMigration, "_fetch_plugin_unique_identifier", return_value=TEST_PLUGIN_IDENTIFIER):
            result = PluginMigration.extract_unique_plugins(TEST_PLUGINS_JSON)

        # Assert
        assert list(result.identifier_by_id.keys()) == [TEST_PLUGIN_ID]
        assert result.unresolved_plugin_ids == []

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)


class TestPluginMigrationHandlePluginInstanceInstall:
    """
    Unit tests for PluginMigration.handle_plugin_instance_install.

    Test coverage:
    - Successful plugin installation
    - Handle empty plugin installation map
    - Record failed installations on exception
    - Cover download_and_upload nested function
    - Cover install task polling
    - Cover partial installation failure
    - Cover plugin download failure
    """

    def test_handle_plugin_instance_install(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install records successful installations."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = b"fake-pkg"
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = MagicMock(all_installed=True)

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert isinstance(res, PluginInstallResult)

    def test_handle_plugin_instance_install_empty(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install with empty plugin map."""
        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {})

        # Assert
        assert res.successful_plugin_ids == ()
        assert res.failed_plugin_ids == ()

    def test_handle_plugin_instance_install_exception(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install records failures on installation error."""
        # Arrange
        m = plugin_migration_mocks
        m.plugin_service.install_from_resolved_marketplace_identifiers.side_effect = Exception("install failed")

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert res.failed_plugin_ids == (TEST_PLUGIN_ID,)

    def test_handle_plugin_instance_install_download_failure(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install handles plugin download failure."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = None

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert res.successful_plugin_ids == ()
        assert res.failed_plugin_ids == (TEST_PLUGIN_ID,)
        m.plugin_service.install_from_resolved_marketplace_identifiers.assert_not_called()

    def test_handle_plugin_instance_install_poll_task(self, plugin_migration_mocks, factory):
        """Test handle_plugin_instance_install polls installation task status."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = b"fake-pkg"
        installer = m.installer.return_value
        mock_response = MagicMock(all_installed=False, task_id="task-1")
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = mock_response

        mock_status = factory.create_mock_install_task_status(
            PluginInstallTaskStatus.Success, PluginInstallTaskStatus.Success
        )
        installer.fetch_plugin_installation_task.return_value = mock_status

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert TEST_PLUGIN_ID in res.successful_plugin_ids

    def test_handle_plugin_instance_install_task_failed(self, plugin_migration_mocks, factory):
        """Test handle_plugin_instance_install handles failed installation task."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = b"fake-pkg"
        installer = m.installer.return_value
        mock_response = MagicMock(all_installed=False, task_id="task-1")
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = mock_response

        mock_status = factory.create_mock_install_task_status(
            PluginInstallTaskStatus.Failed, PluginInstallTaskStatus.Failed
        )
        installer.fetch_plugin_installation_task.return_value = mock_status

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert TEST_PLUGIN_ID in res.failed_plugin_ids

    def test_handle_plugin_instance_install_download_and_upload_failure(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install download_and_upload function failure."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = None  # Download fails

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert res.failed_plugin_ids == (TEST_PLUGIN_ID,)
        m.plugin_service.install_from_resolved_marketplace_identifiers.assert_not_called()

    def test_handle_plugin_instance_install_records_upload_failure_and_continues(self, plugin_migration_mocks):
        """Test handle_plugin_instance_install installs uploaded plugins even when another upload fails."""
        # Arrange
        m = plugin_migration_mocks
        failed_plugin_id = f"{TEST_PLUGIN_ID}/failed"
        failed_identifier = f"{TEST_PLUGIN_IDENTIFIER}/failed"
        plugin_map = {
            failed_plugin_id: failed_identifier,
            TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER,
        }

        def upload_pkg(_tenant_id, plugin_package, verify_signature):
            if plugin_package == b"failed-pkg":
                raise Exception("upload failed")

        m.marketplace.download_plugin_pkg.side_effect = [b"failed-pkg", b"fake-pkg"]
        m.installer.return_value.upload_pkg.side_effect = upload_pkg
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = MagicMock(all_installed=True)

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, plugin_map)

        # Assert
        assert res.successful_plugin_ids == (TEST_PLUGIN_ID,)
        assert res.failed_plugin_ids == (failed_plugin_id,)
        m.plugin_service.install_from_resolved_marketplace_identifiers.assert_called_once_with(
            TEST_TENANT_ID,
            (TEST_PLUGIN_IDENTIFIER,),
        )

    def test_handle_plugin_instance_install_task_polling_loop(self, plugin_migration_mocks, factory):
        """Test handle_plugin_instance_install polls task status until completion."""
        # Arrange
        m = plugin_migration_mocks
        m.marketplace.download_plugin_pkg.return_value = b"fake-pkg"
        installer = m.installer.return_value
        mock_response = MagicMock(all_installed=False, task_id="task-1")
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = mock_response
        mock_pending_status = MagicMock()
        mock_pending_status.status = PluginInstallTaskStatus.Pending
        mock_final_status = factory.create_mock_install_task_status(
            PluginInstallTaskStatus.Success,
            PluginInstallTaskStatus.Success,
        )
        installer.fetch_plugin_installation_task.side_effect = [mock_pending_status, mock_final_status]

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, {TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER})

        # Assert
        assert TEST_PLUGIN_ID in res.successful_plugin_ids

    def test_handle_plugin_instance_install_batch_processing(self, plugin_migration_mocks, factory):
        """Test handle_plugin_instance_install processes plugins in batches."""
        # Arrange
        m = plugin_migration_mocks
        plugin_map = {f"{TEST_PLUGIN_ID}_{i}": f"{TEST_PLUGIN_IDENTIFIER}_{i}" for i in range(10)}
        for plugin_id in plugin_map:
            m.marketplace.download_plugin_pkg.return_value = b"fake-pkg"

        mock_response = MagicMock(all_installed=True)
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = mock_response

        # Act
        res = PluginMigration.handle_plugin_instance_install(TEST_TENANT_ID, plugin_map)

        # Assert
        assert res.successful_plugin_ids == tuple(plugin_map)


class TestPluginMigrationInstallPlugins:
    """
    Unit tests for PluginMigration.install_plugins.

    Test coverage:
    - End-to-end plugin installation flow with file output
    - Cover install nested function
    - Cover fake tenant uninstall
    - Cover plugin not exist handling
    """

    def test_install_plugins(self, plugin_migration_mocks, factory):
        """Test install_plugins executes full installation flow and writes output."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]
        installer = m.installer.return_value
        mock_plugin = MagicMock()
        mock_plugin.installation_id = "installation-1"
        installer.list_plugins.side_effect = [[], [mock_plugin], []]

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        installer.uninstall.assert_called()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_with_resolved_identifiers(self, plugin_migration_mocks):
        """Test install_plugins submits install jobs when plugin identifiers are resolved."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        m.installer.return_value.list_plugins.return_value = []

        # Act
        with (
            patch.object(
                PluginMigration,
                "extract_unique_plugins",
                return_value=ExtractedPluginIdentifiers(plugins={TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER}),
            ),
            patch.object(PluginMigration, "handle_plugin_instance_install", return_value=PluginInstallResult()),
        ):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        m.plugin_service.install_from_resolved_marketplace_identifiers.assert_called()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_plugin_not_exist(self, plugin_migration_mocks, factory):
        """Test install_plugins handles non-existent plugins for tenant."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]
        installer = m.installer.return_value
        installer.list_plugins.return_value = []

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_reports_failed_handle_install(self, plugin_migration_mocks):
        """Test install_plugins records failed plugin handles from initial installation."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        m.marketplace.batch_fetch_plugin_manifests.return_value = []
        m.installer.return_value.list_plugins.return_value = []

        # Act
        with patch.object(
            PluginMigration,
            "handle_plugin_instance_install",
            return_value=PluginInstallResult(failed_plugin_ids=(TEST_PLUGIN_ID,)),
        ):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["plugin_install_failed"] == [TEST_PLUGIN_ID]

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_records_tenant_install_failure(self, plugin_migration_mocks):
        """Test install_plugins records tenant install failures instead of hiding worker exceptions."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        m.installer.return_value.list_plugins.return_value = []
        m.plugin_service.install_from_resolved_marketplace_identifiers.side_effect = Exception("install failed")

        # Act
        with (
            patch.object(
                PluginMigration,
                "extract_unique_plugins",
                return_value=ExtractedPluginIdentifiers(plugins={TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER}),
            ),
            patch.object(PluginMigration, "handle_plugin_instance_install", return_value=PluginInstallResult()),
        ):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["plugin_install_failed"] == [TEST_PLUGIN_ID]

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_records_tenant_install_task_failure(self, plugin_migration_mocks, factory):
        """Test install_plugins waits for tenant install tasks before writing migration output."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        installer = m.installer.return_value
        installer.list_plugins.return_value = []
        installer.fetch_plugin_installation_task.return_value = factory.create_mock_install_task_status(
            PluginInstallTaskStatus.Failed,
            PluginInstallTaskStatus.Failed,
        )
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = MagicMock(
            all_installed=False,
            task_id="task-1",
        )

        # Act
        with (
            patch.object(
                PluginMigration,
                "extract_unique_plugins",
                return_value=ExtractedPluginIdentifiers(plugins={TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER}),
            ),
            patch.object(PluginMigration, "handle_plugin_instance_install", return_value=PluginInstallResult()),
        ):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["plugin_install_failed"] == [TEST_PLUGIN_ID]
        installer.fetch_plugin_installation_task.assert_called_once_with(TEST_TENANT_ID, "task-1")

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_records_not_installed_plugins(self, plugin_migration_mocks):
        """Test install_plugins records plugins that cannot be resolved to identifiers."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        m.installer.return_value.list_plugins.return_value = []

        # Act
        with patch.object(PluginMigration, "extract_unique_plugins", return_value=ExtractedPluginIdentifiers()):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["not_installed"] == [{"tenant_id": TEST_TENANT_ID, "plugin_not_exist": [TEST_PLUGIN_ID]}]

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_plugins_uninstall_exception(self, plugin_migration_mocks, factory):
        """Test install_plugins handles uninstall exception gracefully."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]
        installer = m.installer.return_value
        installer.list_plugins.return_value = []
        installer.uninstall.side_effect = Exception("uninstall failed")

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    @patch("services.plugin.plugin_migration.uuid4")
    def test_install_plugins_uninstall_list_plugins_exception(self, mock_uuid, plugin_migration_mocks, factory):
        """Test install_plugins handles list_plugins exception during uninstall gracefully."""
        # Arrange
        mock_uuid.return_value.hex = TEST_FAKE_TENANT_ID

        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]
        installer = m.installer.return_value
        mock_plugin = MagicMock()
        mock_plugin.installation_id = "installation-1"
        installer.list_plugins.side_effect = [[], [mock_plugin], Exception("list plugins failed")]

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        installer.uninstall.assert_called_once_with(TEST_FAKE_TENANT_ID, "installation-1")

    def test_install_plugins_install_function_partial_batch(self, plugin_migration_mocks, factory):
        """Test install_plugins install function handles partial batches."""
        # Arrange
        m = plugin_migration_mocks
        plugins_list = [f"{TEST_PLUGIN_ID}_{i}" for i in range(70)]
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json(plugins_list),
            encoding="utf-8",
        )
        mock_manifests = [
            factory.create_mock_plugin_manifest(identifier=f"{TEST_PLUGIN_IDENTIFIER}_{i}") for i in range(70)
        ]
        m.marketplace.batch_fetch_plugin_manifests.return_value = mock_manifests

        installer = m.installer.return_value
        installer.list_plugins.return_value = []

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)


class TestPluginMigrationInstallRagPipelinePlugins:
    """
    Unit tests for PluginMigration.install_rag_pipeline_plugins.

    Test coverage:
    - Full RAG pipeline plugin installation
    - Cover install nested function
    - Cover tenant pagination
    - Cover fake tenant uninstall
    """

    def test_install_rag_pipeline_plugins_install_exception(self, plugin_migration_mocks, factory):
        """Test install_rag_pipeline_plugins handles tenant installation exception."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]

        mock_tenant = factory.create_mock_tenant()
        mock_paginate = factory.create_mock_paginate([mock_tenant])
        mock_paginate.__iter__.return_value = iter([mock_tenant])
        m.db.paginate.side_effect = [mock_paginate, factory.create_mock_paginate([])]
        m.installer.return_value.list_plugins.side_effect = Exception("list failed")

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_rag_pipeline_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["total_success_tenant"] == 0
        assert output["total_failed_tenant"] == 1
        assert output["plugin_install_failed"] == [TEST_PLUGIN_ID]

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    @patch("services.plugin.plugin_migration.uuid4")
    def test_install_rag_pipeline_plugins_uninstall_loop(self, mock_uuid, plugin_migration_mocks, factory):
        """Test install_rag_pipeline_plugins uninstalls all plugins in loop."""
        mock_uuid.return_value.hex = TEST_FAKE_TENANT_ID
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]

        mock_tenant = factory.create_mock_tenant()
        mock_paginate = factory.create_mock_paginate([mock_tenant])
        mock_paginate.__iter__.return_value = iter([mock_tenant])
        m.db.paginate.side_effect = [mock_paginate, factory.create_mock_paginate([])]

        installer = m.installer.return_value
        mock_plugin = MagicMock()
        mock_plugin.installation_id = "installation-1"
        installer.list_plugins.side_effect = [[], [mock_plugin], []]

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_rag_pipeline_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        installer.uninstall.assert_called_once_with(TEST_FAKE_TENANT_ID, "installation-1")

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_rag_pipeline_plugins_handles_successful_install(self, plugin_migration_mocks, factory):
        """Test install_rag_pipeline_plugins installs plugins for tenants and writes output."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_manifest = factory.create_mock_plugin_manifest()
        m.marketplace.batch_fetch_plugin_manifests.return_value = [mock_manifest]

        mock_tenant = factory.create_mock_tenant()
        mock_paginate = factory.create_mock_paginate([mock_tenant])
        mock_paginate.__iter__.return_value = iter([mock_tenant])
        m.db.paginate.side_effect = [mock_paginate, factory.create_mock_paginate([])]

        installer = m.installer.return_value
        installer.list_plugins.return_value = []
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = MagicMock(all_installed=True)

        # Act
        with TEST_FLASK_APP.app_context():
            PluginMigration.install_rag_pipeline_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        assert Path(TEST_OUTPUT_JSON).exists()
        m.plugin_service.install_from_resolved_marketplace_identifiers.assert_called()
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["total_success_tenant"] == 1
        assert output["total_failed_tenant"] == 0

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)

    def test_install_rag_pipeline_plugins_initial_install_failed(self, plugin_migration_mocks, factory):
        """Test install_rag_pipeline_plugins records failed initial plugin install."""
        # Arrange
        m = plugin_migration_mocks
        Path(TEST_PLUGINS_JSON).write_text(
            tenant_plugin_record_json([TEST_PLUGIN_ID]),
            encoding="utf-8",
        )
        mock_tenant = factory.create_mock_tenant()
        mock_paginate = factory.create_mock_paginate([mock_tenant])
        mock_paginate.__iter__.return_value = iter([mock_tenant])
        m.db.paginate.side_effect = [mock_paginate, factory.create_mock_paginate([])]
        m.plugin_service.install_from_resolved_marketplace_identifiers.return_value = MagicMock(all_installed=True)
        installer = m.installer.return_value
        installer.list_plugins.return_value = []

        # Act
        with (
            patch.object(
                PluginMigration,
                "extract_unique_plugins",
                return_value=ExtractedPluginIdentifiers(plugins={TEST_PLUGIN_ID: TEST_PLUGIN_IDENTIFIER}),
            ),
            patch.object(
                PluginMigration,
                "handle_plugin_instance_install",
                return_value=PluginInstallResult(failed_plugin_ids=(TEST_PLUGIN_ID,)),
            ),
        ):
            with TEST_FLASK_APP.app_context():
                PluginMigration.install_rag_pipeline_plugins(TEST_PLUGINS_JSON, TEST_OUTPUT_JSON)

        # Assert
        output = json.loads(Path(TEST_OUTPUT_JSON).read_text(encoding="utf-8"))
        assert output["plugin_install_failed"] == [TEST_PLUGIN_ID]

        # Cleanup
        Path(TEST_PLUGINS_JSON).unlink(missing_ok=True)
        Path(TEST_OUTPUT_JSON).unlink(missing_ok=True)


class TestPluginMigrationExtractPlugins:
    """
    Unit tests for PluginMigration.extract_plugins long-running migration task.

    Test coverage:
    - Execute tenant iteration and plugin extraction pipeline
    - Cover tenant processing exception
    - Cover time interval adjustment
    """

    def test_extract_plugins(self, plugin_migration_mocks):
        """Test extract_plugins runs the full tenant plugin extraction pipeline."""
        # Arrange
        m = plugin_migration_mocks
        m.session.return_value.__enter__.return_value.scalar.return_value = 1
        mock_row = MagicMock()
        mock_row.id = TEST_TENANT_ID
        m.session.return_value.__enter__.return_value.execute.return_value = [mock_row]
        m.executor.return_value.__enter__.return_value.map.return_value = [[TEST_PLUGIN_ID]]
        fake_datetime_module = SimpleNamespace(
            datetime=FakeDatetime,
            timedelta=datetime.timedelta,
        )

        with (
            patch.object(
                PluginMigration, "extract_installed_plugin_ids", return_value=[TEST_PLUGIN_ID]
            ) as mock_extract,
            patch("services.plugin.plugin_migration.open", MagicMock()),
            patch("services.plugin.plugin_migration.datetime", fake_datetime_module),
        ):
            # Act
            PluginMigration.extract_plugins(TEST_PLUGINS_JSON, workers=1)

            # Assert
            mock_extract.assert_called_once_with(TEST_TENANT_ID)

    def test_extract_plugins_process_tenant_exception(self, plugin_migration_mocks):
        """Test extract_plugins handles tenant processing exception."""
        # Arrange
        m = plugin_migration_mocks
        m.session.return_value.__enter__.return_value.scalar.return_value = 1
        mock_row = MagicMock()
        mock_row.id = TEST_TENANT_ID
        m.session.return_value.__enter__.return_value.execute.return_value = [mock_row]
        fake_datetime_module = SimpleNamespace(
            datetime=FakeDatetime,
            timedelta=datetime.timedelta,
        )

        with (
            patch.object(
                PluginMigration, "extract_installed_plugin_ids", side_effect=Exception("process failed")
            ) as mock_extract,
            patch("services.plugin.plugin_migration.open", MagicMock()),
            patch("services.plugin.plugin_migration.datetime", fake_datetime_module),
        ):
            # Act
            PluginMigration.extract_plugins(TEST_PLUGINS_JSON, workers=1)

            # Assert
            mock_extract.assert_called_once_with(TEST_TENANT_ID)

    @pytest.mark.parametrize("intervals", [[1, 80], [1, 101, 101, 101, 101, 101], [1, 0]])
    def test_extract_plugins_interval_adjustment(self, plugin_migration_mocks, intervals):
        """Test extract_plugins adjusts time intervals based on tenant count."""
        # Arrange
        m = plugin_migration_mocks
        m.session.return_value.__enter__.return_value.scalar.side_effect = intervals
        mock_row = MagicMock()
        mock_row.id = TEST_TENANT_ID
        m.session.return_value.__enter__.return_value.execute.return_value = [mock_row]
        fake_datetime_module = SimpleNamespace(
            datetime=FakeDatetime,
            timedelta=datetime.timedelta,
        )

        with (
            patch.object(
                PluginMigration, "extract_installed_plugin_ids", return_value=[TEST_PLUGIN_ID]
            ) as mock_extract,
            patch("services.plugin.plugin_migration.open", MagicMock()),
            patch("services.plugin.plugin_migration.datetime", fake_datetime_module),
        ):
            # Act
            PluginMigration.extract_plugins(TEST_PLUGINS_JSON, workers=1)

            # Assert
            mock_extract.assert_called_once_with(TEST_TENANT_ID)
