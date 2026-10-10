import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
)
from core.datasource.local_file.local_file_plugin import LocalFileDatasourcePlugin
from core.datasource.local_file.local_file_provider import LocalFileDatasourcePluginProviderController
from tests.unit_tests.core.datasource.factories import datasource_entity, provider_entity


class TestLocalFileDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        plugin_id = "test_plugin_id"
        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        # Act
        controller = LocalFileDatasourcePluginProviderController(
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
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        controller = LocalFileDatasourcePluginProviderController(
            entity=entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.LOCAL_FILE

    def test_validate_credentials(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        controller = LocalFileDatasourcePluginProviderController(
            entity=entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        # Should not raise any exception
        controller._validate_credentials("user_id", {"key": "value"})

    def test_get_datasource_success(self):
        # Arrange
        source = datasource_entity("test_datasource")
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.datasources = [source]
        entity.identity.icon = "test_icon"

        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        controller = LocalFileDatasourcePluginProviderController(
            entity=entity, plugin_id="id", plugin_unique_identifier=plugin_unique_identifier, tenant_id=tenant_id
        )

        # Act
        datasource = controller.get_datasource("test_datasource")

        # Assert
        assert isinstance(datasource, LocalFileDatasourcePlugin)
        assert datasource.entity == source
        assert datasource.tenant_id == tenant_id
        assert datasource.icon == "test_icon"
        assert datasource.plugin_unique_identifier == plugin_unique_identifier

    def test_get_datasource_not_found(self):
        # Arrange
        entity = provider_entity(DatasourceProviderType.LOCAL_FILE)
        entity.datasources = [datasource_entity("other_datasource")]

        controller = LocalFileDatasourcePluginProviderController(
            entity=entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Datasource with name test_datasource not found"):
            controller.get_datasource("test_datasource")
