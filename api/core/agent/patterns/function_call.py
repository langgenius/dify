"""Function Call strategy implementation."""

import json
import uuid
from collections.abc import Generator
from typing import Any, Literal, Protocol, Union, cast

from core.agent.entities import AgentLog, AgentOutputKind, AgentResult
from core.agent.output_tools import (
    FINAL_OUTPUT_TOOL,
    FINAL_STRUCTURED_OUTPUT_TOOL,
    ILLEGAL_OUTPUT_TOOL,
    OUTPUT_TEXT_TOOL,
    OUTPUT_TOOL_NAME_SET,
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
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any],
        stop: list[str] = [],
        stream: bool = True,
    ) -> Generator[LLMResultChunk | AgentLog, None, AgentResult]:
        """Execute the function call agent strategy."""
        # Convert tools to prompt format
        prompt_tools: list[PromptMessageTool] = self._convert_tools_to_prompt_format()
        available_output_tool_names = {tool.name for tool in prompt_tools if tool.name in OUTPUT_TOOL_NAME_SET}
        if FINAL_STRUCTURED_OUTPUT_TOOL in available_output_tool_names:
            terminal_tool_name = FINAL_STRUCTURED_OUTPUT_TOOL
        elif FINAL_OUTPUT_TOOL in available_output_tool_names:
            terminal_tool_name = FINAL_OUTPUT_TOOL
        else:
            raise ValueError("No terminal output tool configured")
        allow_illegal_output = ILLEGAL_OUTPUT_TOOL in available_output_tool_names

        # Initialize tracking
        iteration_step: int = 1
        max_iterations: int = self.max_iterations + 1
        function_call_state: bool = True
        total_usage: dict[str, LLMUsage | None] = {"usage": None}
        messages: list[PromptMessage] = list(prompt_messages)  # Create mutable copy
        final_text: str = ""
        structured_output_payload: dict[str, Any] | None = None
        output_text_payload: str | None = None
        finish_reason: str | None = None
        output_files: list[File] = []  # Track files produced by tools
        terminal_output_seen = False

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
            # On last iteration, restrict tools to output tools
            if iteration_step == max_iterations:
                current_tools = [tool for tool in prompt_tools if tool.name in available_output_tool_names]
            else:
                current_tools = prompt_tools
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
                tools=current_tools,
                stop=stop,
                stream=False,
                user=self.context.user_id,
                callbacks=[],
            )

            # Process response
            tool_calls, response_content, chunk_finish_reason = yield from self._handle_chunks(
                chunks, round_usage, model_log, emit_chunks=False
            )

            if not tool_calls:
                if not allow_illegal_output:
                    raise ValueError("Model did not call any tools")
                tool_calls = [
                    (
                        str(uuid.uuid4()),
                        ILLEGAL_OUTPUT_TOOL,
                        {
                            "raw": response_content,
                        },
                    )
                ]
                response_content = ""

            messages.append(self._create_assistant_message("", tool_calls))

            # Accumulate to total usage
            round_usage_value = round_usage.get("usage")
            if round_usage_value:
                self._accumulate_usage(total_usage, round_usage_value)

            # Update finish reason
            if chunk_finish_reason:
                finish_reason = chunk_finish_reason

            # Process tool calls
            tool_outputs: dict[str, str] = {}
            if tool_calls:
                function_call_state = True
                terminal_tool_seen = False
                # Execute tools
                for tool_call_id, tool_name, tool_args in tool_calls:
                    if tool_name == OUTPUT_TEXT_TOOL:
                        output_text_payload = self._format_output_text(tool_args.get("text"))
                    elif tool_name == FINAL_STRUCTURED_OUTPUT_TOOL:
                        data = tool_args.get("data")
                        structured_output_payload = cast(dict[str, Any] | None, data)
                        if tool_name == terminal_tool_name:
                            terminal_tool_seen = True
                    elif tool_name == FINAL_OUTPUT_TOOL:
                        final_text = self._format_output_text(tool_args.get("text"))
                        if tool_name == terminal_tool_name:
                            terminal_tool_seen = True

                    tool_response, tool_files, _ = yield from self._handle_tool_call(
                        tool_name, tool_args, tool_call_id, messages, round_log
                    )
                    tool_outputs[tool_name] = tool_response
                    # Track files produced by tools
                    output_files.extend(tool_files)

                if terminal_tool_seen:
                    terminal_output_seen = True
                    function_call_state = False
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

        output_payload: str | AgentResult.StructuredOutput
        if terminal_tool_name == FINAL_STRUCTURED_OUTPUT_TOOL and terminal_output_seen:
            output_payload = AgentResult.StructuredOutput(
                output_kind=AgentOutputKind.FINAL_STRUCTURED_OUTPUT,
                output_text=None,
                output_data=structured_output_payload,
            )
        elif final_text:
            output_payload = AgentResult.StructuredOutput(
                output_kind=AgentOutputKind.FINAL_OUTPUT_ANSWER,
                output_text=final_text,
                output_data=structured_output_payload,
            )
        elif output_text_payload:
            output_payload = AgentResult.StructuredOutput(
                output_kind=AgentOutputKind.OUTPUT_TEXT,
                output_text=str(output_text_payload),
                output_data=None,
            )
        else:
            output_payload = AgentResult.StructuredOutput(
                output_kind=AgentOutputKind.ILLEGAL_OUTPUT,
                output_text="Model failed to produce a final output.",
                output_data=None,
            )

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
