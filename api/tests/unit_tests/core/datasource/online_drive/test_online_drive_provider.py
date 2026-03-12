from unittest.mock import MagicMock

import pytest

from core.datasource.entities.datasource_entities import DatasourceProviderEntityWithPlugin, DatasourceProviderType
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.online_drive.online_drive_provider import OnlineDriveDatasourcePluginProviderController


class TestOnlineDriveDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        plugin_id = "test_plugin_id"
        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        # Act
        controller = OnlineDriveDatasourcePluginProviderController(
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
        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        assert controller.provider_type == DatasourceProviderType.ONLINE_DRIVE

    def test_get_datasource_success(self):
        # Arrange
        mock_datasource_entity = MagicMock()
        mock_datasource_entity.identity.name = "test_datasource"

        mock_entity = MagicMock()
        mock_entity.datasources = [mock_datasource_entity]
        mock_entity.identity.icon = "test_icon"

        plugin_unique_identifier = "test_plugin_unique_identifier"
        tenant_id = "test_tenant_id"

        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier=plugin_unique_identifier, tenant_id=tenant_id
        )

        # Act
        datasource = controller.get_datasource("test_datasource")

        # Assert
        assert isinstance(datasource, OnlineDriveDatasourcePlugin)
        assert datasource.entity == mock_datasource_entity
        assert datasource.tenant_id == tenant_id
        assert datasource.icon == "test_icon"
        assert datasource.plugin_unique_identifier == plugin_unique_identifier
        assert datasource.runtime.tenant_id == tenant_id

    def test_get_datasource_not_found(self):
        # Arrange
        mock_datasource_entity = MagicMock()
        mock_datasource_entity.identity.name = "other_datasource"

        mock_entity = MagicMock()
        mock_entity.datasources = [mock_datasource_entity]

        controller = OnlineDriveDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="id", plugin_unique_identifier="unique_id", tenant_id="tenant"
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Datasource with name test_datasource not found"):
            controller.get_datasource("test_datasource")
