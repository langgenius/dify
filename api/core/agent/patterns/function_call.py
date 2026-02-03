"""Function Call strategy implementation."""

import json
import uuid
from collections.abc import Generator
from typing import Any, Literal, Protocol, Union, cast

from core.agent.entities import AgentLog, AgentResult
from core.agent.output_tools import (
    ILLEGAL_OUTPUT_TOOL,
    TERMINAL_OUTPUT_MESSAGE,
)
from core.file import File
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMUsage,
    PromptMessage,
    PromptMessageTool,
    ToolPromptMessage,
)
from core.tools.entities.tool_entities import ToolInvokeMeta

from .base import AgentPattern


class FunctionCallStrategy(AgentPattern):
    """Function Call strategy using model's native tool calling capability."""

    def run(
        self, prompt_messages: list[PromptMessage], model_parameters: dict[str, Any], stop: list[str]
    ) -> Generator[LLMResultChunk | AgentLog, None, AgentResult]:
        """Execute the function call agent strategy."""
        # Convert tools to prompt format
        prompt_tools: list[PromptMessageTool] = self._convert_tools_to_prompt_format()

        # Initialize tracking
        iteration_step: int = 1
        max_iterations: int = self.max_iterations + 1
        function_call_state: bool = True
        total_usage: dict[str, LLMUsage | None] = {"usage": None}
        messages: list[PromptMessage] = list(prompt_messages)  # Create mutable copy
        final_text: str = ""
        final_tool_args: dict[str, Any] = {"!!!": "!!!"}
        finish_reason: str | None = None
        output_files: list[File] = []  # Track files produced by tools

        class _LLMInvoker(Protocol):
            def invoke_llm(
                self,
                *,
                prompt_messages: list[PromptMessage],
                model_parameters: dict[str, Any],
                tools: list[PromptMessageTool],
                stop: list[str],
                stream: Literal[False],
                user: str | None,
                callbacks: list[Any],
            ) -> LLMResult: ...

        while function_call_state and iteration_step <= max_iterations:
            function_call_state = False
            round_log = self._create_log(
                label=f"ROUND {iteration_step}",
                log_type=AgentLog.LogType.ROUND,
                status=AgentLog.LogStatus.START,
                data={},
            )
            yield round_log

            model_log = self._create_log(
                label=f"{self.model_instance.model} Thought",
                log_type=AgentLog.LogType.THOUGHT,
                status=AgentLog.LogStatus.START,
                data={},
                parent_id=round_log.id,
                extra_metadata={
                    AgentLog.LogMetadata.PROVIDER: self.model_instance.provider,
                },
            )
            yield model_log

            # Track usage for this round only
            round_usage: dict[str, LLMUsage | None] = {"usage": None}

            # Invoke model
            invoker = cast(_LLMInvoker, self.model_instance)
            chunks = invoker.invoke_llm(
                prompt_messages=messages,
                model_parameters=model_parameters,
                tools=prompt_tools,
                stop=stop,
                stream=False,
                user=self.context.user_id,
                callbacks=[],
            )

            # Process response
            tool_calls, response_content, chunk_finish_reason = yield from self._handle_chunks(
                chunks, round_usage, model_log, emit_chunks=False
            )

            if response_content:
                replaced_tool_call = (
                    str(uuid.uuid4()),
                    ILLEGAL_OUTPUT_TOOL,
                    {
                        "raw": response_content,
                    },
                )
                tool_calls.append(replaced_tool_call)

            messages.append(self._create_assistant_message("", tool_calls))

            # Accumulate to total usage
            round_usage_value = round_usage.get("usage")
            if round_usage_value:
                self._accumulate_usage(total_usage, round_usage_value)

            # Update finish reason
            if chunk_finish_reason:
                finish_reason = chunk_finish_reason

            assert len(tool_calls) > 0

            # Process tool calls
            tool_outputs: dict[str, str] = {}
            function_call_state = True
            # Execute tools
            for tool_call_id, tool_name, tool_args in tool_calls:
                tool_response, tool_files, _ = yield from self._handle_tool_call(
                    tool_name, tool_args, tool_call_id, messages, round_log
                )
                tool_entity = self._find_tool_by_name(tool_name)
                if not tool_entity:
                    raise ValueError(f"Tool {tool_name} not found")
                tool_outputs[tool_name] = tool_response
                # Track files produced by tools
                output_files.extend(tool_files)
                if tool_response == TERMINAL_OUTPUT_MESSAGE:
                    function_call_state = False
                    final_tool_args = tool_entity.transform_tool_parameters_type(tool_args)

            yield self._finish_log(
                round_log,
                data={
                    "llm_result": response_content,
                    "tool_calls": [
                        {"name": tc[1], "args": tc[2], "output": tool_outputs.get(tc[1], "")} for tc in tool_calls
                    ]
                    if tool_calls
                    else [],
                    "final_answer": final_text if not function_call_state else None,
                },
                usage=round_usage.get("usage"),
            )
            iteration_step += 1

        # Return final result
        from core.agent.entities import AgentResult

        output_payload: str | dict
        output_text = final_tool_args.get("text")
        output_structured_payload = final_tool_args.get("data")

        if isinstance(output_structured_payload, dict):
            output_payload = output_structured_payload
        elif isinstance(output_text, str):
            output_payload = output_text
        else:
            raise ValueError(f"Final output ({final_tool_args}) is not a string or structured data.")

        return AgentResult(
            output=output_payload,
            files=output_files,
            usage=total_usage.get("usage") or LLMUsage.empty_usage(),
            finish_reason=finish_reason,
        )

    def _handle_chunks(
        self,
        chunks: Union[Generator[LLMResultChunk, None, None], LLMResult],
        llm_usage: dict[str, LLMUsage | None],
        start_log: AgentLog,
        *,
        emit_chunks: bool,
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

                if emit_chunks:
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
            if emit_chunks:
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
            usage=llm_usage.get("usage"),
        )
        return tool_calls, response_content, finish_reason

    @staticmethod
    def _format_output_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False)

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
    ) -> Generator[AgentLog, None, tuple[str, list[File], ToolInvokeMeta | None]]:
        """Handle a single tool call and return response with files and meta."""
        # Find tool
        tool_instance = self._find_tool_by_name(tool_name)
        if not tool_instance:
            raise ValueError(f"Tool {tool_name} not found")

        # Get tool metadata (provider, icon, etc.)
        tool_metadata = self._get_tool_metadata(tool_instance)

        # Create tool call log
        tool_call_log = self._create_log(
            label=f"CALL {tool_name}",
            log_type=AgentLog.LogType.TOOL_CALL,
            status=AgentLog.LogStatus.START,
            data={
                "tool_call_id": tool_call_id,
                "tool_name": tool_name,
                "tool_args": tool_args,
            },
            parent_id=round_log.id,
            extra_metadata=tool_metadata,
        )
        yield tool_call_log

        # Invoke tool using base class method with error handling
        try:
            response_content, tool_files, tool_invoke_meta = self._invoke_tool(tool_instance, tool_args, tool_name)

            yield self._finish_log(
                tool_call_log,
                data={
                    **tool_call_log.data,
                    "output": response_content,
                    "files": len(tool_files),
                    "meta": tool_invoke_meta.to_dict() if tool_invoke_meta else None,
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
            return response_content, tool_files, tool_invoke_meta
        except Exception as e:
            # Tool invocation failed, yield error log
            error_message = str(e)
            tool_call_log.status = AgentLog.LogStatus.ERROR
            tool_call_log.error = error_message
            tool_call_log.data = {
                **tool_call_log.data,
                "error": error_message,
            }
            yield tool_call_log

            # Add error message to conversation
            error_content = f"Tool execution failed: {error_message}"
            messages.append(
                ToolPromptMessage(
                    content=error_content,
                    tool_call_id=tool_call_id,
                    name=tool_name,
                )
            )
            return error_content, [], None
