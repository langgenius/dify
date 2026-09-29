from unittest.mock import MagicMock, patch

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from tests.unit_tests.core.datasource.factories import datasource_entity


class TestOnlineDocumentDatasourcePlugin:
    def test_init(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        # Act
        plugin = OnlineDocumentDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        # Assert
        assert plugin.entity == entity
        assert plugin.runtime == runtime
        assert plugin.tenant_id == tenant_id
        assert plugin.icon == icon
        assert plugin.plugin_unique_identifier == plugin_unique_identifier

    def test_get_online_document_pages(self):
        # Arrange
        entity = datasource_entity("test_name")
        entity.identity.provider = "test_provider"

        runtime = DatasourceRuntime(tenant_id="test_tenant")
        runtime.credentials = {"api_key": "test_key"}

        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        plugin = OnlineDocumentDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        user_id = "test_user"
        datasource_parameters = {"param": "value"}
        provider_type = "test_type"

        mock_generator = MagicMock()

        # Patch PluginDatasourceManager to isolate plugin behavior from external dependencies
        with patch("core.datasource.online_document.online_document_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.get_online_document_pages.return_value = mock_generator

            # Act
            result = plugin.get_online_document_pages(
                user_id=user_id, datasource_parameters=datasource_parameters, provider_type=provider_type
            )

            # Assert
            assert result == mock_generator
            mock_manager_instance.get_online_document_pages.assert_called_once_with(
                tenant_id=tenant_id,
                user_id=user_id,
                datasource_provider="test_provider",
                datasource_name="test_name",
                credentials=runtime.credentials,
                datasource_parameters=datasource_parameters,
                provider_type=provider_type,
            )

    def test_get_online_document_page_content(self):
        # Arrange
        entity = datasource_entity("test_name")
        entity.identity.provider = "test_provider"

        runtime = DatasourceRuntime(tenant_id="test_tenant")
        runtime.credentials = {"api_key": "test_key"}

        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        plugin = OnlineDocumentDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        user_id = "test_user"
        datasource_parameters = GetOnlineDocumentPageContentRequest(
            workspace_id="workspace-1", page_id="page-1", type="page"
        )
        provider_type = "test_type"

        mock_generator = MagicMock()

        with patch("core.datasource.online_document.online_document_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.get_online_document_page_content.return_value = mock_generator

            # Act
            result = plugin.get_online_document_page_content(
                user_id=user_id, datasource_parameters=datasource_parameters, provider_type=provider_type
            )

            # Assert
            assert result == mock_generator
            mock_manager_instance.get_online_document_page_content.assert_called_once_with(
                tenant_id=tenant_id,
                user_id=user_id,
                datasource_provider="test_provider",
                datasource_name="test_name",
                credentials=runtime.credentials,
                datasource_parameters=datasource_parameters,
                provider_type=provider_type,
            )

    def test_datasource_provider_type(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        plugin = OnlineDocumentDatasourcePlugin(
            entity=entity, runtime=runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act
        result = plugin.datasource_provider_type()

        # Assert
        assert result == DatasourceProviderType.ONLINE_DOCUMENT
