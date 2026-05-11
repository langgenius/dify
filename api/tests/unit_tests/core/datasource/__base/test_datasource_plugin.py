from unittest.mock import MagicMock, patch

from configs import dify_config
from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import DatasourceEntity, DatasourceProviderType


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
        entity = MagicMock(spec=DatasourceEntity)
        runtime = MagicMock(spec=DatasourceRuntime)
        icon = "test-icon.png"

        # Act
        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        # Assert
        assert plugin.entity == entity
        assert plugin.runtime == runtime
        assert plugin.icon == icon

    def test_datasource_provider_type(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        runtime = MagicMock(spec=DatasourceRuntime)
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
        mock_entity = MagicMock(spec=DatasourceEntity)
        mock_entity_copy = MagicMock(spec=DatasourceEntity)
        mock_entity.model_copy.return_value = mock_entity_copy

        runtime = MagicMock(spec=DatasourceRuntime)
        new_runtime = MagicMock(spec=DatasourceRuntime)
        icon = "test-icon.png"

        plugin = ConcreteDatasourcePlugin(entity=mock_entity, runtime=runtime, icon=icon)

        # Act
        new_plugin = plugin.fork_datasource_runtime(new_runtime)

        # Assert
        assert isinstance(new_plugin, ConcreteDatasourcePlugin)
        assert new_plugin.entity == mock_entity_copy
        assert new_plugin.runtime == new_runtime
        assert new_plugin.icon == icon
        mock_entity.model_copy.assert_called_once()

    def test_get_icon_url(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        runtime = MagicMock(spec=DatasourceRuntime)
        icon = "test-icon.png"
        tenant_id = "test-tenant-id"

        plugin = ConcreteDatasourcePlugin(entity=entity, runtime=runtime, icon=icon)

        # Mocking dify_config.CONSOLE_API_URL
        with patch.object(dify_config, "CONSOLE_API_URL", "https://api.dify.ai"):
            # Act
            icon_url = plugin.get_icon_url(tenant_id)

            # Assert
            expected_url = (
                f"https://api.dify.ai/console/api/workspaces/current/plugin/icon?tenant_id={tenant_id}&filename={icon}"
            )
            assert icon_url == expected_url
