from unittest.mock import MagicMock, patch

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceIdentity,
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveDownloadFileRequest,
)
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin


class TestOnlineDriveDatasourcePlugin:
    def test_init(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        runtime = MagicMock(spec=DatasourceRuntime)
        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        # Act
        plugin = OnlineDriveDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        # Assert
        assert plugin.entity == entity
        assert plugin.runtime == runtime
        assert plugin.tenant_id == tenant_id
        assert plugin.icon == icon
        assert plugin.plugin_unique_identifier == plugin_unique_identifier

    def test_online_drive_browse_files(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        identity = MagicMock(spec=DatasourceIdentity)
        entity.identity = identity
        identity.provider = "test_provider"
        identity.name = "test_name"

        runtime = MagicMock(spec=DatasourceRuntime)
        runtime.credentials = {"token": "test_token"}

        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        plugin = OnlineDriveDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        user_id = "test_user"
        request = MagicMock(spec=OnlineDriveBrowseFilesRequest)
        provider_type = "test_type"

        mock_generator = MagicMock()

        with patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.online_drive_browse_files.return_value = mock_generator

            # Act
            result = plugin.online_drive_browse_files(user_id=user_id, request=request, provider_type=provider_type)

            # Assert
            assert result == mock_generator
            mock_manager_instance.online_drive_browse_files.assert_called_once_with(
                tenant_id=tenant_id,
                user_id=user_id,
                datasource_provider="test_provider",
                datasource_name="test_name",
                credentials=runtime.credentials,
                request=request,
                provider_type=provider_type,
            )

    def test_online_drive_download_file(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        identity = MagicMock(spec=DatasourceIdentity)
        entity.identity = identity
        identity.provider = "test_provider"
        identity.name = "test_name"

        runtime = MagicMock(spec=DatasourceRuntime)
        runtime.credentials = {"token": "test_token"}

        tenant_id = "test_tenant"
        icon = "test_icon"
        plugin_unique_identifier = "test_plugin_id"

        plugin = OnlineDriveDatasourcePlugin(
            entity=entity,
            runtime=runtime,
            tenant_id=tenant_id,
            icon=icon,
            plugin_unique_identifier=plugin_unique_identifier,
        )

        user_id = "test_user"
        request = MagicMock(spec=OnlineDriveDownloadFileRequest)
        provider_type = "test_type"

        mock_generator = MagicMock()

        with patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.online_drive_download_file.return_value = mock_generator

            # Act
            result = plugin.online_drive_download_file(user_id=user_id, request=request, provider_type=provider_type)

            # Assert
            assert result == mock_generator
            mock_manager_instance.online_drive_download_file.assert_called_once_with(
                tenant_id=tenant_id,
                user_id=user_id,
                datasource_provider="test_provider",
                datasource_name="test_name",
                credentials=runtime.credentials,
                request=request,
                provider_type=provider_type,
            )

    def test_datasource_provider_type(self):
        # Arrange
        entity = MagicMock(spec=DatasourceEntity)
        runtime = MagicMock(spec=DatasourceRuntime)
        plugin = OnlineDriveDatasourcePlugin(
            entity=entity, runtime=runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act
        result = plugin.datasource_provider_type()

        # Assert
        assert result == DatasourceProviderType.ONLINE_DRIVE
