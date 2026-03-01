from collections.abc import Generator
from typing import Any, Protocol

from pydantic import BaseModel

from core.workflow.file import File
from core.workflow.node_events import StreamChunkEvent, StreamCompletedEvent


class DatasourceParameter(BaseModel):
    workspace_id: str
    page_id: str
    type: str


class OnlineDriveDownloadFileParam(BaseModel):
    id: str
    bucket: str


class DatasourceFinal(BaseModel):
    data: dict[str, Any] | None = None


class DatasourceManagerProtocol(Protocol):
    @classmethod
    def get_icon_url(cls, provider_id: str, tenant_id: str, datasource_name: str, datasource_type: str) -> str: ...

    @classmethod
    def stream_node_events(
        cls,
        *,
        node_id: str,
        user_id: str,
        datasource_name: str,
        datasource_type: str,
        provider_id: str,
        tenant_id: str,
        provider: str,
        plugin_id: str,
        credential_id: str,
        parameters_for_log: dict[str, Any],
        datasource_info: dict[str, Any],
        variable_pool: Any,
        datasource_param: DatasourceParameter | None = None,
        online_drive_request: OnlineDriveDownloadFileParam | None = None,
    ) -> Generator[StreamChunkEvent | StreamCompletedEvent, None, None]: ...

    @classmethod
    def get_upload_file_by_id(cls, file_id: str, tenant_id: str) -> File: ...
