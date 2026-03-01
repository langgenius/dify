import logging
from collections.abc import Generator
from threading import Lock
from typing import Any, cast

from sqlalchemy import select

import contexts
from core.datasource.__base.datasource_plugin import DatasourcePlugin
from core.datasource.__base.datasource_provider import DatasourcePluginProviderController
from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDriveDownloadFileRequest,
)
from core.datasource.errors import DatasourceProviderNotFoundError
from core.datasource.local_file.local_file_provider import LocalFileDatasourcePluginProviderController
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_document.online_document_provider import OnlineDocumentDatasourcePluginProviderController
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.online_drive.online_drive_provider import OnlineDriveDatasourcePluginProviderController
from core.datasource.utils.message_transformer import DatasourceFileMessageTransformer
from core.datasource.website_crawl.website_crawl_provider import WebsiteCrawlDatasourcePluginProviderController
from core.db.session_factory import session_factory
from core.plugin.impl.datasource import PluginDatasourceManager
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import WorkflowNodeExecutionMetadataKey
from core.workflow.file import File
from core.workflow.file.enums import FileTransferMethod, FileType
from core.workflow.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from core.workflow.repositories.datasource_manager_protocol import DatasourceParameter, OnlineDriveDownloadFileParam
from factories import file_factory
from models.model import UploadFile
from models.tools import ToolFile
from services.datasource_provider_service import DatasourceProviderService

logger = logging.getLogger(__name__)


class DatasourceManager:
    @classmethod
    def get_datasource_plugin_provider(
        cls, provider_id: str, tenant_id: str, datasource_type: DatasourceProviderType
    ) -> DatasourcePluginProviderController:
        """
        get the datasource plugin provider
        """
        # check if context is set
        try:
            contexts.datasource_plugin_providers.get()
        except LookupError:
            contexts.datasource_plugin_providers.set({})
            contexts.datasource_plugin_providers_lock.set(Lock())

        with contexts.datasource_plugin_providers_lock.get():
            datasource_plugin_providers = contexts.datasource_plugin_providers.get()
            if provider_id in datasource_plugin_providers:
                return datasource_plugin_providers[provider_id]

            manager = PluginDatasourceManager()
            provider_entity = manager.fetch_datasource_provider(tenant_id, provider_id)
            if not provider_entity:
                raise DatasourceProviderNotFoundError(f"plugin provider {provider_id} not found")
            controller: DatasourcePluginProviderController | None = None
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    controller = OnlineDocumentDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.ONLINE_DRIVE:
                    controller = OnlineDriveDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.WEBSITE_CRAWL:
                    controller = WebsiteCrawlDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case DatasourceProviderType.LOCAL_FILE:
                    controller = LocalFileDatasourcePluginProviderController(
                        entity=provider_entity.declaration,
                        plugin_id=provider_entity.plugin_id,
                        plugin_unique_identifier=provider_entity.plugin_unique_identifier,
                        tenant_id=tenant_id,
                    )
                case _:
                    raise ValueError(f"Unsupported datasource type: {datasource_type}")

            if controller:
                datasource_plugin_providers[provider_id] = controller

        if controller is None:
            raise DatasourceProviderNotFoundError(f"Datasource provider {provider_id} not found.")

        return controller

    @classmethod
    def get_datasource_runtime(
        cls,
        provider_id: str,
        datasource_name: str,
        tenant_id: str,
        datasource_type: DatasourceProviderType,
    ) -> DatasourcePlugin:
        """
        get the datasource runtime

        :param provider_type: the type of the provider
        :param provider_id: the id of the provider
        :param datasource_name: the name of the datasource
        :param tenant_id: the tenant id

        :return: the datasource plugin
        """
        return cls.get_datasource_plugin_provider(
            provider_id,
            tenant_id,
            datasource_type,
        ).get_datasource(datasource_name)

    @classmethod
    def get_icon_url(cls, provider_id: str, tenant_id: str, datasource_name: str, datasource_type: str) -> str:
        datasource_runtime = cls.get_datasource_runtime(
            provider_id=provider_id,
            datasource_name=datasource_name,
            tenant_id=tenant_id,
            datasource_type=DatasourceProviderType.value_of(datasource_type),
        )
        return datasource_runtime.get_icon_url(tenant_id)

    @classmethod
    def stream_online_results(
        cls,
        *,
        user_id: str,
        datasource_name: str,
        datasource_type: str,
        provider_id: str,
        tenant_id: str,
        provider: str,
        plugin_id: str,
        credential_id: str,
        datasource_param: DatasourceParameter | None = None,
        online_drive_request: OnlineDriveDownloadFileParam | None = None,
    ) -> Generator[DatasourceMessage, None, Any]:
        """
        Pull-based streaming of domain messages from datasource plugins.
        Returns a generator that yields DatasourceMessage and finally returns a minimal final payload.
        Only ONLINE_DOCUMENT and ONLINE_DRIVE are streamable here; other types are handled by nodes directly.
        """
        ds_type = DatasourceProviderType.value_of(datasource_type)
        runtime = cls.get_datasource_runtime(
            provider_id=provider_id,
            datasource_name=datasource_name,
            tenant_id=tenant_id,
            datasource_type=ds_type,
        )

        dsp_service = DatasourceProviderService()
        credentials = dsp_service.get_datasource_credentials(
            tenant_id=tenant_id,
            provider=provider,
            plugin_id=plugin_id,
            credential_id=credential_id,
        )

        if ds_type == DatasourceProviderType.ONLINE_DOCUMENT:
            doc_runtime = cast(OnlineDocumentDatasourcePlugin, runtime)
            if credentials:
                doc_runtime.runtime.credentials = credentials
            if datasource_param is None:
                raise ValueError("datasource_param is required for ONLINE_DOCUMENT streaming")
            inner_gen: Generator[DatasourceMessage, None, None] = doc_runtime.get_online_document_page_content(
                user_id=user_id,
                datasource_parameters=GetOnlineDocumentPageContentRequest(
                    workspace_id=datasource_param.workspace_id,
                    page_id=datasource_param.page_id,
                    type=datasource_param.type,
                ),
                provider_type=ds_type,
            )
        elif ds_type == DatasourceProviderType.ONLINE_DRIVE:
            drive_runtime = cast(OnlineDriveDatasourcePlugin, runtime)
            if credentials:
                drive_runtime.runtime.credentials = credentials
            if online_drive_request is None:
                raise ValueError("online_drive_request is required for ONLINE_DRIVE streaming")
            inner_gen = drive_runtime.online_drive_download_file(
                user_id=user_id,
                request=OnlineDriveDownloadFileRequest(
                    id=online_drive_request.id,
                    bucket=online_drive_request.bucket,
                ),
                provider_type=ds_type,
            )
        else:
            raise ValueError(f"Unsupported datasource type for streaming: {ds_type}")

        # Bridge through to caller while preserving generator return contract
        yield from inner_gen
        # No structured final data here; node/adapter will assemble outputs
        return {}

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
    ) -> Generator[StreamChunkEvent | StreamCompletedEvent, None, None]:
        ds_type = DatasourceProviderType.value_of(datasource_type)

        messages = cls.stream_online_results(
            user_id=user_id,
            datasource_name=datasource_name,
            datasource_type=datasource_type,
            provider_id=provider_id,
            tenant_id=tenant_id,
            provider=provider,
            plugin_id=plugin_id,
            credential_id=credential_id,
            datasource_param=datasource_param,
            online_drive_request=online_drive_request,
        )

        transformed = DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
            messages=messages, user_id=user_id, tenant_id=tenant_id, conversation_id=None
        )

        variables: dict[str, Any] = {}
        file_out: File | None = None

        for message in transformed:
            mtype = message.type
            if mtype in {
                DatasourceMessage.MessageType.IMAGE_LINK,
                DatasourceMessage.MessageType.BINARY_LINK,
                DatasourceMessage.MessageType.IMAGE,
            }:
                wanted_ds_type = ds_type in {
                    DatasourceProviderType.ONLINE_DRIVE,
                    DatasourceProviderType.ONLINE_DOCUMENT,
                }
                if wanted_ds_type and isinstance(message.message, DatasourceMessage.TextMessage):
                    url = message.message.text

                    datasource_file_id = str(url).split("/")[-1].split(".")[0]
                    with session_factory.create_session() as session:
                        stmt = select(ToolFile).where(
                            ToolFile.id == datasource_file_id, ToolFile.tenant_id == tenant_id
                        )
                        datasource_file = session.scalar(stmt)
                        if not datasource_file:
                            raise ValueError(
                                f"ToolFile not found for file_id={datasource_file_id}, tenant_id={tenant_id}"
                            )
                        mime_type = datasource_file.mimetype
                    if datasource_file is not None:
                        mapping = {
                            "tool_file_id": datasource_file_id,
                            "type": file_factory.get_file_type_by_mime_type(mime_type),
                            "transfer_method": FileTransferMethod.TOOL_FILE,
                            "url": url,
                        }
                        file_out = file_factory.build_from_mapping(mapping=mapping, tenant_id=tenant_id)
            elif mtype == DatasourceMessage.MessageType.TEXT:
                assert isinstance(message.message, DatasourceMessage.TextMessage)
                yield StreamChunkEvent(selector=[node_id, "text"], chunk=message.message.text, is_final=False)
            elif mtype == DatasourceMessage.MessageType.LINK:
                assert isinstance(message.message, DatasourceMessage.TextMessage)
                yield StreamChunkEvent(
                    selector=[node_id, "text"], chunk=f"Link: {message.message.text}\n", is_final=False
                )
            elif mtype == DatasourceMessage.MessageType.VARIABLE:
                assert isinstance(message.message, DatasourceMessage.VariableMessage)
                name = message.message.variable_name
                value = message.message.variable_value
                if message.message.stream:
                    assert isinstance(value, str), "stream variable_value must be str"
                    variables[name] = variables.get(name, "") + value
                    yield StreamChunkEvent(selector=[node_id, name], chunk=value, is_final=False)
                else:
                    variables[name] = value
            elif mtype == DatasourceMessage.MessageType.FILE:
                if ds_type == DatasourceProviderType.ONLINE_DRIVE and message.meta:
                    f = message.meta.get("file")
                    if isinstance(f, File):
                        file_out = f
            else:
                pass

        yield StreamChunkEvent(selector=[node_id, "text"], chunk="", is_final=True)

        if ds_type == DatasourceProviderType.ONLINE_DRIVE and file_out is not None:
            variable_pool.add([node_id, "file"], file_out)

        if ds_type == DatasourceProviderType.ONLINE_DOCUMENT:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    outputs={**variables},
                )
            )
        else:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    outputs={
                        "file": file_out,
                        "datasource_type": ds_type,
                    },
                )
            )

    @classmethod
    def get_upload_file_by_id(cls, file_id: str, tenant_id: str) -> File:
        with session_factory.create_session() as session:
            upload_file = (
                session.query(UploadFile).where(UploadFile.id == file_id, UploadFile.tenant_id == tenant_id).first()
            )
            if not upload_file:
                raise ValueError(f"UploadFile not found for file_id={file_id}, tenant_id={tenant_id}")

        file_info = File(
            id=upload_file.id,
            filename=upload_file.name,
            extension="." + upload_file.extension,
            mime_type=upload_file.mime_type,
            tenant_id=tenant_id,
            type=FileType.CUSTOM,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            remote_url=upload_file.source_url,
            related_id=upload_file.id,
            size=upload_file.size,
            storage_key=upload_file.key,
            url=upload_file.source_url,
        )
        return file_info
