from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceProviderType,
)
from core.datasource.local_file.local_file_plugin import LocalFileDatasourcePlugin
from tests.unit_tests.core.datasource.factories import datasource_entity


class TestLocalFileDatasourcePlugin:
    def test_init(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        tenant_id = "test-tenant-id"
        icon = "test-icon"
        plugin_unique_identifier = "test-plugin-id"

        # Act
        plugin = LocalFileDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        # Assert
        assert plugin.tenant_id == tenant_id
        assert plugin.plugin_unique_identifier == plugin_unique_identifier
        assert plugin.entity == entity
        assert plugin.runtime == runtime
        assert plugin.icon == icon

    def test_datasource_provider_type(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        plugin = LocalFileDatasourcePlugin(
            entity=entity, runtime=runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act & Assert
        assert plugin.datasource_provider_type() == DatasourceProviderType.LOCAL_FILE

    def test_get_icon_url(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        icon = "test-icon"
        plugin = LocalFileDatasourcePlugin(
            entity=entity, runtime=runtime, tenant_id="test", icon=icon, plugin_unique_identifier="test"
        )

        # Act & Assert
        assert plugin.get_icon_url("any-tenant-id") == icon
