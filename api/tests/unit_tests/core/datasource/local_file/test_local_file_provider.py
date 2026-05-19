from unittest.mock import MagicMock

import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderType,
)
from core.datasource.local_file.local_file_plugin import LocalFileDatasourcePlugin
from core.datasource.local_file.local_file_provider import LocalFileDatasourcePluginProviderController


class TestLocalFileDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        plugin_id = "test_plugin_id"
        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        # Act
        controller = LocalFileDatasourcePluginProviderController(
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

    def test_provider_type(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        controller = LocalFileDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.LOCAL_FILE

    def test_validate_credentials(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        controller = LocalFileDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        # Should not raise any exception
        controller._validate_credentials("user_id", {"key": "value"})

    def test_get_datasource_success(self):
        # Arrange
        mock_datasource_entity = MagicMock()
        mock_datasource_entity.identity.name = "test_datasource"

        mock_entity = MagicMock()
        mock_entity.datasources = [mock_datasource_entity]
        mock_entity.identity.icon = "test_icon"

        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        controller = LocalFileDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier=plugin_unique_identifier, tenant_id=tenant_id
        )

        # Act
        datasource = controller.get_datasource("test_datasource")

        # Assert
        assert isinstance(datasource, LocalFileDatasourcePlugin)
        assert datasource.entity == mock_datasource_entity
        assert datasource.tenant_id == tenant_id
        assert datasource.icon == "test_icon"
        assert datasource.plugin_unique_identifier == plugin_unique_identifier

    def test_get_datasource_not_found(self):
        # Arrange
        mock_datasource_entity = MagicMock()
        mock_datasource_entity.identity.name = "other_datasource"

        mock_entity = MagicMock()
        mock_entity.datasources = [mock_datasource_entity]

        controller = LocalFileDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Datasource with name test_datasource not found"):
            controller.get_datasource("test_datasource")
