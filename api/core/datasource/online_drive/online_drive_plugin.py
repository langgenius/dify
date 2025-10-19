from collections.abc import Generator

from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_runtime import DatasourceRuntime
from core.datasource.entities.datasource_entities import (
    DatasourceEntity,
    DatasourceMessage,
    DatasourceProviderType,
    OnlineDriveBrowseFilesRequest,
    OnlineDriveBrowseFilesResponse,
    OnlineDriveDownloadFileRequest,
)
from core.plugin.impl.datasource import PluginDatasourceManager


class OnlineDriveDatasourcePlugin(DatasourcePlugin):
    tenant_id: str
    plugin_unique_identifier: str
    entity: DatasourceEntity
    runtime: DatasourceRuntime

    def __init__(
        self,
        entity: DatasourceEntity,
        runtime: DatasourceRuntime,
        tenant_id: str,
        icon: str,
        plugin_unique_identifier: str,
    ) -> None:
        super().__init__(entity, runtime, icon)
        self.tenant_id = tenant_id
        self.plugin_unique_identifier = plugin_unique_identifier

    def online_drive_browse_files(
        self,
        user_id: str,
        request: OnlineDriveBrowseFilesRequest,
        provider_type: str,
    ) -> Generator[OnlineDriveBrowseFilesResponse, None, None]:
        manager = PluginDatasourceManager()

        return manager.online_drive_browse_files(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            request=request,
            provider_type=provider_type,
        )

    def online_drive_download_file(
        self,
        user_id: str,
        request: OnlineDriveDownloadFileRequest,
        provider_type: str,
    ) -> Generator[DatasourceMessage, None, None]:
        manager = PluginDatasourceManager()

        return manager.online_drive_download_file(
            tenant_id=self.tenant_id,
            user_id=user_id,
            datasource_provider=self.entity.identity.provider,
            datasource_name=self.entity.identity.name,
            credentials=self.runtime.credentials,
            request=request,
            provider_type=provider_type,
        )

    def datasource_provider_type(self) -> str:
        return DatasourceProviderType.ONLINE_DRIVE
