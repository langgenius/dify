from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, override

from typing_extensions import TypeIs

from graphon.engine_events.node import NodeRunStartedEvent
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.file.enums import FileTransferMethod
from graphon.file.file_factory import get_file_type_by_mime_type
from graphon.file.models import File
from graphon.node_events.base import (
    NodeEventPayload,
    NodeRunResult,
)
from graphon.node_events.node import (
    StreamChunkEvent,
    StreamCompletedEvent,
)
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.nodes.protocols import ToolFileManagerProtocol
from graphon.nodes.runtime import ToolNodeRuntimeProtocol
from graphon.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.runtime.variable_pool import VariablePool
from graphon.variables.segments import ArrayFileSegment
from graphon.variables.template_resolution import convert_template

from .entities import ToolInputType, ToolNodeData
from .exc import ToolFileError, ToolNodeError, ToolParameterError

_TEMPLATE_TOOL_INPUT_TYPES = frozenset((
    ToolInputType.MIXED,
    ToolInputType.CONSTANT,
))


@dataclass(slots=True)
class _ToolMessageState:
    text: str = ""
    files: list[File] = field(default_factory=list)
    json_values: list[dict | list] = field(default_factory=list)
    variables: dict[str, Any] = field(default_factory=dict)
    blob_chunks: dict[str, "_BlobChunkState"] = field(default_factory=dict)


@dataclass(slots=True)
class _BlobChunkState:
    total_length: int
    bytes_written: int = 0
    data: bytearray = field(init=False)

    def __post_init__(self) -> None:
        self.data = bytearray(self.total_length)


def _is_variable_selector(value: object) -> TypeIs[list[str]]:
    return isinstance(value, list) and all(isinstance(part, str) for part in value)


class ToolNode(Node[ToolNodeData]):
    """Tool Node"""

    node_type = BuiltinNodeTypes.TOOL

    @override
    def __init__(
        self,
        node_id: str,
        data: ToolNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        tool_file_manager: ToolFileManagerProtocol,
        # TODO @-LAN: See https://github.com/langgenius/graphon/issues/new/choose.  # ruff:ignore[line-contains-todo]
        # Make `runtime` optional once Graphon provides a default tool runtime
        # adapter at the workflow boundary.
        runtime: ToolNodeRuntimeProtocol,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        self._tool_file_manager = tool_file_manager
        self._runtime = runtime

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    def populate_start_event(self, event: NodeRunStartedEvent) -> None:
        event.provider_id = self.node_data.provider_id
        event.provider_type = self.node_data.provider_type

    @override
    def _run(self) -> Generator[NodeEventPayload, None, None]:
        """Run the tool node"""
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
            if (
                self.node_data.version != "1"
                or self.node_data.tool_node_version is not None
            ):
                variable_pool = self.runtime_state.variable_pool
            tool_runtime = self._get_tool_runtime(
                variable_pool=variable_pool,
                node_execution_id=self.execution_id,
            )
        except ToolNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to get tool runtime: {e!s}",
                    error_type=type(e).__name__,
                ),
            )
            return

        # get parameters
        tool_parameters = self._runtime.get_runtime_parameters(
            tool_runtime=tool_runtime,
        )
        parameters = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            tool_parameters=tool_parameters,
            variable_pool=self.runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )
        try:
            message_stream = self._runtime.invoke(
                tool_runtime=tool_runtime,
                tool_parameters=parameters,
                workflow_call_depth=self.workflow_call_depth,
                provider_name=self.node_data.provider_name,
            )
        except ToolNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                    error=f"Failed to invoke tool: {e!s}",
                    error_type=type(e).__name__,
                ),
            )
            return

        try:
            # convert tool messages
            yield from self._transform_message(
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
                ),
            )

    def _generate_parameters(
        self,
        *,
        tool_parameters: Sequence[ToolRuntimeParameter],
        variable_pool: VariablePool,
        node_data: ToolNodeData,
        for_log: bool = False,
    ) -> dict[str, Any]:
        """Generate parameters based on the given tool parameters,
        variable pool, and node data.

        Args:
            tool_parameters (Sequence[ToolRuntimeParameter]): The list of tool
            parameters.
            variable_pool (VariablePool): The variable pool containing the variables.
            node_data (ToolNodeData): The data associated with the tool node.
            for_log (bool): Whether to produce log-friendly parameter values.

        Returns:
            Mapping[str, Any]: A dictionary containing the generated parameters.

        Raises:
            ToolParameterError: If a required variable is missing or a tool
                input type is unknown.

        """
        tool_parameters_dictionary = {
            parameter.name: parameter for parameter in tool_parameters
        }

        result: dict[str, Any] = {}
        for parameter_name in node_data.tool_parameters:
            parameter = tool_parameters_dictionary.get(parameter_name)
            if not parameter:
                result[parameter_name] = None
                continue
            tool_input = node_data.tool_parameters[parameter_name]
            if tool_input.type == ToolInputType.VARIABLE:
                if not _is_variable_selector(tool_input.value):
                    msg = "Variable tool input value must be a list of strings."
                    raise ToolParameterError(msg)
                variable = variable_pool.get(tool_input.value)
                if variable is None:
                    if parameter.required:
                        msg = f"Variable {tool_input.value} does not exist"
                        raise ToolParameterError(msg)
                    continue
                parameter_value = variable.value
            elif tool_input.type in _TEMPLATE_TOOL_INPUT_TYPES:
                segment_group = convert_template(variable_pool, str(tool_input.value))
                parameter_value = segment_group.log if for_log else segment_group.text
            else:
                msg = f"Unknown tool input type '{tool_input.type}'"
                raise ToolParameterError(msg)
            result[parameter_name] = parameter_value

        return result

    def _get_tool_runtime(
        self,
        *,
        variable_pool: VariablePool | None,
        node_execution_id: str,
    ) -> ToolRuntimeHandle:
        return self._runtime.get_runtime(
            node_id=self._node_id,
            node_data=self.node_data,
            variable_pool=variable_pool,
            node_execution_id=node_execution_id,
        )

    def _transform_message(
        self,
        messages: Generator[ToolRuntimeMessage, None, None],
        tool_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
        node_id: str,
        tool_runtime: ToolRuntimeHandle,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        """Convert graph-owned tool runtime messages into node outputs."""
        state = _ToolMessageState()

        for message in messages:
            yield from self._dispatch_message(
                message=message,
                state=state,
                node_id=node_id,
            )

        yield from self._emit_final_stream_events(state)

        usage = self._runtime.get_usage(tool_runtime=tool_runtime)
        metadata = self._build_completion_metadata(tool_info=tool_info, usage=usage)

        yield StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "text": state.text,
                    "files": ArrayFileSegment(value=state.files),
                    "json": self._normalize_json_output(state),
                    **state.variables,
                },
                metadata=metadata,
                inputs=parameters_for_log,
                llm_usage=usage,
            ),
        )

    def transform_message(
        self,
        messages: Generator[ToolRuntimeMessage, None, None],
        tool_info: Mapping[str, Any],
        parameters_for_log: dict[str, Any],
        node_id: str,
        tool_runtime: ToolRuntimeHandle,
        **kwargs: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        """Convert tool runtime messages using the node's public test seam."""
        yield from self._transform_message(
            messages=messages,
            tool_info=tool_info,
            parameters_for_log=parameters_for_log,
            node_id=node_id,
            tool_runtime=tool_runtime,
            **kwargs,
        )

    def _dispatch_message(
        self,
        *,
        message: ToolRuntimeMessage,
        state: _ToolMessageState,
        node_id: str,
    ) -> Generator[NodeEventPayload, None, None]:
        match message.type:
            case (
                ToolRuntimeMessage.MessageType.IMAGE_LINK
                | ToolRuntimeMessage.MessageType.BINARY_LINK
                | ToolRuntimeMessage.MessageType.IMAGE
            ):
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.TextMessage,
                )
                yield from self._handle_linked_file_message(
                    payload=payload,
                    meta=message.meta,
                    state=state,
                )
            case ToolRuntimeMessage.MessageType.BLOB:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.BlobMessage,
                )
                yield from self._handle_blob_message(
                    payload=payload,
                    meta=message.meta,
                    state=state,
                )
            case ToolRuntimeMessage.MessageType.BLOB_CHUNK:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.BlobChunkMessage,
                )
                yield from self._handle_blob_chunk_message(
                    payload=payload,
                    meta=message.meta,
                    state=state,
                )
            case ToolRuntimeMessage.MessageType.TEXT:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.TextMessage,
                )
                yield from self._handle_text_message(
                    payload=payload,
                    state=state,
                    node_id=node_id,
                )
            case ToolRuntimeMessage.MessageType.JSON:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.JsonMessage,
                )
                yield from self._handle_json_message(
                    payload=payload,
                    state=state,
                )
            case ToolRuntimeMessage.MessageType.LINK:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.TextMessage,
                )
                yield from self._handle_link_message(
                    payload=payload,
                    meta=message.meta,
                    state=state,
                    node_id=node_id,
                )
            case ToolRuntimeMessage.MessageType.VARIABLE:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.VariableMessage,
                )
                yield from self._handle_variable_message(
                    payload=payload,
                    state=state,
                    node_id=node_id,
                )
            case ToolRuntimeMessage.MessageType.FILE:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.FileMessage,
                )
                meta = self._require_message_meta(message=message)
                yield from self._handle_file_message(
                    payload=payload,
                    meta=meta,
                    state=state,
                )
            case ToolRuntimeMessage.MessageType.LOG:
                payload = self._expect_message_payload(
                    message=message,
                    payload_type=ToolRuntimeMessage.LogMessage,
                )
                yield from self._handle_log_message(payload=payload)
            case _:
                yield from ()

    def _require_message_meta(
        self,
        *,
        message: ToolRuntimeMessage,
    ) -> dict[str, Any]:
        if message.meta is None:
            msg = f"Tool message {message.type} is missing metadata."
            raise ToolNodeError(msg)
        return message.meta

    def _expect_message_payload[PayloadT](
        self,
        *,
        message: ToolRuntimeMessage,
        payload_type: type[PayloadT],
    ) -> PayloadT:
        payload = message.message
        if not isinstance(payload, payload_type):
            msg = (
                f"Expected {payload_type.__name__} payload for tool message "
                f"{message.type}, got {type(payload).__name__}."
            )
            raise ToolNodeError(msg)
        return payload

    def _resolve_tool_file(self, tool_file_id: str, *, missing_message: str) -> File:
        _stream, tool_file = self._tool_file_manager.get_file_generator_by_tool_file_id(
            tool_file_id,
        )
        if not tool_file:
            raise ToolFileError(missing_message)
        return tool_file

    def _handle_linked_file_message(
        self,
        *,
        payload: ToolRuntimeMessage.TextMessage,
        meta: Mapping[str, Any] | None,
        state: _ToolMessageState,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        url = payload.text
        transfer_method = FileTransferMethod.TOOL_FILE
        tool_file_id: str | None = None
        if meta:
            transfer_method = meta.get(
                "transfer_method",
                FileTransferMethod.TOOL_FILE,
            )
            tool_file_id = meta.get("tool_file_id")
        if not isinstance(tool_file_id, str) or not tool_file_id:
            msg = "tool message is missing tool_file_id metadata"
            raise ToolFileError(msg)

        tool_file = self._resolve_tool_file(
            tool_file_id,
            missing_message=f"tool file {tool_file_id} not found",
        )
        if tool_file.mime_type is None:
            msg = f"tool file {tool_file_id} is missing mime type"
            raise ToolFileError(msg)

        file_mapping: dict[str, Any] = {
            "tool_file_id": tool_file_id,
            "type": get_file_type_by_mime_type(tool_file.mime_type),
            "transfer_method": transfer_method,
            "url": url,
        }
        state.files.append(self._runtime.build_file_reference(mapping=file_mapping))
        yield from ()

    def _handle_blob_message(
        self,
        *,
        payload: ToolRuntimeMessage.BlobMessage,
        meta: Mapping[str, Any] | None,
        state: _ToolMessageState,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        tool_file_id = (meta or {}).get("tool_file_id")
        if isinstance(tool_file_id, str) and tool_file_id:
            self._resolve_tool_file(
                tool_file_id,
                missing_message=f"tool file {tool_file_id} not exists",
            )
        else:
            tool_file_id = self._save_blob_as_tool_file(payload=payload, meta=meta)

        blob_file_mapping: dict[str, Any] = {
            "tool_file_id": tool_file_id,
            "transfer_method": FileTransferMethod.TOOL_FILE,
        }
        state.files.append(
            self._runtime.build_file_reference(mapping=blob_file_mapping),
        )
        yield from ()

    def _save_blob_as_tool_file(
        self,
        *,
        payload: ToolRuntimeMessage.BlobMessage,
        meta: Mapping[str, Any] | None,
    ) -> str:
        metadata = dict(meta or {})
        mimetype = str(
            metadata.get("mime_type")
            or metadata.get("mimetype")
            or "application/octet-stream",
        )
        raw_filename = metadata.get("filename")
        filename = raw_filename if isinstance(raw_filename, str) else None
        try:
            tool_file = self._tool_file_manager.create_file_by_raw(
                file_binary=payload.blob,
                mimetype=mimetype,
                filename=filename,
            )
        except Exception as error:
            raise ToolFileError(str(error)) from error

        tool_file_id = tool_file.id
        if not isinstance(tool_file_id, str) or not tool_file_id:
            msg = "created tool file is missing id"
            raise ToolFileError(msg)
        return tool_file_id

    def _handle_blob_chunk_message(
        self,
        *,
        payload: ToolRuntimeMessage.BlobChunkMessage,
        meta: Mapping[str, Any] | None,
        state: _ToolMessageState,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        if not payload.id:
            msg = "tool blob chunk message is missing id"
            raise ToolFileError(msg)
        if payload.total_length < 0:
            msg = "tool blob chunk total_length must be non-negative"
            raise ToolFileError(msg)

        chunk_state = state.blob_chunks.get(payload.id)
        if chunk_state is None:
            chunk_state = _BlobChunkState(total_length=payload.total_length)
            state.blob_chunks[payload.id] = chunk_state
        elif chunk_state.total_length != payload.total_length:
            msg = f"tool blob chunk {payload.id} changed total_length"
            raise ToolFileError(msg)

        next_offset = chunk_state.bytes_written + len(payload.blob)
        if next_offset > chunk_state.total_length:
            msg = f"tool blob chunk {payload.id} exceeds declared total_length"
            raise ToolFileError(msg)
        chunk_state.data[chunk_state.bytes_written : next_offset] = payload.blob
        chunk_state.bytes_written = next_offset

        if payload.end:
            del state.blob_chunks[payload.id]
            yield from self._handle_blob_message(
                payload=ToolRuntimeMessage.BlobMessage(
                    blob=bytes(chunk_state.data[: chunk_state.bytes_written]),
                ),
                meta=meta,
                state=state,
            )
        yield from ()

    def _handle_text_message(
        self,
        *,
        payload: ToolRuntimeMessage.TextMessage,
        state: _ToolMessageState,
        node_id: str,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        state.text += payload.text
        yield StreamChunkEvent(
            selector=[node_id, "text"],
            chunk=payload.text,
            is_final=False,
        )

    def _handle_json_message(
        self,
        *,
        payload: ToolRuntimeMessage.JsonMessage,
        state: _ToolMessageState,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        if payload.json_object:
            state.json_values.append(payload.json_object)
        yield from ()

    def _handle_link_message(
        self,
        *,
        payload: ToolRuntimeMessage.TextMessage,
        meta: Mapping[str, Any] | None,
        state: _ToolMessageState,
        node_id: str,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        file_obj = (meta or {}).get("file")
        if isinstance(file_obj, File):
            state.files.append(file_obj)
            stream_text = f"File: {payload.text}\n"
        else:
            stream_text = f"Link: {payload.text}\n"

        state.text += stream_text
        yield StreamChunkEvent(
            selector=[node_id, "text"],
            chunk=stream_text,
            is_final=False,
        )

    def _handle_variable_message(
        self,
        *,
        payload: ToolRuntimeMessage.VariableMessage,
        state: _ToolMessageState,
        node_id: str,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        variable_name = payload.variable_name
        variable_value = payload.variable_value

        if not payload.stream:
            state.variables[variable_name] = variable_value
            yield from ()
            return

        if not isinstance(variable_value, str):
            msg = "When 'stream' is True, 'variable_value' must be a string."
            raise ToolNodeError(msg)
        if variable_name not in state.variables:
            state.variables[variable_name] = ""
        state.variables[variable_name] += variable_value
        yield StreamChunkEvent(
            selector=[node_id, variable_name],
            chunk=variable_value,
            is_final=False,
        )

    def _handle_file_message(
        self,
        *,
        payload: ToolRuntimeMessage.FileMessage,
        meta: Mapping[str, Any],
        state: _ToolMessageState,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        del payload
        if "file" not in meta:
            msg = "File message is missing 'file' key in meta"
            raise ToolNodeError(msg)

        file_obj = meta["file"]
        if not isinstance(file_obj, File):
            msg = f"Expected File object but got {type(file_obj).__name__}"
            raise ToolNodeError(msg)

        state.files.append(file_obj)
        yield from ()

    def _handle_log_message(
        self,
        *,
        payload: ToolRuntimeMessage.LogMessage,
        **_: Any,
    ) -> Generator[NodeEventPayload, None, None]:
        del payload
        yield from ()

    def _emit_final_stream_events(
        self,
        state: _ToolMessageState,
    ) -> Generator[NodeEventPayload, None, None]:
        if state.blob_chunks:
            pending_ids = ", ".join(sorted(state.blob_chunks))
            msg = f"tool blob chunk stream ended before completion: {pending_ids}"
            raise ToolFileError(msg)

        yield StreamChunkEvent(
            selector=[self._node_id, "text"],
            chunk="",
            is_final=True,
        )
        for var_name in state.variables:
            yield StreamChunkEvent(
                selector=[self._node_id, var_name],
                chunk="",
                is_final=True,
            )

    @staticmethod
    def _normalize_json_output(
        state: _ToolMessageState,
    ) -> list[dict[str, Any] | list[Any]]:
        if state.json_values:
            return [*state.json_values]
        return [{"data": []}]

    @staticmethod
    def _build_completion_metadata(
        *,
        tool_info: Mapping[str, Any],
        usage: Any,
    ) -> dict[WorkflowNodeExecutionMetadataKey, Any]:
        metadata: dict[WorkflowNodeExecutionMetadataKey, Any] = {
            WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info,
        }
        if isinstance(usage.total_tokens, int) and usage.total_tokens > 0:
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] = usage.total_tokens
            metadata[WorkflowNodeExecutionMetadataKey.TOTAL_PRICE] = usage.total_price
            metadata[WorkflowNodeExecutionMetadataKey.CURRENCY] = usage.currency
        return metadata

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: ToolNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """Extract the variable-selector mapping referenced by tool parameters."""
        _ = graph_config  # Explicitly mark as unused
        typed_node_data = node_data
        result = {}
        for parameter_name in typed_node_data.tool_parameters:
            tool_input = typed_node_data.tool_parameters[parameter_name]
            match tool_input.type:
                case ToolInputType.MIXED:
                    if not isinstance(tool_input.value, str):
                        msg = "Mixed tool input value must be a string."
                        raise TypeError(msg)
                    selectors = VariableTemplateParser(
                        tool_input.value,
                    ).extract_variable_selectors()
                    for selector in selectors:
                        result[selector.variable] = selector.value_selector
                case ToolInputType.VARIABLE:
                    if not _is_variable_selector(tool_input.value):
                        msg = "Variable tool input value must be a list of strings."
                        raise TypeError(msg)
                    selector_key = ".".join(tool_input.value)
                    result[f"#{selector_key}#"] = tool_input.value
                case ToolInputType.CONSTANT:
                    pass

        return {node_id + "." + key: value for key, value in result.items()}

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled
