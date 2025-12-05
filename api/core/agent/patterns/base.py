"""Base class for agent strategies."""

from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod
from collections.abc import Callable, Generator
from typing import TYPE_CHECKING, Any

from core.agent.entities import AgentLog, AgentResult, ExecutionContext
from core.file import File
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    PromptMessage,
    PromptMessageTool,
)
from core.model_runtime.entities.llm_entities import LLMUsage
from core.model_runtime.entities.message_entities import TextPromptMessageContent
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolInvokeMeta

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool

# Type alias for tool invoke hook
# Returns: (response_content, message_file_ids, tool_invoke_meta)
ToolInvokeHook = Callable[["Tool", dict[str, Any], str], tuple[str, list[str], ToolInvokeMeta]]


class AgentPattern(ABC):
    """Base class for agent execution strategies."""

    def __init__(
        self,
        model_instance: ModelInstance,
        tools: list[Tool],
        context: ExecutionContext,
        max_iterations: int = 10,
        workflow_call_depth: int = 0,
        files: list[File] = [],
        tool_invoke_hook: ToolInvokeHook | None = None,
    ):
        """Initialize the agent strategy."""
        self.model_instance = model_instance
        self.tools = tools
        self.context = context
        self.max_iterations = min(max_iterations, 99)  # Cap at 99 iterations
        self.workflow_call_depth = workflow_call_depth
        self.files: list[File] = files
        self.tool_invoke_hook = tool_invoke_hook

    @abstractmethod
    def run(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any],
        stop: list[str] = [],
        stream: bool = True,
    ) -> Generator[LLMResultChunk | AgentLog, None, AgentResult]:
        """Execute the agent strategy."""
        pass

    def _accumulate_usage(self, total_usage: dict[str, Any], delta_usage: LLMUsage) -> None:
        """Accumulate LLM usage statistics."""
        if not total_usage.get("usage"):
            # Create a copy to avoid modifying the original
            total_usage["usage"] = LLMUsage(
                prompt_tokens=delta_usage.prompt_tokens,
                prompt_unit_price=delta_usage.prompt_unit_price,
                prompt_price_unit=delta_usage.prompt_price_unit,
                prompt_price=delta_usage.prompt_price,
                completion_tokens=delta_usage.completion_tokens,
                completion_unit_price=delta_usage.completion_unit_price,
                completion_price_unit=delta_usage.completion_price_unit,
                completion_price=delta_usage.completion_price,
                total_tokens=delta_usage.total_tokens,
                total_price=delta_usage.total_price,
                currency=delta_usage.currency,
                latency=delta_usage.latency,
            )
        else:
            current: LLMUsage = total_usage["usage"]
            current.prompt_tokens += delta_usage.prompt_tokens
            current.completion_tokens += delta_usage.completion_tokens
            current.total_tokens += delta_usage.total_tokens
            current.prompt_price += delta_usage.prompt_price
            current.completion_price += delta_usage.completion_price
            current.total_price += delta_usage.total_price

    def _extract_content(self, content: Any) -> str:
        """Extract text content from message content."""
        if isinstance(content, list):
            # Content items are PromptMessageContentUnionTypes
            text_parts = []
            for c in content:
                # Check if it's a TextPromptMessageContent (which has data attribute)
                if isinstance(c, TextPromptMessageContent):
                    text_parts.append(c.data)
            return "".join(text_parts)
        return str(content)

    def _has_tool_calls(self, chunk: LLMResultChunk) -> bool:
        """Check if chunk contains tool calls."""
        # LLMResultChunk always has delta attribute
        return bool(chunk.delta.message and chunk.delta.message.tool_calls)

    def _has_tool_calls_result(self, result: LLMResult) -> bool:
        """Check if result contains tool calls (non-streaming)."""
        # LLMResult always has message attribute
        return bool(result.message and result.message.tool_calls)

    def _extract_tool_calls(self, chunk: LLMResultChunk) -> list[tuple[str, str, dict[str, Any]]]:
        """Extract tool calls from streaming chunk."""
        tool_calls: list[tuple[str, str, dict[str, Any]]] = []
        if chunk.delta.message and chunk.delta.message.tool_calls:
            for tool_call in chunk.delta.message.tool_calls:
                if tool_call.function:
                    try:
                        args = json.loads(tool_call.function.arguments) if tool_call.function.arguments else {}
                    except json.JSONDecodeError:
                        args = {}
                    tool_calls.append((tool_call.id or "", tool_call.function.name, args))
        return tool_calls

    def _extract_tool_calls_result(self, result: LLMResult) -> list[tuple[str, str, dict[str, Any]]]:
        """Extract tool calls from non-streaming result."""
        tool_calls = []
        if result.message and result.message.tool_calls:
            for tool_call in result.message.tool_calls:
                if tool_call.function:
                    try:
                        args = json.loads(tool_call.function.arguments) if tool_call.function.arguments else {}
                    except json.JSONDecodeError:
                        args = {}
                    tool_calls.append((tool_call.id or "", tool_call.function.name, args))
        return tool_calls

    def _extract_text_from_message(self, message: PromptMessage) -> str:
        """Extract text content from a prompt message."""
        # PromptMessage always has content attribute
        content = message.content
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            # Extract text from content list
            text_parts = []
            for item in content:
                if isinstance(item, TextPromptMessageContent):
                    text_parts.append(item.data)
            return " ".join(text_parts)
        return ""

    def _create_log(
        self,
        label: str,
        log_type: AgentLog.LogType,
        status: AgentLog.LogStatus,
        data: dict[str, Any] | None = None,
        parent_id: str | None = None,
        extra_metadata: dict[AgentLog.LogMetadata, Any] | None = None,
    ) -> AgentLog:
        """Create a new AgentLog with standard metadata."""
        metadata = {
            AgentLog.LogMetadata.STARTED_AT: time.perf_counter(),
        }
        if extra_metadata:
            metadata.update(extra_metadata)

        return AgentLog(
            label=label,
            log_type=log_type,
            status=status,
            data=data or {},
            parent_id=parent_id,
            metadata=metadata,
        )

    def _finish_log(
        self,
        log: AgentLog,
        data: dict[str, Any] | None = None,
        usage: LLMUsage | None = None,
    ) -> AgentLog:
        """Finish an AgentLog by updating its status and metadata."""
        log.status = AgentLog.LogStatus.SUCCESS

        if data is not None:
            log.data = data

        # Calculate elapsed time
        started_at = log.metadata.get(AgentLog.LogMetadata.STARTED_AT, time.perf_counter())
        finished_at = time.perf_counter()

        # Update metadata
        log.metadata = {
            **log.metadata,
            AgentLog.LogMetadata.FINISHED_AT: finished_at,
            AgentLog.LogMetadata.ELAPSED_TIME: finished_at - started_at,
        }

        # Add usage information if provided
        if usage:
            log.metadata.update(
                {
                    AgentLog.LogMetadata.TOTAL_PRICE: usage.total_price,
                    AgentLog.LogMetadata.CURRENCY: usage.currency,
                    AgentLog.LogMetadata.TOTAL_TOKENS: usage.total_tokens,
                    AgentLog.LogMetadata.LLM_USAGE: usage,
                }
            )

        return log

    def _replace_file_references(self, tool_args: dict[str, Any]) -> dict[str, Any]:
        """
        Replace file references in tool arguments with actual File objects.

        Args:
            tool_args: Dictionary of tool arguments

        Returns:
            Updated tool arguments with file references replaced
        """
        # Process each argument in the dictionary
        processed_args: dict[str, Any] = {}
        for key, value in tool_args.items():
            processed_args[key] = self._process_file_reference(value)
        return processed_args

    def _process_file_reference(self, data: Any) -> Any:
        """
        Recursively process data to replace file references.
        Supports both single file [File: file_id] and multiple files [Files: file_id1, file_id2, ...].

        Args:
            data: The data to process (can be dict, list, str, or other types)

        Returns:
            Processed data with file references replaced
        """
        single_file_pattern = re.compile(r"^\[File:\s*([^\]]+)\]$")
        multiple_files_pattern = re.compile(r"^\[Files:\s*([^\]]+)\]$")

        if isinstance(data, dict):
            # Process dictionary recursively
            return {key: self._process_file_reference(value) for key, value in data.items()}
        elif isinstance(data, list):
            # Process list recursively
            return [self._process_file_reference(item) for item in data]
        elif isinstance(data, str):
            # Check for single file pattern [File: file_id]
            single_match = single_file_pattern.match(data.strip())
            if single_match:
                file_id = single_match.group(1).strip()
                # Find the file in self.files
                for file in self.files:
                    if file.id and str(file.id) == file_id:
                        return file
                # If file not found, return original value
                return data

            # Check for multiple files pattern [Files: file_id1, file_id2, ...]
            multiple_match = multiple_files_pattern.match(data.strip())
            if multiple_match:
                file_ids_str = multiple_match.group(1).strip()
                # Split by comma and strip whitespace
                file_ids = [fid.strip() for fid in file_ids_str.split(",")]

                # Find all matching files
                matched_files: list[File] = []
                for file_id in file_ids:
                    for file in self.files:
                        if file.id and str(file.id) == file_id:
                            matched_files.append(file)
                            break

                # Return list of files if any were found, otherwise return original
                return matched_files or data

            return data
        else:
            # Return other types as-is
            return data

    def _create_text_chunk(self, text: str, prompt_messages: list[PromptMessage]) -> LLMResultChunk:
        """Create a text chunk for streaming."""
        return LLMResultChunk(
            model=self.model_instance.model,
            prompt_messages=prompt_messages,
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=text),
                usage=None,
            ),
            system_fingerprint="",
        )

    def _invoke_tool(
        self,
        tool_instance: Tool,
        tool_args: dict[str, Any],
        tool_name: str,
    ) -> tuple[str, list[File], ToolInvokeMeta | None]:
        """
        Invoke a tool and collect its response.

        Args:
            tool_instance: The tool instance to invoke
            tool_args: Tool arguments
            tool_name: Name of the tool

        Returns:
            Tuple of (response_content, tool_files, tool_invoke_meta)
        """
        # Process tool_args to replace file references with actual File objects
        tool_args = self._replace_file_references(tool_args)

        # If a tool invoke hook is set, use it instead of generic_invoke
        if self.tool_invoke_hook:
            response_content, _, tool_invoke_meta = self.tool_invoke_hook(tool_instance, tool_args, tool_name)
            # Note: message_file_ids are stored in DB, we don't convert them to File objects here
            # The caller (AgentAppRunner) handles file publishing
            return response_content, [], tool_invoke_meta

        # Default: use generic_invoke for workflow scenarios
        # Import here to avoid circular import
        from core.tools.tool_engine import DifyWorkflowCallbackHandler, ToolEngine

        tool_response = ToolEngine().generic_invoke(
            tool=tool_instance,
            tool_parameters=tool_args,
            user_id=self.context.user_id or "",
            workflow_tool_callback=DifyWorkflowCallbackHandler(),
            workflow_call_depth=self.workflow_call_depth,
            app_id=self.context.app_id,
            conversation_id=self.context.conversation_id,
            message_id=self.context.message_id,
        )

        # Collect response and files
        response_content = ""
        tool_files: list[File] = []

        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                assert isinstance(response.message, ToolInvokeMessage.TextMessage)
                response_content += response.message.text

            elif response.type == ToolInvokeMessage.MessageType.LINK:
                # Handle link messages
                if isinstance(response.message, ToolInvokeMessage.TextMessage):
                    response_content += f"[Link: {response.message.text}]"

            elif response.type == ToolInvokeMessage.MessageType.IMAGE:
                # Handle image URL messages
                if isinstance(response.message, ToolInvokeMessage.TextMessage):
                    response_content += f"[Image: {response.message.text}]"

            elif response.type == ToolInvokeMessage.MessageType.IMAGE_LINK:
                # Handle image link messages
                if isinstance(response.message, ToolInvokeMessage.TextMessage):
                    response_content += f"[Image: {response.message.text}]"

            elif response.type == ToolInvokeMessage.MessageType.BINARY_LINK:
                # Handle binary file link messages
                if isinstance(response.message, ToolInvokeMessage.TextMessage):
                    filename = response.meta.get("filename", "file") if response.meta else "file"
                    response_content += f"[File: {filename} - {response.message.text}]"

            elif response.type == ToolInvokeMessage.MessageType.JSON:
                # Handle JSON messages
                if isinstance(response.message, ToolInvokeMessage.JsonMessage):
                    response_content += json.dumps(response.message.json_object, ensure_ascii=False, indent=2)

            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                # Handle blob messages - convert to text representation
                if isinstance(response.message, ToolInvokeMessage.BlobMessage):
                    mime_type = (
                        response.meta.get("mime_type", "application/octet-stream")
                        if response.meta
                        else "application/octet-stream"
                    )
                    size = len(response.message.blob)
                    response_content += f"[Binary data: {mime_type}, size: {size} bytes]"

            elif response.type == ToolInvokeMessage.MessageType.VARIABLE:
                # Handle variable messages
                if isinstance(response.message, ToolInvokeMessage.VariableMessage):
                    var_name = response.message.variable_name
                    var_value = response.message.variable_value
                    if isinstance(var_value, str):
                        response_content += var_value
                    else:
                        response_content += f"[Variable {var_name}: {json.dumps(var_value, ensure_ascii=False)}]"

            elif response.type == ToolInvokeMessage.MessageType.BLOB_CHUNK:
                # Handle blob chunk messages - these are parts of a larger blob
                if isinstance(response.message, ToolInvokeMessage.BlobChunkMessage):
                    response_content += f"[Blob chunk {response.message.sequence}: {len(response.message.blob)} bytes]"

            elif response.type == ToolInvokeMessage.MessageType.RETRIEVER_RESOURCES:
                # Handle retriever resources messages
                if isinstance(response.message, ToolInvokeMessage.RetrieverResourceMessage):
                    response_content += response.message.context

            elif response.type == ToolInvokeMessage.MessageType.FILE:
                # Extract file from meta
                if response.meta and "file" in response.meta:
                    file = response.meta["file"]
                    if isinstance(file, File):
                        # Check if file is for model or tool output
                        if response.meta.get("target") == "self":
                            # File is for model - add to files for next prompt
                            self.files.append(file)
                            response_content += f"File '{file.filename}' has been loaded into your context."
                        else:
                            # File is tool output
                            tool_files.append(file)

        return response_content, tool_files, None

    def _find_tool_by_name(self, tool_name: str) -> Tool | None:
        """Find a tool instance by its name."""
        for tool in self.tools:
            if tool.entity.identity.name == tool_name:
                return tool
        return None

    def _convert_tools_to_prompt_format(self) -> list[PromptMessageTool]:
        """Convert tools to prompt message format."""
        prompt_tools: list[PromptMessageTool] = []
        for tool in self.tools:
            prompt_tools.append(tool.to_prompt_message_tool())
        return prompt_tools

    def _update_usage_with_empty(self, llm_usage: dict[str, Any]) -> None:
        """Initialize usage tracking with empty usage if not set."""
        if "usage" not in llm_usage or llm_usage["usage"] is None:
            llm_usage["usage"] = LLMUsage.empty_usage()
