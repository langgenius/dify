from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.file import File, FileTransferMethod
from core.model_runtime.entities.llm_entities import LLMUsage
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolInvokeError
from core.tools.tool_engine import ToolEngine
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.tools.workflow_as_tool.tool import WorkflowTool
from core.variables.segments import ArrayAnySegment, ArrayFileSegment
from core.variables.variables import ArrayAnyVariable
from core.workflow.enums import (
    ErrorStrategy,
    NodeType,
    SystemVariableKey,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from core.workflow.node_events import NodeEventBase, NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from core.workflow.nodes.base.entities import BaseNodeData, RetryConfig
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from extensions.ext_database import db
from factories import file_factory
from models import ToolFile
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

from .entities import ToolNodeData
from .exc import (
    ToolFileError,
    ToolNodeError,
    ToolParameterError,
)

if TYPE_CHECKING:
    from core.workflow.runtime import VariablePool


class ToolNode(Node):
    """
    Tool Node
    """

    node_type = NodeType.TOOL

    _node_data: ToolNodeData

    def init_node_data(self, data: Mapping[str, Any]):
        self._node_data = ToolNodeData.model_validate(data)

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> Generator[NodeEventBase, None, None]:
        """
        Run the tool node
        """
        from core.plugin.impl.exc import PluginDaemonClientSideError, PluginInvokeError

        node_data = self._node_data

        # fetch tool icon
        tool_info = {
            "provider_type": node_data.provider_type.value,
            "provider_id": node_data.provider_id,
            "plugin_unique_identifier": node_data.plugin_unique_identifier,
        }

        # get tool runtime
        try:
            from core.tools.tool_manager import ToolManager

            # This is an issue that caused problems before.
            # Logically, we shouldn't use the node_data.version field for judgment
            # But for backward compatibility with historical data
            # this version field judgment is still preserved here.
            variable_pool: VariablePool | None = None
            if node_data.version != "1" or node_data.tool_node_version is not None:
                variable_pool = self.graph_runtime_state.variable_pool
            tool_runtime = ToolManager.get_workflow_tool_runtime(
                self.tenant_id, self.app_id, self._node_id, self._node_data, self.invoke_from, variable_pool
            )
        except ToolNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to get tool runtime: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

        # get parameters
        tool_parameters = tool_runtime.get_merged_runtime_parameters() or []
        parameters = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self._node_data,
        )
        parameters_for_log = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self._node_data,
            for_log=True,
        )
        # get conversation id
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])

        try:
            message_stream = ToolEngine.generic_invoke(
                tool=tool_runtime,
                tool_parameters=parameters,
                user_id=self.user_id,
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=self.workflow_call_depth,
                app_id=self.app_id,
                conversation_id=conversation_id.text if conversation_id else None,
            )
        except ToolNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to invoke tool: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

        try:
            # convert tool messages
            _ = yield from self._transform_message(
                messages=message_stream,
                tool_info=tool_info,
                parameters_for_log=parameters_for_log,
                user_id=self.user_id,
                tenant_id=self.tenant_id,
                node_id=self._node_id,
                tool_runtime=tool_runtime,
            )
        except ToolInvokeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to invoke tool {node_data.provider_name}: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
        except PluginInvokeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error="An error occurred in the plugin, "
                    f"please contact the author of {node_data.provider_name} for help, "
                    f"error type: {e.get_error_type()}, "
                    f"error details: {e.get_error_message()}",
                    error_type=type(e).__name__,
                )
            )
        except PluginDaemonClientSideError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to invoke tool, error: {e.description}",
                    error_type=type(e).__name__,
                )
            )

    def _generate_parameters(
        self,
        *,
        tool_parameters: Sequence[ToolParameter],
        variable_pool: "VariablePool",
        node_data: ToolNodeData,
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
        tool_parameters_dictionary = {parameter.name: parameter for parameter in tool_parameters}

        result: dict[str, Any] = {}
        for parameter_name in node_data.tool_parameters:
            parameter = tool_parameters_dictionary.get(parameter_name)
            if not parameter:
                result[parameter_name] = None
                continue
            tool_input = node_data.tool_parameters[parameter_name]
            if tool_input.type == "variable":
                variable = variable_pool.get(tool_input.value)
                if variable is None:
                    if parameter.required:
                        raise ToolParameterError(f"Variable {tool_input.value} does not exist")
                    continue
                parameter_value = variable.value
            elif tool_input.type in {"mixed", "constant"}:
                segment_group = variable_pool.convert_template(str(tool_input.value))
                parameter_value = segment_group.log if for_log else segment_group.text
            else:
                raise ToolParameterError(f"Unknown tool input type '{tool_input.type}'")
            result[parameter_name] = parameter_value

        return result

    def _fetch_files(self, variable_pool: "VariablePool") -> list[File]:
        variable = variable_pool.get(["sys", SystemVariableKey.FILES])
        assert isinstance(variable, ArrayAnyVariable | ArrayAnySegment)
        return list(variable.value) if variable else []

    def _transform_message(
        self,
        messages: Generator[ToolInvokeMessage, None, None],
        tool_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
        user_id: str,
        tenant_id: str,
        node_id: str,
        tool_runtime: Tool,
    ) -> Generator[NodeEventBase, None, LLMUsage]:
        """
        Convert ToolInvokeMessages into tuple[plain_text, files]
        """
        # transform message and handle file storage
        from core.plugin.impl.plugin import PluginInstaller

        message_stream = ToolFileMessageTransformer.transform_tool_invoke_messages(
            messages=messages,
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
        )

        text = ""
        files: list[File] = []
        json: list[dict] = []

        variables: dict[str, Any] = {}

        for message in message_stream:
            if message.type in {
                ToolInvokeMessage.MessageType.IMAGE_LINK,
                ToolInvokeMessage.MessageType.BINARY_LINK,
                ToolInvokeMessage.MessageType.IMAGE,
            }:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)

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
                    tenant_id=tenant_id,
                )
                files.append(file)
            elif message.type == ToolInvokeMessage.MessageType.BLOB:
                # get tool file id
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
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
                        tenant_id=tenant_id,
                    )
                )
            elif message.type == ToolInvokeMessage.MessageType.TEXT:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                text += message.message.text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=message.message.text,
                    is_final=False,
                )
            elif message.type == ToolInvokeMessage.MessageType.JSON:
                assert isinstance(message.message, ToolInvokeMessage.JsonMessage)
                # JSON message handling for tool node
                if message.message.json_object:
                    json.append(message.message.json_object)
            elif message.type == ToolInvokeMessage.MessageType.LINK:
                assert isinstance(message.message, ToolInvokeMessage.TextMessage)
                stream_text = f"Link: {message.message.text}\n"
                text += stream_text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=stream_text,
                    is_final=False,
                )
            elif message.type == ToolInvokeMessage.MessageType.VARIABLE:
                assert isinstance(message.message, ToolInvokeMessage.VariableMessage)
                variable_name = message.message.variable_name
                variable_value = message.message.variable_value
                if message.message.stream:
                    if not isinstance(variable_value, str):
                        raise ToolNodeError("When 'stream' is True, 'variable_value' must be a string.")
                    if variable_name not in variables:
                        variables[variable_name] = ""
                    variables[variable_name] += variable_value

                    yield StreamChunkEvent(
                        selector=[node_id, variable_name],
                        chunk=variable_value,
                        is_final=False,
                    )
                else:
                    variables[variable_name] = variable_value
            elif message.type == ToolInvokeMessage.MessageType.FILE:
                assert message.meta is not None
                assert isinstance(message.meta, dict)
                # Validate that meta contains a 'file' key
                if "file" not in message.meta:
                    raise ToolNodeError("File message is missing 'file' key in meta")

                # Validate that the file is an instance of File
                if not isinstance(message.meta["file"], File):
                    raise ToolNodeError(f"Expected File object but got {type(message.meta['file']).__name__}")
                files.append(message.meta["file"])
            elif message.type == ToolInvokeMessage.MessageType.LOG:
                assert isinstance(message.message, ToolInvokeMessage.LogMessage)
                if message.message.metadata:
                    icon = tool_info.get("icon", "")
                    dict_metadata = dict(message.message.metadata)
                    if dict_metadata.get("provider"):
                        manager = PluginInstaller()
                        plugins = manager.list_plugins(tenant_id)
                        try:
                            current_plugin = next(
                                plugin
                                for plugin in plugins
                                if f"{plugin.plugin_id}/{plugin.name}" == dict_metadata["provider"]
                            )
                            icon = current_plugin.declaration.icon
                        except StopIteration:
                            pass
                        icon_dark = None
                        try:
                            builtin_tool = next(
                                provider
                                for provider in BuiltinToolManageService.list_builtin_tools(
                                    user_id,
                                    tenant_id,
                                )
                                if provider.name == dict_metadata["provider"]
                            )
                            icon = builtin_tool.icon
                            icon_dark = builtin_tool.icon_dark
                        except StopIteration:
                            pass

                        dict_metadata["icon"] = icon
                        dict_metadata["icon_dark"] = icon_dark
                        message.message.metadata = dict_metadata

        # Add agent_logs to outputs['json'] to ensure frontend can access thinking process
        json_output: list[dict[str, Any]] = []

        # Step 2: normalize JSON into {"data": [...]}.change json to list[dict]
        if json:
            json_output.extend(json)
        else:
            json_output.append({"data": []})

        # Send final chunk events for all streamed outputs
        # Final chunk for text stream
        yield StreamChunkEvent(
            selector=[self._node_id, "text"],
            chunk="",
            is_final=True,
        )

        # Final chunks for any streamed variables
        for var_name in variables:
            yield StreamChunkEvent(
                selector=[self._node_id, var_name],
                chunk="",
                is_final=True,
            )

        usage = self._extract_tool_usage(tool_runtime)

        metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info,
        }
        if usage.total_tokens > 0:
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = usage.total_tokens
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = usage.total_price
            metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] = usage.currency

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={"text": text, "files": ArrayFileSegment(value=files), "json": json_output, **variables},
                metadata=metadata,
                inputs=parameters_for_log,
                llm_usage=usage,
            )
        )

        return usage

    @staticmethod
    def _extract_tool_usage(tool_runtime: Tool) -> LLMUsage:
        if isinstance(tool_runtime, WorkflowTool):
            return tool_runtime.latest_usage
        return LLMUsage.empty_usage()

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
        # Create typed NodeData from dict
        typed_node_data = ToolNodeData.model_validate(node_data)

        result = {}
        for parameter_name in typed_node_data.tool_parameters:
            input = typed_node_data.tool_parameters[parameter_name]
            if input.type == "mixed":
                assert isinstance(input.value, str)
                selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                for selector in selectors:
                    result[selector.variable] = selector.value_selector
            elif input.type == "variable":
                selector_key = ".".join(input.value)
                result[f"#{selector_key}#"] = input.value
            elif input.type == "constant":
                pass

        result = {node_id + "." + key: value for key, value in result.items()}

        return result

    def _get_error_strategy(self) -> ErrorStrategy | None:
        return self._node_data.error_strategy

    def _get_retry_config(self) -> RetryConfig:
        return self._node_data.retry_config

    def _get_title(self) -> str:
        return self._node_data.title

    def _get_description(self) -> str | None:
        return self._node_data.desc

    def _get_default_value_dict(self) -> dict[str, Any]:
        return self._node_data.default_value_dict

    def get_base_node_data(self) -> BaseNodeData:
        return self._node_data

    @property
    def retry(self) -> bool:
        return self._node_data.retry_config.retry_enabled
