import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_document.online_document_provider import OnlineDocumentDatasourcePluginProviderController
from tests.unit_tests.core.datasource.factories import datasource_entity, provider_entity


class TestOnlineDocumentDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        plugin_id = "test_plugin_id"
        plugin_unique_identifier = "test_plugin_uid"
        tenant_id = "test_tenant_id"

        # Act
        controller = OnlineDocumentDatasourcePluginProviderController(
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

    def test_provider_type(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Assert
        assert controller.provider_type == DatasourceProviderType.ONLINE_DOCUMENT

    def test_get_datasource_success(self):
        # Arrange
        source = datasource_entity("target_datasource")

        entity = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        entity.datasources = [source]
        entity.identity.icon = "test_icon"

        plugin_unique_identifier = "test_plugin_uid"
        tenant_id = "test_tenant_id"

        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity,
            plugin_id="test_plugin_id",
            plugin_unique_identifier=plugin_unique_identifier,
            tenant_id=tenant_id,
        )

        # Act
        result = controller.get_datasource("target_datasource")

        # Assert
        assert isinstance(result, OnlineDocumentDatasourcePlugin)
        assert result.entity == source
        assert result.tenant_id == tenant_id
        assert result.icon == "test_icon"
        assert result.plugin_unique_identifier == plugin_unique_identifier
        assert result.runtime.tenant_id == tenant_id

    def test_get_datasource_not_found(self):
        # Arrange
        source = datasource_entity("other_datasource")

        entity = provider_entity(DatasourceProviderType.ONLINE_DOCUMENT)
        entity.datasources = [source]

        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=entity,
            plugin_id="test_plugin_id",
            plugin_unique_identifier="test_plugin_uid",
            tenant_id="test_tenant_id",
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Datasource with name missing_datasource not found"):
            controller.get_datasource("missing_datasource")
