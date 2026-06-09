from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
    WebsiteCrawlMessage,
)
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin


class TestWebsiteCrawlDatasourcePlugin:
    @pytest.fixture
    def mock_entity(self):
        entity = MagicMock(spec=DatasourceEntity)
        entity.identity = MagicMock()
        entity.identity.provider = "test-provider"
        entity.identity.name = "test-name"
        return entity

    @pytest.fixture
    def mock_runtime(self):
        runtime = MagicMock(spec=DatasourceRuntime)
        runtime.credentials = {"api_key": "test-key"}
        return runtime

    def test_init(self, mock_entity, mock_runtime):
        # Arrange
        tenant_id = "test-tenant-id"
        icon = "test-icon"
        plugin_unique_identifier = "test-plugin-id"

        # Act
        plugin = WebsiteCrawlDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        # Assert
        assert plugin.tenant_id == tenant_id
        assert plugin.plugin_unique_identifier == plugin_unique_identifier
        assert plugin.entity == mock_entity
        assert plugin.runtime == mock_runtime
        assert plugin.icon == icon

    def test_datasource_provider_type(self, mock_entity, mock_runtime):
        # Arrange
        plugin = WebsiteCrawlDatasourcePlugin(
            entity=mock_entity, runtime=mock_runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act & Assert
        assert plugin.datasource_provider_type() == DatasourceProviderType.WEBSITE_CRAWL

    def test_get_website_crawl(self, mock_entity, mock_runtime):
        # Arrange
        plugin = WebsiteCrawlDatasourcePlugin(
            entity=mock_entity,
            runtime=mock_runtime,
            tenant_id="test-tenant-id",
            icon="test-icon",
            plugin_unique_identifier="test-plugin-id",
        )

        user_id = "test-user-id"
        datasource_parameters = {"url": "https://example.com"}
        provider_type = "firecrawl"

        mock_message = MagicMock(spec=WebsiteCrawlMessage)

        # Mock PluginDatasourceManager
        with patch("core.datasource.website_crawl.website_crawl_plugin.PluginDatasourceManager") as mock_manager_class:
            mock_manager = mock_manager_class.return_value
            mock_manager.get_website_crawl.return_value = (msg for msg in [mock_message])

            # Act
            result = plugin.get_website_crawl(
                user_id=user_id, datasource_parameters=datasource_parameters, provider_type=provider_type
            )

            # Assert
            assert isinstance(result, Generator)
            messages = list(result)
            assert len(messages) == 1
            assert messages[0] == mock_message

            mock_manager.get_website_crawl.assert_called_once_with(
                tenant_id="test-tenant-id",
                user_id=user_id,
                datasource_provider="test-provider",
                datasource_name="test-name",
                credentials={"api_key": "test-key"},
                datasource_parameters=datasource_parameters,
                provider_type=provider_type,
            )
