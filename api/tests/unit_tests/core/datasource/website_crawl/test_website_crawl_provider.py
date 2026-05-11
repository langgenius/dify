from unittest.mock import MagicMock, patch

import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderType,
)
from core.datasource.website_crawl.website_crawl_provider import WebsiteCrawlDatasourcePluginProviderController


class TestWebsiteCrawlDatasourcePluginProviderController:
    @pytest.fixture
    def mock_entity(self):
        entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        entity.datasources = []
        entity.identity = MagicMock()
        entity.identity.icon = "test-icon"
        return entity

    def test_init(self, mock_entity):
        # Arrange
        plugin_id = "test-plugin-id"
        plugin_unique_identifier = "test-unique-id"
        tenant_id = "test-tenant-id"

        # Act
        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id=plugin_id,
            plugin_unique_identifier=plugin_unique_identifier,
            tenant_id=tenant_id,
        )

        # Assert
        assert controller.entity == mock_entity
        assert controller.plugin_id == plugin_id
        assert controller.plugin_unique_identifier == plugin_unique_identifier
        assert controller.tenant_id == tenant_id

    def test_provider_type(self, mock_entity):
        # Arrange
        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.WEBSITE_CRAWL

    def test_get_datasource_success(self, mock_entity):
        # Arrange
        datasource_name = "test-datasource"
        tenant_id = "test-tenant-id"
        plugin_unique_identifier = "test-unique-id"

        mock_datasource_entity = MagicMock()
        mock_datasource_entity.identity = MagicMock()
        mock_datasource_entity.identity.name = datasource_name
        mock_entity.datasources = [mock_datasource_entity]

        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="test", plugin_unique_identifier=plugin_unique_identifier, tenant_id=tenant_id
        )

        # Act
        with patch(
            "core.datasource.website_crawl.website_crawl_provider.WebsiteCrawlDatasourcePlugin"
        ) as mock_plugin_class:
            mock_plugin_instance = mock_plugin_class.return_value
            result = controller.get_datasource(datasource_name)

            # Assert
            assert result == mock_plugin_instance
            mock_plugin_class.assert_called_once()
            args, kwargs = mock_plugin_class.call_args
            assert kwargs["entity"] == mock_datasource_entity
            assert isinstance(kwargs["runtime"], DatasourceRuntime)
            assert kwargs["runtime"].tenant_id == tenant_id
            assert kwargs["tenant_id"] == tenant_id
            assert kwargs["icon"] == "test-icon"
            assert kwargs["plugin_unique_identifier"] == plugin_unique_identifier

    def test_get_datasource_not_found(self, mock_entity):
        # Arrange
        datasource_name = "non-existent"
        mock_entity.datasources = []

        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Act & Assert
        with pytest.raises(ValueError, match=f"Datasource with name {datasource_name} not found"):
            controller.get_datasource(datasource_name)
