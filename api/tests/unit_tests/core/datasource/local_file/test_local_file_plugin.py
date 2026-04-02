from unittest.mock import MagicMock

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceProviderType,
)
from core.datasource.local_file.local_file_plugin import LocalFileDatasourcePlugin


class TestLocalFileDatasourcePlugin:
    def test_init(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceEntity)
        mock_runtime = MagicMock(spec=DatasourceRuntime)
        tenant_id = "test-tenant-id"
        icon = "test-icon"
        plugin_unique_identifier = "test-plugin-id"

        # Act
        plugin = LocalFileDatasourcePlugin(
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

    def test_datasource_provider_type(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceEntity)
        mock_runtime = MagicMock(spec=DatasourceRuntime)
        plugin = LocalFileDatasourcePlugin(
            entity=mock_entity, runtime=mock_runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act & Assert
        assert plugin.datasource_provider_type() == DatasourceProviderType.LOCAL_FILE

    def test_get_icon_url(self):
        # Arrange
        mock_entity = MagicMock(spec=DatasourceEntity)
        mock_runtime = MagicMock(spec=DatasourceRuntime)
        icon = "test-icon"
        plugin = LocalFileDatasourcePlugin(
            entity=mock_entity, runtime=mock_runtime, tenant_id="test", icon=icon, plugin_unique_identifier="test"
        )

        # Act & Assert
        assert plugin.get_icon_url("any-tenant-id") == icon
