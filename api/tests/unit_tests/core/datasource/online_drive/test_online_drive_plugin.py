from unittest.mock import patch

from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
)
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from tests.unit_tests.core.datasource.factories import datasource_entity


class TestOnlineDriveDatasourcePlugin:
    def test_init(self):
        # Arrange
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
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
        entity = datasource_entity("test_name")
        entity.identity.provider = "test_provider"

        runtime = DatasourceRuntime(tenant_id="test_tenant")
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
        request = OnlineDriveBrowseFilesRequest(prefix="folder-1")
        provider_type = "test_type"

        messages = [OnlineDriveBrowseFilesResponse(result=[])]
        response_stream = (message for message in messages)

        with patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.online_drive_browse_files.return_value = response_stream

            # Act
            result = plugin.online_drive_browse_files(user_id=user_id, request=request, provider_type=provider_type)

            # Assert
            assert result is response_stream
            assert list(result) == messages
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
        entity = datasource_entity("test_name")
        entity.identity.provider = "test_provider"

        runtime = DatasourceRuntime(tenant_id="test_tenant")
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
        request = OnlineDriveDownloadFileRequest(id="file-1")
        provider_type = "test_type"

        messages = [DatasourceMessage(type="text", message=DatasourceMessage.TextMessage(text="document content"))]
        response_stream = (message for message in messages)

        with patch("core.datasource.online_drive.online_drive_plugin.PluginDatasourceManager") as MockManager:
            mock_manager_instance = MockManager.return_value
            mock_manager_instance.online_drive_download_file.return_value = response_stream

            # Act
            result = plugin.online_drive_download_file(user_id=user_id, request=request, provider_type=provider_type)

            # Assert
            assert result is response_stream
            assert list(result) == messages
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
        entity = datasource_entity("test_name")
        runtime = DatasourceRuntime(tenant_id="test_tenant")
        plugin = OnlineDriveDatasourcePlugin(
            entity=entity, runtime=runtime, tenant_id="test", icon="test", plugin_unique_identifier="test"
        )

        # Act
        result = plugin.datasource_provider_type()

        # Assert
        assert result == DatasourceProviderType.ONLINE_DRIVE
