from unittest.mock import MagicMock, patch

import pytest

from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.datasource.errors import DatasourceProviderNotFoundError


class TestDatasourceManager:
    @pytest.fixture
    def mock_contexts(self):
        with patch("core.datasource.datasource_manager.contexts") as mock:
            # Setup default behavior for contexts
            mock.datasource_plugin_providers = MagicMock()
            mock.datasource_plugin_providers_lock = MagicMock()

            # Default: context is set
            mock.datasource_plugin_providers.get.return_value = {}

            # Setup lock as context manager
            mock_lock = MagicMock()
            mock_lock.__enter__.return_value = mock_lock
            mock_lock.__exit__.return_value = None
            mock.datasource_plugin_providers_lock.get.return_value = mock_lock

            yield mock

    @pytest.fixture
    def mock_plugin_manager(self):
        with patch("core.datasource.datasource_manager.PluginDatasourceManager") as mock_cls:
            mock_inst = mock_cls.return_value
            yield mock_inst

    def test_get_datasource_plugin_provider_cache_hit(self, mock_contexts):
        # Setup
        provider_id = "p1"
        tenant_id = "t1"
        datasource_type = DatasourceProviderType.LOCAL_FILE

        mock_controller = MagicMock()
        mock_contexts.datasource_plugin_providers.get.return_value = {provider_id: mock_controller}

        # Execute
        result = DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)

        # Verify
        assert result == mock_controller
        mock_contexts.datasource_plugin_providers.get.assert_called()

    def test_get_datasource_plugin_provider_lookup_error_init(self, mock_contexts, mock_plugin_manager):
        # Setup
        provider_id = "p1"
        tenant_id = "t1"
        datasource_type = DatasourceProviderType.LOCAL_FILE

        # First call raises LookupError, subsequent calls return empty dict
        cache = {}
        mock_contexts.datasource_plugin_providers.get.side_effect = [LookupError(), cache]

        provider_entity = MagicMock()
        mock_plugin_manager.fetch_datasource_provider.return_value = provider_entity

        with patch("core.datasource.datasource_manager.LocalFileDatasourcePluginProviderController") as mock_ctrl_cls:
            mock_ctrl_inst = mock_ctrl_cls.return_value

            # Execute
            result = DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)

            # Verify
            assert result == mock_ctrl_inst
            mock_contexts.datasource_plugin_providers.set.assert_called_once_with({})
            mock_contexts.datasource_plugin_providers_lock.set.assert_called_once()
            assert cache[provider_id] == mock_ctrl_inst

    def test_get_datasource_plugin_provider_not_found(self, mock_contexts, mock_plugin_manager):
        # Setup
        provider_id = "unknown"
        tenant_id = "t1"
        datasource_type = DatasourceProviderType.LOCAL_FILE

        mock_plugin_manager.fetch_datasource_provider.return_value = None

        # Execute & Verify
        with pytest.raises(DatasourceProviderNotFoundError, match=f"plugin provider {provider_id} not found"):
            DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)

    @pytest.mark.parametrize(
        ("datasource_type", "controller_class_path"),
        [
            (
                DatasourceProviderType.ONLINE_DOCUMENT,
                "core.datasource.datasource_manager.OnlineDocumentDatasourcePluginProviderController",
            ),
            (
                DatasourceProviderType.ONLINE_DRIVE,
                "core.datasource.datasource_manager.OnlineDriveDatasourcePluginProviderController",
            ),
            (
                DatasourceProviderType.WEBSITE_CRAWL,
                "core.datasource.datasource_manager.WebsiteCrawlDatasourcePluginProviderController",
            ),
            (
                DatasourceProviderType.LOCAL_FILE,
                "core.datasource.datasource_manager.LocalFileDatasourcePluginProviderController",
            ),
        ],
    )
    def test_get_datasource_plugin_provider_types(
        self, mock_contexts, mock_plugin_manager, datasource_type, controller_class_path
    ):
        # Setup
        provider_id = "p1"
        tenant_id = "t1"

        provider_entity = MagicMock()
        provider_entity.declaration = "decl"
        provider_entity.plugin_id = "pid"
        provider_entity.plugin_unique_identifier = "puid"
        mock_plugin_manager.fetch_datasource_provider.return_value = provider_entity

        with patch(controller_class_path) as mock_ctrl_cls:
            mock_ctrl_inst = mock_ctrl_cls.return_value

            # Execute
            result = DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)

            # Verify
            assert result == mock_ctrl_inst
            mock_ctrl_cls.assert_called_once_with(
                entity="decl", plugin_id="pid", plugin_unique_identifier="puid", tenant_id=tenant_id
            )

    def test_get_datasource_plugin_provider_unsupported_type(self, mock_contexts, mock_plugin_manager):
        # Setup
        provider_id = "p1"
        tenant_id = "t1"
        datasource_type = "INVALID_TYPE"

        provider_entity = MagicMock()
        mock_plugin_manager.fetch_datasource_provider.return_value = provider_entity

        # Execute & Verify
        with pytest.raises(ValueError, match=f"Unsupported datasource type: {datasource_type}"):
            DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)

    def test_get_datasource_runtime(self, mock_contexts):
        # Setup
        provider_id = "p1"
        datasource_name = "ds1"
        tenant_id = "t1"
        datasource_type = DatasourceProviderType.LOCAL_FILE

        mock_controller = MagicMock()
        mock_datasource = MagicMock()
        mock_controller.get_datasource.return_value = mock_datasource

        with patch.object(
            DatasourceManager, "get_datasource_plugin_provider", return_value=mock_controller
        ) as mock_get_provider:
            # Execute
            result = DatasourceManager.get_datasource_runtime(provider_id, datasource_name, tenant_id, datasource_type)

            # Verify
            assert result == mock_datasource
            mock_get_provider.assert_called_once_with(provider_id, tenant_id, datasource_type)
            mock_controller.get_datasource.assert_called_once_with(datasource_name)

    def test_get_datasource_plugin_provider_controller_none_final_check(self, mock_contexts, mock_plugin_manager):
        # Setup
        provider_id = "p1"
        tenant_id = "t1"
        datasource_type = DatasourceProviderType.LOCAL_FILE

        provider_entity = MagicMock()
        mock_plugin_manager.fetch_datasource_provider.return_value = provider_entity

        # Patch the controller class to return None, which would lead to controller being None
        with patch("core.datasource.datasource_manager.LocalFileDatasourcePluginProviderController", return_value=None):
            # Execute & Verify
            with pytest.raises(DatasourceProviderNotFoundError, match=f"Datasource provider {provider_id} not found."):
                DatasourceManager.get_datasource_plugin_provider(provider_id, tenant_id, datasource_type)
