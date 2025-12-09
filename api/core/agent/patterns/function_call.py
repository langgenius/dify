"""Function Call strategy implementation."""

import json
from collections.abc import Generator
from typing import Any, Union

from core.agent.entities import AgentLog, AgentResult
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

        # Initialize tracking
        iteration_step: int = 1
        max_iterations: int = self.max_iterations + 1
        function_call_state: bool = True
        total_usage: dict[str, LLMUsage | None] = {"usage": None}
        messages: list[PromptMessage] = list(prompt_messages)  # Create mutable copy
        final_text: str = ""
        finish_reason: str | None = None
        output_files: list[File] = []  # Track files produced by tools

        while function_call_state and iteration_step <= max_iterations:
            function_call_state = False
            round_log = self._create_log(
                label=f"ROUND {iteration_step}",
                log_type=AgentLog.LogType.ROUND,
                status=AgentLog.LogStatus.START,
                data={"round_index": iteration_step},
            )
            yield round_log
            # On last iteration, remove tools to force final answer
            current_tools: list[PromptMessageTool] = [] if iteration_step == max_iterations else prompt_tools
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
                chunks, round_usage, model_log
            )
            messages.append(self._create_assistant_message(response_content, tool_calls))

            # Accumulate to total usage
            round_usage_value = round_usage.get("usage")
            if round_usage_value:
                self._accumulate_usage(total_usage, round_usage_value)

            # Update final text if no tool calls (this is likely the final answer)
            if not tool_calls:
                final_text = response_content

            # Update finish reason
            if chunk_finish_reason:
                finish_reason = chunk_finish_reason

            # Process tool calls
            tool_outputs: dict[str, str] = {}
            if tool_calls:
                function_call_state = True
                # Execute tools
                for tool_call_id, tool_name, tool_args in tool_calls:
                    tool_response, tool_files, _ = yield from self._handle_tool_call(
                        tool_name, tool_args, tool_call_id, messages, round_log
                    )
                    tool_outputs[tool_name] = tool_response
                    # Track files produced by tools
                    output_files.extend(tool_files)
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

        return AgentResult(
            text=final_text,
            files=output_files,
            usage=total_usage.get("usage") or LLMUsage.empty_usage(),
            finish_reason=finish_reason,
        )

    def _handle_chunks(
        self,
        chunks: Union[Generator[LLMResultChunk, None, None], LLMResult],
        llm_usage: dict[str, LLMUsage | None],
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
            usage=llm_usage.get("usage"),
        )
        return tool_calls, response_content, finish_reason

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
        )
        yield tool_call_log

        # Invoke tool using base class method
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
