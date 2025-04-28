from collections.abc import Generator, Mapping, Sequence
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.datasource.datasource_engine import DatasourceEngine
from core.datasource.entities.datasource_entities import DatasourceInvokeMessage, DatasourceParameter
from core.datasource.errors import DatasourceInvokeError
from core.datasource.utils.message_transformer import DatasourceFileMessageTransformer
from core.file import File, FileTransferMethod
from core.plugin.manager.exc import PluginDaemonClientSideError
from core.plugin.manager.plugin import PluginInstallationManager
from core.variables.segments import ArrayAnySegment
from core.variables.variables import ArrayAnyVariable
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.event import AgentLogEvent
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import RunCompletedEvent, RunStreamChunkEvent
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from extensions.ext_database import db
from factories import file_factory
from models import ToolFile
from models.workflow import WorkflowNodeExecutionStatus
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

from .entities import DatasourceNodeData
from .exc import DatasourceNodeError, DatasourceParameterError, ToolFileError


class DatasourceNode(BaseNode[DatasourceNodeData]):
    """
    Datasource Node
    """

    _node_data_cls = DatasourceNodeData
    _node_type = NodeType.DATASOURCE

    def _run(self) -> Generator:
        """
        Run the datasource node
        """

        node_data = cast(DatasourceNodeData, self.node_data)

        # fetch datasource icon
        datasource_info = {
            "provider_type": node_data.provider_type.value,
            "provider_id": node_data.provider_id,
            "plugin_unique_identifier": node_data.plugin_unique_identifier,
        }

        # get datasource runtime
        try:
            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_workflow_datasource_runtime(
                self.tenant_id, self.app_id, self.node_id, self.node_data, self.invoke_from
            )
        except DatasourceNodeError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to get datasource runtime: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

        # get parameters
        datasource_parameters = datasource_runtime.get_merged_runtime_parameters() or []
        parameters = self._generate_parameters(
            datasource_parameters=datasource_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            datasource_parameters=datasource_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )

        # get conversation id
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])

        try:
            message_stream = DatasourceEngine.generic_invoke(
                datasource=datasource_runtime,
                datasource_parameters=parameters,
                user_id=self.user_id,
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=self.workflow_call_depth,
                thread_pool_id=self.thread_pool_id,
                app_id=self.app_id,
                conversation_id=conversation_id.text if conversation_id else None,
            )
        except DatasourceNodeError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to invoke datasource: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

        try:
            # convert datasource messages
            yield from self._transform_message(message_stream, datasource_info, parameters_for_log)
        except (PluginDaemonClientSideError, DatasourceInvokeError) as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to transform datasource message: {str(e)}",
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
        variable = variable_pool.get(["sys", SystemVariableKey.FILES.value])
        assert isinstance(variable, ArrayAnyVariable | ArrayAnySegment)
        return list(variable.value) if variable else []

    def _transform_message(
        self,
        messages: Generator[DatasourceInvokeMessage, None, None],
        datasource_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
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
        json: list[dict] = []

        agent_logs: list[AgentLogEvent] = []
        agent_execution_metadata: Mapping[NodeRunMetadataKey, Any] = {}

        variables: dict[str, Any] = {}

        for message in message_stream:
            if message.type in {
                DatasourceInvokeMessage.MessageType.IMAGE_LINK,
                DatasourceInvokeMessage.MessageType.BINARY_LINK,
                DatasourceInvokeMessage.MessageType.IMAGE,
            }:
                assert isinstance(message.message, DatasourceInvokeMessage.TextMessage)

                url = message.message.text
                if message.meta:
                    transfer_method = message.meta.get("transfer_method", FileTransferMethod.TOOL_FILE)
                else:
                    transfer_method = FileTransferMethod.TOOL_FILE

                tool_file_id = str(url).split("/")[-1].split(".")[0]

                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == tool_file_id)
                    tool_file = session.scalar(stmt)
                    if tool_file is None:
                        raise ToolFileError(f"Tool file {tool_file_id} does not exist")

                mapping = {
                    "tool_file_id": tool_file_id,
                    "type": file_factory.get_file_type_by_mime_type(tool_file.mimetype),
                    "transfer_method": transfer_method,
                    "url": url,
                }
                file = file_factory.build_from_mapping(
                    mapping=mapping,
                    tenant_id=self.tenant_id,
                )
                files.append(file)
            elif message.type == DatasourceInvokeMessage.MessageType.BLOB:
                # get tool file id
                assert isinstance(message.message, DatasourceInvokeMessage.TextMessage)
                assert message.meta

                tool_file_id = message.message.text.split("/")[-1].split(".")[0]
                with Session(db.engine) as session:
                    stmt = select(ToolFile).where(ToolFile.id == tool_file_id)
                    tool_file = session.scalar(stmt)
                    if tool_file is None:
                        raise ToolFileError(f"tool file {tool_file_id} not exists")

                mapping = {
                    "tool_file_id": tool_file_id,
                    "transfer_method": FileTransferMethod.TOOL_FILE,
                }

                files.append(
                    file_factory.build_from_mapping(
                        mapping=mapping,
                        tenant_id=self.tenant_id,
                    )
                )
            elif message.type == DatasourceInvokeMessage.MessageType.TEXT:
                assert isinstance(message.message, DatasourceInvokeMessage.TextMessage)
                text += message.message.text
                yield RunStreamChunkEvent(
                    chunk_content=message.message.text, from_variable_selector=[self.node_id, "text"]
                )
            elif message.type == DatasourceInvokeMessage.MessageType.JSON:
                assert isinstance(message.message, DatasourceInvokeMessage.JsonMessage)
                if self.node_type == NodeType.AGENT:
                    msg_metadata = message.message.json_object.pop("execution_metadata", {})
                    agent_execution_metadata = {
                        key: value
                        for key, value in msg_metadata.items()
                        if key in NodeRunMetadataKey.__members__.values()
                    }
                json.append(message.message.json_object)
            elif message.type == DatasourceInvokeMessage.MessageType.LINK:
                assert isinstance(message.message, DatasourceInvokeMessage.TextMessage)
                stream_text = f"Link: {message.message.text}\n"
                text += stream_text
                yield RunStreamChunkEvent(chunk_content=stream_text, from_variable_selector=[self.node_id, "text"])
            elif message.type == DatasourceInvokeMessage.MessageType.VARIABLE:
                assert isinstance(message.message, DatasourceInvokeMessage.VariableMessage)
                variable_name = message.message.variable_name
                variable_value = message.message.variable_value
                if message.message.stream:
                    if not isinstance(variable_value, str):
                        raise ValueError("When 'stream' is True, 'variable_value' must be a string.")
                    if variable_name not in variables:
                        variables[variable_name] = ""
                    variables[variable_name] += variable_value

                    yield RunStreamChunkEvent(
                        chunk_content=variable_value, from_variable_selector=[self.node_id, variable_name]
                    )
                else:
                    variables[variable_name] = variable_value
            elif message.type == DatasourceInvokeMessage.MessageType.FILE:
                assert message.meta is not None
                files.append(message.meta["file"])
            elif message.type == DatasourceInvokeMessage.MessageType.LOG:
                assert isinstance(message.message, DatasourceInvokeMessage.LogMessage)
                if message.message.metadata:
                    icon = datasource_info.get("icon", "")
                    dict_metadata = dict(message.message.metadata)
                    if dict_metadata.get("provider"):
                        manager = PluginInstallationManager()
                        plugins = manager.list_plugins(self.tenant_id)
                        try:
                            current_plugin = next(
                                plugin
                                for plugin in plugins
                                if f"{plugin.plugin_id}/{plugin.name}" == dict_metadata["provider"]
                            )
                            icon = current_plugin.declaration.icon
                        except StopIteration:
                            pass
                        try:
                            builtin_tool = next(
                                provider
                                for provider in BuiltinToolManageService.list_builtin_tools(
                                    self.user_id,
                                    self.tenant_id,
                                )
                                if provider.name == dict_metadata["provider"]
                            )
                            icon = builtin_tool.icon
                        except StopIteration:
                            pass

                        dict_metadata["icon"] = icon
                        message.message.metadata = dict_metadata
                agent_log = AgentLogEvent(
                    id=message.message.id,
                    node_execution_id=self.id,
                    parent_id=message.message.parent_id,
                    error=message.message.error,
                    status=message.message.status.value,
                    data=message.message.data,
                    label=message.message.label,
                    metadata=message.message.metadata,
                    node_id=self.node_id,
                )

                # check if the agent log is already in the list
                for log in agent_logs:
                    if log.id == agent_log.id:
                        # update the log
                        log.data = agent_log.data
                        log.status = agent_log.status
                        log.error = agent_log.error
                        log.label = agent_log.label
                        log.metadata = agent_log.metadata
                        break
                else:
                    agent_logs.append(agent_log)

                yield agent_log

        yield RunCompletedEvent(
            run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": text, "files": files, "json": json, **variables},
                metadata={
                    **agent_execution_metadata,
                    NodeRunMetadataKey.DATASOURCE_INFO: datasource_info,
                    NodeRunMetadataKey.AGENT_LOG: agent_logs,
                },
                inputs=parameters_for_log,
            )
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DatasourceNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        result = {}
        for parameter_name in node_data.datasource_parameters:
            input = node_data.datasource_parameters[parameter_name]
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
