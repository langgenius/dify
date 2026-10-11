import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
)
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from core.datasource.website_crawl.website_crawl_provider import WebsiteCrawlDatasourcePluginProviderController
from tests.unit_tests.core.datasource.factories import datasource_entity, provider_entity


class TestWebsiteCrawlDatasourcePluginProviderController:
    @pytest.fixture
    def entity(self):
        entity = provider_entity(DatasourceProviderType.WEBSITE_CRAWL)
        entity.datasources = []
        entity.identity.icon = "test-icon"
        return entity

    def test_init(self, entity):
        # Arrange
        plugin_id = "test-plugin-id"
        plugin_unique_identifier = "test-unique-id"
        tenant_id = "test-tenant-id"

        # Act
        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=entity,
            plugin_id=plugin_id,
            plugin_unique_identifier=plugin_unique_identifier,
            tenant_id=tenant_id,
        )

        # Assert
        assert controller.entity == entity
        assert controller.plugin_id == plugin_id
        assert controller.plugin_unique_identifier == plugin_unique_identifier
        assert controller.tenant_id == tenant_id

    def test_provider_type(self, entity):
        # Arrange
        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.WEBSITE_CRAWL

    def test_get_datasource_success(self, entity):
        # Arrange
        datasource_name = "test-datasource"
        tenant_id = "test-tenant-id"
        plugin_unique_identifier = "test-unique-id"

        source = datasource_entity(datasource_name)
        entity.datasources = [source]

        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=entity, plugin_id="test", plugin_unique_identifier=plugin_unique_identifier, tenant_id=tenant_id
        )

        # Act
        result = controller.get_datasource(datasource_name)

        # Assert
        assert isinstance(result, WebsiteCrawlDatasourcePlugin)
        assert result.entity is source
        assert isinstance(result.runtime, DatasourceRuntime)
        assert result.runtime.tenant_id == tenant_id
        assert result.tenant_id == tenant_id
        assert result.icon == "test-icon"
        assert result.plugin_unique_identifier == plugin_unique_identifier

    def test_get_datasource_not_found(self, entity):
        # Arrange
        datasource_name = "non-existent"
        entity.datasources = []

        controller = WebsiteCrawlDatasourcePluginProviderController(
            entity=entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Act & Assert
        with pytest.raises(ValueError, match=f"Datasource with name {datasource_name} not found"):
            controller.get_datasource(datasource_name)
