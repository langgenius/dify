from collections.abc import Callable

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceProviderType
from tests.unit_tests.core.datasource.factories import datasource_entity


class ConcreteDatasourcePlugin(DatasourcePlugin):
    """
    Concrete implementation of DatasourcePlugin for testing purposes.
    Since DatasourcePlugin is an ABC, we need a concrete class to instantiate it.
    """

    def datasource_provider_type(self) -> str:
        return DatasourceProviderType.LOCAL_FILE


class TestDatasourcePlugin:
    def test_init(self):
        # Arrange
        entity = datasource_entity("test_datasource")
        runtime = DatasourceRuntime(tenant_id="tenant-1")
        icon = "test-icon.png"

        # Act
        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        # Assert
        assert plugin.entity == entity
        assert plugin.runtime == runtime
        assert plugin.icon == icon

    def test_datasource_provider_type(self):
        # Arrange
        entity = datasource_entity("test_datasource")
        runtime = DatasourceRuntime(tenant_id="tenant-1")
        icon = "test-icon.png"
        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        # Act
        provider_type = plugin.datasource_provider_type()
        # Call the base class method to ensure it's covered
        base_provider_type = DatasourcePlugin.datasource_provider_type(plugin)

        # Assert
        assert provider_type == DatasourceProviderType.LOCAL_FILE
        assert base_provider_type == DatasourceProviderType.LOCAL_FILE

    def test_fork_datasource_runtime(self):
        # Arrange
        entity = datasource_entity("test_datasource")

        runtime = DatasourceRuntime(tenant_id="tenant-1")
        new_runtime = DatasourceRuntime(tenant_id="tenant-2", credentials={"token": "new-token"})
        icon = "test-icon.png"

        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        # Act
        new_plugin = plugin.fork_datasource_runtime(new_runtime)

        # Assert
        assert isinstance(new_plugin, ConcreteDatasourcePlugin)
        assert new_plugin.entity == entity
        assert new_plugin.entity is not entity
        assert new_plugin.runtime is new_runtime
        assert new_plugin.icon == icon
        assert plugin.runtime is runtime
        assert plugin.runtime.credentials == {}

    def test_get_icon_url(self, config_overrides: Callable[..., None]):
        config_overrides(CONSOLE_API_URL="https://api.dify.ai")
        # Arrange
        entity = datasource_entity("test_datasource")
        runtime = DatasourceRuntime(tenant_id="tenant-1")
        icon = "test-icon.png"
        tenant_id = "test-tenant-id"

        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        icon_url = plugin.get_icon_url(tenant_id)

        expected_url = (
            f"https://api.dify.ai/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename={icon}"
        )
        assert icon_url == expected_url
