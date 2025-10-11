"""Function Call strategy implementation."""

import json
import re
from collections.abc import Generator
from typing import Any, Union

from core.agent.entities import AgentLog, AgentResult
from core.file import File
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    PromptMessage,
    PromptMessageTool,
    ToolPromptMessage,
)
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_engine import DifyWorkflowCallbackHandler, ToolEngine
from core.workflow.nodes.llm.node import LLMUsage

from .base import AgentPattern


class FunctionCallStrategy(AgentPattern):
    """Function Call strategy using model's native tool calling capability."""

    def run(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any],
        stop: list[str] = [],
        stream: bool = True,
    ) -> Generator[LLMResultChunk | AgentLog, None, AgentResult]:
        """Execute the function call agent strategy."""
        # Convert tools to prompt format
        prompt_tools: list[PromptMessageTool] = self._convert_tools_to_prompt_format()

        # Initialize tracking
        iteration_step: int = 1
        max_iterations: int = self.max_iterations + 1
        function_call_state: bool = True
        llm_usage: dict[str, LLMUsage] = {"usage": LLMUsage.empty_usage()}
        messages: list[PromptMessage] = list(prompt_messages)  # Create mutable copy
        final_text: str = ""
        finish_reason: str | None = None
        output_files: list[File] = []  # Track files produced by tools

        while function_call_state and iteration_step <= max_iterations:
            function_call_state = False
            round_log = self._create_log(
                label=f"ROUND {iteration_step}",
                status=AgentLog.LogStatus.START,
                data={},
            )
            yield round_log
            # On last iteration, remove tools to force final answer
            current_tools: list[PromptMessageTool] = [] if iteration_step == max_iterations else prompt_tools
            model_log = self._create_log(
                label=f"{self.model_instance.model} Thought",
                status=AgentLog.LogStatus.START,
                data={},
                parent_id=round_log.id,
                extra_metadata={
                    AgentLog.LogMetadata.PROVIDER: self.model_instance.provider,
                },
            )
            yield model_log

            # Invoke model
            chunks: Union[Generator[LLMResultChunk, None, None], LLMResult] = self.model_instance.invoke_llm(
                prompt_messages=messages,
                model_parameters=model_parameters,
                tools=current_tools,
                stop=stop,
                stream=stream,
                user=self.context.user_id,
                callbacks=[],
            )

            # Process response
            tool_calls, response_content, chunk_finish_reason = yield from self._handle_chunks(
                chunks, llm_usage, model_log
            )
            messages.append(self._create_assistant_message(response_content, tool_calls))

            # Update final text if no tool calls (this is likely the final answer)
            if not tool_calls:
                final_text = response_content

            # Update finish reason
            if chunk_finish_reason:
                finish_reason = chunk_finish_reason

            # Process tool calls
            if tool_calls:
                function_call_state = True
                # Execute tools
                for tool_call_id, tool_name, tool_args in tool_calls:
                    response_content, tool_files = yield from self._handle_tool_call(
                        tool_name, tool_args, tool_call_id, messages, round_log
                    )
                    # Track files produced by tools
                    output_files.extend(tool_files)
            yield self._finish_log(
                round_log,
                data={
                    "llm_result": response_content,
                    "tool_result": {
                        "tool_name": tool_calls,
                        "tool_input": [{"name": tool_call[1], "args": tool_call[2]} for tool_call in tool_calls],
                        "tool_output": tool_calls,
                    },
                },
                usage=llm_usage["usage"],
            )
            iteration_step += 1

        # Return final result
        from core.agent.entities import AgentResult

        return AgentResult(text=final_text, files=output_files, usage=llm_usage["usage"], finish_reason=finish_reason)

    def _handle_chunks(
        self,
        chunks: Union[Generator[LLMResultChunk, None, None], LLMResult],
        llm_usage: dict[str, LLMUsage],
        start_log: AgentLog,
    ) -> Generator[
        LLMResultChunk | AgentLog,
        None,
        tuple[list[tuple[str, str, dict[str, Any]]], str, str | None],
    ]:
        """Handle LLM response chunks and extract tool calls and content.

        Returns a tuple of (tool_calls, response_content, finish_reason).
        """
        tool_calls: list[tuple[str, str, dict[str, Any]]] = []
        response_content: str = ""
        finish_reason: str | None = None
        if isinstance(chunks, Generator):
            # Streaming response
            for chunk in chunks:
                # Extract tool calls
                if self._has_tool_calls(chunk):
                    tool_calls.extend(self._extract_tool_calls(chunk))

                # Extract content
                if chunk.delta.message and chunk.delta.message.content:
                    response_content += self._extract_content(chunk.delta.message.content)

                # Track usage
                if chunk.delta.usage:
                    self._accumulate_usage(llm_usage, chunk.delta.usage)

                # Capture finish reason
                if chunk.delta.finish_reason:
                    finish_reason = chunk.delta.finish_reason

                yield chunk
        else:
            # Non-streaming response
            result: LLMResult = chunks

            if self._has_tool_calls_result(result):
                tool_calls.extend(self._extract_tool_calls_result(result))

            if result.message and result.message.content:
                response_content += self._extract_content(result.message.content)

            if result.usage:
                self._accumulate_usage(llm_usage, result.usage)

            # Convert to streaming format
            yield LLMResultChunk(
                model=result.model,
                prompt_messages=result.prompt_messages,
                delta=LLMResultChunkDelta(index=0, message=result.message, usage=result.usage),
            )
        yield self._finish_log(
            start_log,
            data={
                "result": response_content,
            },
            usage=llm_usage["usage"],
        )
        return tool_calls, response_content, finish_reason

    def _convert_tools_to_prompt_format(self) -> list[PromptMessageTool]:
        """Convert tools to prompt message format."""
        prompt_tools: list[PromptMessageTool] = []
        for tool in self.tools:
            prompt_tools.append(tool.to_prompt_message_tool())
        return prompt_tools

    def _create_assistant_message(
        self, content: str, tool_calls: list[tuple[str, str, dict[str, Any]]] | None = None
    ) -> AssistantPromptMessage:
        """Create assistant message with tool calls."""
        if tool_calls is None:
            return AssistantPromptMessage(content=content)
        return AssistantPromptMessage(
            content=content or "",
            tool_calls=[
                AssistantPromptMessage.ToolCall(
                    id=tc[0],
                    type="function",
                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(name=tc[1], arguments=json.dumps(tc[2])),
                )
                for tc in tool_calls
            ],
        )

    def _handle_tool_call(
        self,
        tool_name: str,
        tool_args: dict[str, Any],
        tool_call_id: str,
        messages: list[PromptMessage],
        round_log: AgentLog,
    ) -> Generator[AgentLog, None, tuple[str, list[File]]]:
        """Handle a single tool call and return response with files."""
        # Find tool
        tool_instance: Tool | None = None
        for tool in self.tools:
            if tool.entity.identity.name == tool_name:
                tool_instance = tool
                break

        if not tool_instance:
            raise ValueError(f"Tool {tool_name} not found")

        # Inject files from tool_file_map if available
        # Process tool_args to replace file references with actual File objects
        tool_args = self._replace_file_references(tool_args)

        # Invoke tool

        # Use invoke method instead of generic_invoke for agent usage
        tool_call_log = self._create_log(
            label=f"CALL {tool_name}",
            status=AgentLog.LogStatus.START,
            data={
                "input": {
                    "name": tool_name,
                    "args": tool_args,
                },
            },
            parent_id=round_log.id,
        )
        yield tool_call_log
        tool_response: Generator[ToolInvokeMessage, None, None] = ToolEngine().generic_invoke(
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
        response_content: str = ""
        tool_files: list[File] = []

        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.TEXT:
                assert isinstance(response.message, ToolInvokeMessage.TextMessage)
                response_content += response.message.text
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

        yield self._finish_log(
            tool_call_log,
            data={
                **tool_call_log.data,
                "output": response_content,
                "files": len(tool_files),
            },
        )
        final_content = response_content or "Tool executed successfully"
        # Add tool response to messages
        messages.append(
            ToolPromptMessage(
                content=final_content,
                tool_call_id=tool_call_id,
                name=tool_name,
            )
        )
        return response_content, tool_files

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
                    if hasattr(file, "id") and str(file.id) == file_id:
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
                        if hasattr(file, "related_id") and str(file.related_id) == file_id:
                            matched_files.append(file)
                            break

                # Return list of files if any were found, otherwise return original
                return matched_files or data

            return data
        else:
            # Return other types as-is
            return data
