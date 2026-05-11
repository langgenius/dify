from unittest.mock import MagicMock

import pytest

from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderEntityWithPlugin,
    DatasourceProviderType,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_document.online_document_provider import OnlineDocumentDatasourcePluginProviderController


class TestOnlineDocumentDatasourcePluginProviderController:
    def test_init(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        plugin_id = "test_plugin_id"
        plugin_unique_identifier = "test_plugin_uid"
        tenant_id = "test_tenant_id"

        # Act
        controller = OnlineDocumentDatasourcePluginProviderController(
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
        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity, plugin_id="test", plugin_unique_identifier="test", tenant_id="test"
        )

        # Assert
        assert controller.provider_type == DatasourceProviderType.ONLINE_DOCUMENT

    def test_get_datasource_success(self):
        # Arrange
        from core.datasource.entities.datasource_entities import DatasourceIdentity

        mock_datasource_entity = MagicMock(spec=DatasourceEntity)
        mock_datasource_entity.identity = MagicMock(spec=DatasourceIdentity)
        mock_datasource_entity.identity.name = "target_datasource"

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.datasources = [mock_datasource_entity]
        mock_entity.identity = MagicMock()
        mock_entity.identity.icon = "test_icon"

        plugin_unique_identifier = "test_plugin_uid"
        tenant_id = "test_tenant_id"

        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id="test_plugin_id",
            plugin_unique_identifier=plugin_unique_identifier,
            tenant_id=tenant_id,
        )

        # Act
        result = controller.get_datasource("target_datasource")

        # Assert
        assert isinstance(result, OnlineDocumentDatasourcePlugin)
        assert result.entity == mock_datasource_entity
        assert result.tenant_id == tenant_id
        assert result.icon == "test_icon"
        assert result.plugin_unique_identifier == plugin_unique_identifier
        assert result.runtime.tenant_id == tenant_id

    def test_get_datasource_not_found(self):
        # Arrange
        from core.datasource.entities.datasource_entities import DatasourceIdentity

        mock_datasource_entity = MagicMock(spec=DatasourceEntity)
        mock_datasource_entity.identity = MagicMock(spec=DatasourceIdentity)
        mock_datasource_entity.identity.name = "other_datasource"

        mock_entity = MagicMock(spec=DatasourceProviderEntityWithPlugin)
        mock_entity.datasources = [mock_datasource_entity]

        controller = OnlineDocumentDatasourcePluginProviderController(
            entity=mock_entity,
            plugin_id="test_plugin_id",
            plugin_unique_identifier="test_plugin_uid",
            tenant_id="test_tenant_id",
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Datasource with name missing_datasource not found"):
            controller.get_datasource("missing_datasource")
