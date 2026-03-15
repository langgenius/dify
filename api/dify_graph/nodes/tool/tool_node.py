from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from dify_graph.entities.graph_config import NodeConfigDict
from dify_graph.enums import (
    BuiltinNodeTypes,
    SystemVariableKey,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from dify_graph.file import File, FileTransferMethod, get_file_type_by_mime_type
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.node_events import NodeEventBase, NodeRunResult, StreamChunkEvent, StreamCompletedEvent
from dify_graph.nodes.base.node import Node
from dify_graph.nodes.base.variable_template_parser import VariableTemplateParser
from dify_graph.nodes.protocols import ToolFileManagerProtocol
from dify_graph.nodes.runtime import ToolNodeRuntimeProtocol
from dify_graph.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)
from dify_graph.variables.segments import ArrayAnySegment, ArrayFileSegment
from dify_graph.variables.variables import ArrayAnyVariable

from .entities import ToolNodeData
from .exc import (
    ToolFileError,
    ToolNodeError,
    ToolParameterError,
)

if TYPE_CHECKING:
    from dify_graph.entities import GraphInitParams
    from dify_graph.runtime import GraphRuntimeState, VariablePool


class ToolNode(Node[ToolNodeData]):
    """
    Tool Node
    """

    node_type = BuiltinNodeTypes.TOOL

    def __init__(
        self,
        id: str,
        config: NodeConfigDict,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        tool_file_manager_factory: ToolFileManagerProtocol,
        runtime: ToolNodeRuntimeProtocol | None = None,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._tool_file_manager_factory = tool_file_manager_factory
        if runtime is None:
            raise ValueError("runtime is required")
        self._runtime = runtime

    @classmethod
    def version(cls) -> str:
        return "1"

    def populate_start_event(self, event) -> None:
        event.provider_id = self.node_data.provider_id
        event.provider_type = self.node_data.provider_type

    def _run(self) -> Generator[NodeEventBase, None, None]:
        """
        Run the tool node
        """
        # fetch tool icon
        tool_info = {
            "provider_type": self.node_data.provider_type.value,
            "provider_id": self.node_data.provider_id,
            "plugin_unique_identifier": self.node_data.plugin_unique_identifier,
        }

        # get tool runtime
        try:
            # This is an issue that caused problems before.
            # Logically, we shouldn't use the node_data.version field for judgment
            # But for backward compatibility with historical data
            # this version field judgment is still preserved here.
            variable_pool: VariablePool | None = None
            if self.node_data.version != "1" or self.node_data.tool_node_version is not None:
                variable_pool = self.graph_runtime_state.variable_pool
            tool_runtime = self._runtime.get_runtime(
                node_id=self._node_id,
                node_data=self.node_data,
                variable_pool=variable_pool,
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
        tool_parameters = self._runtime.get_runtime_parameters(tool_runtime=tool_runtime)
        parameters = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )
        # get conversation id
        conversation_id = self.graph_runtime_state.variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])

        try:
            message_stream = self._runtime.invoke(
                tool_runtime=tool_runtime,
                tool_parameters=parameters,
                workflow_call_depth=self.workflow_call_depth,
                conversation_id=conversation_id.text if conversation_id else None,
                provider_name=self.node_data.provider_name,
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
                node_id=self._node_id,
                tool_runtime=tool_runtime,
            )
        except ToolNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=str(e),
                    error_type=type(e).__name__,
                )
            )

    def _generate_parameters(
        self,
        *,
        tool_parameters: Sequence[ToolRuntimeParameter],
        variable_pool: "VariablePool",
        node_data: ToolNodeData,
        for_log: bool = False,
    ) -> dict[str, Any]:
        """
        Generate parameters based on the given tool parameters, variable pool, and node data.

        Args:
            tool_parameters (Sequence[ToolRuntimeParameter]): The list of tool parameters.
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
        messages: Generator[ToolRuntimeMessage, None, None],
        tool_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
        node_id: str,
        tool_runtime: ToolRuntimeHandle,
        **_: Any,
    ) -> Generator[NodeEventBase, None, LLMUsage]:
        """
        Convert graph-owned tool runtime messages into node outputs.
        """
        text = ""
        files: list[File] = []
        json: list[dict | list] = []

        variables: dict[str, Any] = {}

        for message in messages:
            if message.type in {
                ToolRuntimeMessage.MessageType.IMAGE_LINK,
                ToolRuntimeMessage.MessageType.BINARY_LINK,
                ToolRuntimeMessage.MessageType.IMAGE,
            }:
                assert isinstance(message.message, ToolRuntimeMessage.TextMessage)

                url = message.message.text
                if message.meta:
                    transfer_method = message.meta.get("transfer_method", FileTransferMethod.TOOL_FILE)
                else:
                    transfer_method = FileTransferMethod.TOOL_FILE

                tool_file_id = str(url).split("/")[-1].split(".")[0]

                _, tool_file = self._tool_file_manager_factory.get_file_generator_by_tool_file_id(tool_file_id)
                if not tool_file:
                    raise ToolFileError(f"tool file {tool_file_id} not found")

                mapping: dict[str, Any] = {
                    "tool_file_id": tool_file_id,
                    "type": get_file_type_by_mime_type(tool_file.mimetype),
                    "transfer_method": transfer_method,
                    "url": url,
                }
                file = self._runtime.build_file_reference(mapping=mapping)
                files.append(file)
            elif message.type == ToolRuntimeMessage.MessageType.BLOB:
                # get tool file id
                assert isinstance(message.message, ToolRuntimeMessage.TextMessage)
                assert message.meta

                tool_file_id = message.message.text.split("/")[-1].split(".")[0]
                _, tool_file = self._tool_file_manager_factory.get_file_generator_by_tool_file_id(tool_file_id)
                if not tool_file:
                    raise ToolFileError(f"tool file {tool_file_id} not exists")

                mapping: dict[str, Any] = {
                    "tool_file_id": tool_file_id,
                    "transfer_method": FileTransferMethod.TOOL_FILE,
                }

                files.append(self._runtime.build_file_reference(mapping=mapping))
            elif message.type == ToolRuntimeMessage.MessageType.TEXT:
                assert isinstance(message.message, ToolRuntimeMessage.TextMessage)
                text += message.message.text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=message.message.text,
                    is_final=False,
                )
            elif message.type == ToolRuntimeMessage.MessageType.JSON:
                assert isinstance(message.message, ToolRuntimeMessage.JsonMessage)
                # JSON message handling for tool node
                if message.message.json_object:
                    json.append(message.message.json_object)
            elif message.type == ToolRuntimeMessage.MessageType.LINK:
                assert isinstance(message.message, ToolRuntimeMessage.TextMessage)

                # Check if this LINK message is a file link
                file_obj = (message.meta or {}).get("file")
                if isinstance(file_obj, File):
                    files.append(file_obj)
                    stream_text = f"File: {message.message.text}\n"
                else:
                    stream_text = f"Link: {message.message.text}\n"

                text += stream_text
                yield StreamChunkEvent(
                    selector=[node_id, "text"],
                    chunk=stream_text,
                    is_final=False,
                )
            elif message.type == ToolRuntimeMessage.MessageType.VARIABLE:
                assert isinstance(message.message, ToolRuntimeMessage.VariableMessage)
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
            elif message.type == ToolRuntimeMessage.MessageType.FILE:
                assert message.meta is not None
                assert isinstance(message.meta, dict)
                # Validate that meta contains a 'file' key
                if "file" not in message.meta:
                    raise ToolNodeError("File message is missing 'file' key in meta")

                # Validate that the file is an instance of File
                if not isinstance(message.meta["file"], File):
                    raise ToolNodeError(f"Expected File object but got {type(message.meta['file']).__name__}")
                files.append(message.meta["file"])
            elif message.type == ToolRuntimeMessage.MessageType.LOG:
                assert isinstance(message.message, ToolRuntimeMessage.LogMessage)
                if message.message.metadata:
                    icon = tool_info.get("icon", "")
                    dict_metadata = dict(message.message.metadata)
                    if dict_metadata.get("provider"):
                        icon, icon_dark = self._runtime.resolve_provider_icons(
                            provider_name=dict_metadata["provider"],
                            default_icon=icon,
                        )
                        dict_metadata["icon"] = icon
                        dict_metadata["icon_dark"] = icon_dark
                        message.message.metadata = dict_metadata

        # Add agent_logs to outputs['json'] to ensure frontend can access thinking process
        json_output: list[dict[str, Any] | list[Any]] = []

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

        usage = self._runtime.get_usage(tool_runtime=tool_runtime)

        metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info,
        }
        if isinstance(usage.total_tokens, int) and usage.total_tokens > 0:
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

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: ToolNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        _ = graph_config  # Explicitly mark as unused
        typed_node_data = node_data
        result = {}
        for parameter_name in typed_node_data.tool_parameters:
            input = typed_node_data.tool_parameters[parameter_name]
            match input.type:
                case "mixed":
                    assert isinstance(input.value, str)
                    selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                    for selector in selectors:
                        result[selector.variable] = selector.value_selector
                case "variable":
                    selector_key = ".".join(input.value)
                    result[f"#{selector_key}#"] = input.value
                case "constant":
                    pass

        result = {node_id + "." + key: value for key, value in result.items()}

        return result

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled
