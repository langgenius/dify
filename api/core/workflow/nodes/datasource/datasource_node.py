from collections.abc import Generator, Mapping, Sequence
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.datasource.entities.datasource_entities import (
    DatasourceMessage,
    DatasourceParameter,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    OnlineDriveDownloadFileRequest,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.online_drive.online_drive_plugin import OnlineDriveDatasourcePlugin
from core.datasource.utils.message_transformer import DatasourceFileMessageTransformer
from core.file import File
from core.file.enums import FileTransferMethod, FileType
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.variables.segments import ArrayAnySegment
from core.variables.variables import ArrayAnyVariable
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.nodes.tool.exc import ToolFileError
from core.workflow.runtime import VariablePool
from extensions.ext_database import db
from factories import file_factory
from models.model import UploadFile
from models.tools import ToolFile
from services.datasource_provider_service import DatasourceProviderService

from ...entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from .entities import DatasourceNodeData
from .exc import DatasourceNodeError, DatasourceParameterError


class DatasourceNode(Node[DatasourceNodeData]):
    """
    Datasource Node
    """

    node_type = NodeType.DATASOURCE
    execution_type = NodeExecutionType.ROOT

    def _run(self) -> Generator:
        """
        Run the datasource node
        """

        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool
        datasource_type_segement = variable_pool.get(["sys", SystemVariableKey.DATASOURCE_TYPE])
        if not datasource_type_segement:
            raise DatasourceNodeError("Datasource type is not set")
        datasource_type = str(datasource_type_segement.value) if datasource_type_segement.value else None
        datasource_info_segement = variable_pool.get(["sys", SystemVariableKey.DATASOURCE_INFO])
        if not datasource_info_segement:
            raise DatasourceNodeError("Datasource info is not set")
        datasource_info_value = datasource_info_segement.value
        if not isinstance(datasource_info_value, dict):
            raise DatasourceNodeError("Invalid datasource info format")
        datasource_info: dict[str, Any] = datasource_info_value
        # get datasource runtime
        from core.datasource.datasource_manager import DatasourceManager

        if datasource_type is None:
            raise DatasourceNodeError("Datasource type is not set")

        datasource_runtime = DatasourceManager.get_datasource_runtime(
            provider_id=f"{node_data.plugin_id}/{node_data.provider_name}",
            datasource_name=node_data.datasource_name or "",
            tenant_id=self.tenant_id,
            datasource_type=DatasourceProviderType.value_of(datasource_type),
        )
        datasource_info["icon"] = datasource_runtime.get_icon_url(self.tenant_id)

        parameters_for_log = datasource_info

        try:
            datasource_provider_service = DatasourceProviderService()
            credentials = datasource_provider_service.get_datasource_credentials(
                tenant_id=self.tenant_id,
                provider=node_data.provider_name,
                plugin_id=node_data.plugin_id,
                credential_id=datasource_info.get("credential_id", ""),
            )
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT:
                    datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                    if credentials:
                        datasource_runtime.runtime.credentials = credentials
                    online_document_result: Generator[DatasourceMessage, None, None] = (
                        datasource_runtime.get_online_document_page_content(
                            user_id=self.user_id,
                            datasource_parameters=GetOnlineDocumentPageContentRequest(
                                workspace_id=datasource_info.get("workspace_id", ""),
                                page_id=datasource_info.get("page", {}).get("page_id", ""),
                                type=datasource_info.get("page", {}).get("type", ""),
                            ),
                            provider_type=datasource_type,
                        )
                    )
                    yield from self._transform_message(
                        messages=online_document_result,
                        parameters_for_log=parameters_for_log,
                        datasource_info=datasource_info,
                    )
                case DatasourceProviderType.ONLINE_DRIVE:
                    datasource_runtime = cast(OnlineDriveDatasourcePlugin, datasource_runtime)
                    if credentials:
                        datasource_runtime.runtime.credentials = credentials
                    online_drive_result: Generator[DatasourceMessage, None, None] = (
                        datasource_runtime.online_drive_download_file(
                            user_id=self.user_id,
                            request=OnlineDriveDownloadFileRequest(
                                id=datasource_info.get("id", ""),
                                bucket=datasource_info.get("bucket"),
                            ),
                            provider_type=datasource_type,
                        )
                    )
                    yield from self._transform_datasource_file_message(
                        messages=online_drive_result,
                        parameters_for_log=parameters_for_log,
                        datasource_info=datasource_info,
                        variable_pool=variable_pool,
                        datasource_type=datasource_type,
                    )
                case DatasourceProviderType.WEBSITE_CRAWL:
                    yield StreamCompletedEvent(
                        node_run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.SUCCEEDED,
                            inputs=parameters_for_log,
                            metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                            outputs={
                                **datasource_info,
                                "datasource_type": datasource_type,
                            },
                        )
                    )
                case DatasourceProviderType.LOCAL_FILE:
                    related_id = datasource_info.get("related_id")
                    if not related_id:
                        raise DatasourceNodeError("File is not exist")
                    upload_file = db.session.query(UploadFile).where(UploadFile.id == related_id).first()
                    if not upload_file:
                        raise ValueError("Invalid upload file Info")

                    file_info = File(
                        id=upload_file.id,
                        filename=upload_file.name,
                        extension="." + upload_file.extension,
                        mime_type=upload_file.mime_type,
                        tenant_id=self.tenant_id,
                        type=FileType.CUSTOM,
                        transfer_method=FileTransferMethod.LOCAL_FILE,
                        remote_url=upload_file.source_url,
                        related_id=upload_file.id,
                        size=upload_file.size,
                        storage_key=upload_file.key,
                        url=upload_file.source_url,
                    )
                    variable_pool.add([self._node_id, "file"], file_info)
                    # variable_pool.add([self.node_id, "file"], file_info.to_dict())
                    yield StreamCompletedEvent(
                        node_run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.SUCCEEDED,
                            inputs=parameters_for_log,
                            metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                            outputs={
                                "file": file_info,
                                "datasource_type": datasource_type,
                            },
                        )
                    )
                case _:
                    raise DatasourceNodeError(f"Unsupported datasource provider: {datasource_type}")
        except PluginDaemonClientSideError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to transform datasource message: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
        except DatasourceNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to invoke datasource: {str(e)}",
                    error_type=type(e).__name__,
                )
            )

    def _generate_parameters(
        self,
        *,
        datasource_parameters: Sequence[DatasourceParameter],
        variable_pool: VariablePool,
        node_data: DatasourceNodeData,
        for_log: bool = False,
    ) -> dict[str, Any]:
        """
        Generate parameters based on the given tool parameters, variable pool, and node data.

        Args:
            tool_parameters (Sequence[ToolParameter]): The list of tool parameters.
            variable_pool (VariablePool): The variable pool containing the variables.
            node_data (ToolNodeData): The data associated with the tool node.

        Returns:
            Mapping[str, Any]: A dictionary containing the generated parameters.

        """
        datasource_parameters_dictionary = {parameter.name: parameter for parameter in datasource_parameters}

        result: dict[str, Any] = {}
        if node_data.datasource_parameters:
            for parameter_name in node_data.datasource_parameters:
                parameter = datasource_parameters_dictionary.get(parameter_name)
                if not parameter:
                    result[parameter_name] = None
                    continue
                datasource_input = node_data.datasource_parameters[parameter_name]
                if datasource_input.type == "variable":
                    variable = variable_pool.get(datasource_input.value)
                    if variable is None:
                        raise DatasourceParameterError(f"Variable {datasource_input.value} does not exist")
                    parameter_value = variable.value
                elif datasource_input.type in {"mixed", "constant"}:
                    segment_group = variable_pool.convert_template(str(datasource_input.value))
                    parameter_value = segment_group.log if for_log else segment_group.text
                else:
                    raise DatasourceParameterError(f"Unknown datasource input type '{datasource_input.type}'")
                result[parameter_name] = parameter_value

        return result

    def _fetch_files(self, variable_pool: VariablePool) -> list[File]:
        variable = variable_pool.get(["sys", SystemVariableKey.FILES])
        assert isinstance(variable, ArrayAnyVariable | ArrayAnySegment)
        return list(variable.value) if variable else []

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        typed_node_data = DatasourceNodeData.model_validate(node_data)
        result = {}
        if typed_node_data.datasource_parameters:
            for parameter_name in typed_node_data.datasource_parameters:
                input = typed_node_data.datasource_parameters[parameter_name]
                if input.type == "mixed":
                    assert isinstance(input.value, str)
                    selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                    for selector in selectors:
                        result[selector.variable] = selector.value_selector
                elif input.type == "variable":
                    result[parameter_name] = input.value
                elif input.type == "constant":
                    pass

            result = {node_id + "." + key: value for key, value in result.items()}

        return result

    def _transform_message(
        self,
        messages: Generator[DatasourceMessage, None, None],
        parameters_for_log: dict[str, Any],
        datasource_info: dict[str, Any],
    ) -> Generator:
        """
        Convert ToolInvokeMessages into tuple[plain_text, files]
        """
        # transform message and handle file storage
        message_stream = DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
            messages=messages,
            user_id=self.user_id,
            tenant_id=self.tenant_id,
            conversation_id=None,
        )

        text = ""
        files: list[File] = []
        json: list[dict | list] = []

        variables: dict[str, Any] = {}

        for message in message_stream:
            if message.type in {
                DatasourceMessage.MessageType.IMAGE_LINK,
                DatasourceMessage.MessageType.BINARY_LINK,
                DatasourceMessage.MessageType.IMAGE,
            }:
                assert isinstance(message.message, DatasourceMessage.TextMessage)

                url = message.message.text
                transfer_method = FileTransferMethod.TOOL_FILE

                datasource_file_id = str(url).split("/")[-1].split(".")[0]

                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == datasource_file_id)
                    datasource_file = session.scalar(stmt)
                    if datasource_file is None:
                        raise ToolFileError(f"Tool file {datasource_file_id} does not exist")

                mapping = {
                    "tool_file_id": datasource_file_id,
                    "type": file_factory.get_file_type_by_mime_type(datasource_file.mimetype),
                    "transfer_method": transfer_method,
                    "url": url,
                }
                file = file_factory.build_from_mapping(
                    mapping=mapping,
                    tenant_id=self.tenant_id,
                )
                files.append(file)
            elif message.type == DatasourceMessage.MessageType.BLOB:
                # get tool file id
                assert isinstance(message.message, DatasourceMessage.TextMessage)
                assert message.meta

                datasource_file_id = message.message.text.split("/")[-1].split(".")[0]
                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == datasource_file_id)
                    datasource_file = session.scalar(stmt)
                    if datasource_file is None:
                        raise ToolFileError(f"datasource file {datasource_file_id} not exists")

                mapping = {
                    "tool_file_id": datasource_file_id,
                    "transfer_method": FileTransferMethod.TOOL_FILE,
                }

                files.append(
                    file_factory.build_from_mapping(
                        mapping=mapping,
                        tenant_id=self.tenant_id,
                    )
                )
            elif message.type == DatasourceMessage.MessageType.TEXT:
                assert isinstance(message.message, DatasourceMessage.TextMessage)
                text += message.message.text
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=message.message.text,
                    is_final=False,
                )
            elif message.type == DatasourceMessage.MessageType.JSON:
                assert isinstance(message.message, DatasourceMessage.JsonMessage)
                json.append(message.message.json_object)
            elif message.type == DatasourceMessage.MessageType.LINK:
                assert isinstance(message.message, DatasourceMessage.TextMessage)
                stream_text = f"Link: {message.message.text}\n"
                text += stream_text
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=stream_text,
                    is_final=False,
                )
            elif message.type == DatasourceMessage.MessageType.VARIABLE:
                assert isinstance(message.message, DatasourceMessage.VariableMessage)
                variable_name = message.message.variable_name
                variable_value = message.message.variable_value
                if message.message.stream:
                    if not isinstance(variable_value, str):
                        raise ValueError("When 'stream' is True, 'variable_value' must be a string.")
                    if variable_name not in variables:
                        variables[variable_name] = ""
                    variables[variable_name] += variable_value

                    yield StreamChunkEvent(
                        selector=[self._node_id, variable_name],
                        chunk=variable_value,
                        is_final=False,
                    )
                else:
                    variables[variable_name] = variable_value
            elif message.type == DatasourceMessage.MessageType.FILE:
                assert message.meta is not None
                files.append(message.meta["file"])
        # mark the end of the stream
        yield StreamChunkEvent(
            selector=[self._node_id, "text"],
            chunk="",
            is_final=True,
        )
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={**variables},
                metadata={
                    WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info,
                },
                inputs=parameters_for_log,
            )
        )

    @classmethod
    def version(cls) -> str:
        return "1"

    def _transform_datasource_file_message(
        self,
        messages: Generator[DatasourceMessage, None, None],
        parameters_for_log: dict[str, Any],
        datasource_info: dict[str, Any],
        variable_pool: VariablePool,
        datasource_type: DatasourceProviderType,
    ) -> Generator:
        """
        Convert ToolInvokeMessages into tuple[plain_text, files]
        """
        # transform message and handle file storage
        message_stream = DatasourceFileMessageTransformer.transform_datasource_invoke_messages(
            messages=messages,
            user_id=self.user_id,
            tenant_id=self.tenant_id,
            conversation_id=None,
        )
        file = None
        for message in message_stream:
            if message.type == DatasourceMessage.MessageType.BINARY_LINK:
                assert isinstance(message.message, DatasourceMessage.TextMessage)

                url = message.message.text
                transfer_method = FileTransferMethod.TOOL_FILE

                datasource_file_id = str(url).split("/")[-1].split(".")[0]

                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == datasource_file_id)
                    datasource_file = session.scalar(stmt)
                    if datasource_file is None:
                        raise ToolFileError(f"Tool file {datasource_file_id} does not exist")

                mapping = {
                    "tool_file_id": datasource_file_id,
                    "type": file_factory.get_file_type_by_mime_type(datasource_file.mimetype),
                    "transfer_method": transfer_method,
                    "url": url,
                }
                file = file_factory.build_from_mapping(
                    mapping=mapping,
                    tenant_id=self.tenant_id,
                )
        if file:
            variable_pool.add([self._node_id, "file"], file)
        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                inputs=parameters_for_log,
                metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                outputs={
                    "file": file,
                    "datasource_type": datasource_type,
                },
            )
        )
