"""ReAct strategy implementation."""

from __future__ import annotations

import json
from collections.abc import Generator
from typing import TYPE_CHECKING, Any, Union

from core.agent.entities import AgentLog, AgentResult, AgentScratchpadUnit, ExecutionContext
from core.agent.output_parser.cot_output_parser import CotAgentOutputParser
from core.file import File
from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    PromptMessage,
    SystemPromptMessage,
)

from .base import AgentPattern, ToolInvokeHook

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool


class ReActStrategy(AgentPattern):
    """ReAct strategy using reasoning and acting approach."""

    def __init__(
        self,
        model_instance: ModelInstance,
        tools: list[Tool],
        context: ExecutionContext,
        max_iterations: int = 10,
        workflow_call_depth: int = 0,
        files: list[File] = [],
        tool_invoke_hook: ToolInvokeHook | None = None,
        instruction: str = "",
    ):
        """Initialize the ReAct strategy with instruction support."""
        super().__init__(
            model_instance=model_instance,
            tools=tools,
            context=context,
            max_iterations=max_iterations,
            workflow_call_depth=workflow_call_depth,
            files=files,
            tool_invoke_hook=tool_invoke_hook,
        )
        self.instruction = instruction

    def run(
        self,
        prompt_messages: list[PromptMessage],
        model_parameters: dict[str, Any],
        stop: list[str] = [],
        stream: bool = True,
    ) -> Generator[LLMResultChunk | AgentLog, None, AgentResult]:
        """Execute the ReAct agent strategy."""
        # Initialize tracking
        agent_scratchpad: list[AgentScratchpadUnit] = []
        iteration_step: int = 1
        max_iterations: int = self.max_iterations + 1
        react_state: bool = True
        total_usage: dict[str, Any] = {"usage": None}
        output_files: list[File] = []  # Track files produced by tools
        final_text: str = ""
        finish_reason: str | None = None

        # Add "Observation" to stop sequences
        if "Observation" not in stop:
            stop = stop.copy()
            stop.append("Observation")

        while react_state and iteration_step <= max_iterations:
            react_state = False
            round_log = self._create_log(
                label=f"ROUND {iteration_step}",
                log_type=AgentLog.LogType.ROUND,
                status=AgentLog.LogStatus.START,
                data={"round_index": iteration_step},
            )
            yield round_log

            # Build prompt with/without tools based on iteration
            include_tools = iteration_step < max_iterations
            current_messages = self._build_prompt_with_react_format(
                prompt_messages, agent_scratchpad, include_tools, self.instruction
            )

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
            round_usage: dict[str, Any] = {"usage": None}

            # Use current messages directly (files are handled by base class if needed)
            messages_to_use = current_messages

            # Invoke model
            chunks: Union[Generator[LLMResultChunk, None, None], LLMResult] = self.model_instance.invoke_llm(
                prompt_messages=messages_to_use,
                model_parameters=model_parameters,
                stop=stop,
                stream=stream,
                user=self.context.user_id or "",
                callbacks=[],
            )

            # Process response
            scratchpad, chunk_finish_reason = yield from self._handle_chunks(
                chunks, round_usage, model_log, current_messages
            )
            agent_scratchpad.append(scratchpad)

            # Accumulate to total usage
            round_usage_value = round_usage.get("usage")
            if round_usage_value:
                self._accumulate_usage(total_usage, round_usage_value)

            # Update finish reason
            if chunk_finish_reason:
                finish_reason = chunk_finish_reason

            # Check if we have an action to execute
            if scratchpad.action and scratchpad.action.action_name.lower() != "final answer":
                react_state = True
                # Execute tool
                observation, tool_files = yield from self._handle_tool_call(
                    scratchpad.action, current_messages, round_log
                )
                scratchpad.observation = observation
                # Track files produced by tools
                output_files.extend(tool_files)

                # Add observation to scratchpad for display
                yield self._create_text_chunk(f"\nObservation: {observation}\n", current_messages)
            else:
                # Extract final answer
                if scratchpad.action and scratchpad.action.action_input:
                    final_answer = scratchpad.action.action_input
                    if isinstance(final_answer, dict):
                        final_answer = json.dumps(final_answer, ensure_ascii=False)
                    final_text = str(final_answer)
                elif scratchpad.thought:
                    # If no action but we have thought, use thought as final answer
                    final_text = scratchpad.thought

            yield self._finish_log(
                round_log,
                data={
                    "thought": scratchpad.thought,
                    "action": scratchpad.action_str if scratchpad.action else None,
                    "observation": scratchpad.observation or None,
                    "final_answer": final_text if not react_state else None,
                },
                usage=round_usage.get("usage"),
            )
            iteration_step += 1

        # Return final result

        from core.agent.entities import AgentResult

        return AgentResult(
            text=final_text, files=output_files, usage=total_usage.get("usage"), finish_reason=finish_reason
        )

    def _build_prompt_with_react_format(
        self,
        original_messages: list[PromptMessage],
        agent_scratchpad: list[AgentScratchpadUnit],
        include_tools: bool = True,
        instruction: str = "",
    ) -> list[PromptMessage]:
        """Build prompt messages with ReAct format."""
        # Copy messages to avoid modifying original
        messages = list(original_messages)

        # Find and update the system prompt that should already exist
        system_prompt_found = False
        for i, msg in enumerate(messages):
            if isinstance(msg, SystemPromptMessage):
                system_prompt_found = True
                # The system prompt from frontend already has the template, just replace placeholders

                # Format tools
                tools_str = ""
                tool_names = []
                if include_tools and self.tools:
                    # Convert tools to prompt message tools format
                    prompt_tools = [tool.to_prompt_message_tool() for tool in self.tools]
                    tool_names = [tool.name for tool in prompt_tools]

                    # Format tools as JSON for comprehensive information
                    from core.model_runtime.utils.encoders import jsonable_encoder

                    tools_str = json.dumps(jsonable_encoder(prompt_tools), indent=2)
                    tool_names_str = ", ".join(f'"{name}"' for name in tool_names)
                else:
                    tools_str = "No tools available"
                    tool_names_str = ""

                # Replace placeholders in the existing system prompt
                updated_content = msg.content
                assert isinstance(updated_content, str)
                updated_content = updated_content.replace("{{instruction}}", instruction)
                updated_content = updated_content.replace("{{tools}}", tools_str)
                updated_content = updated_content.replace("{{tool_names}}", tool_names_str)

                # Create new SystemPromptMessage with updated content
                messages[i] = SystemPromptMessage(content=updated_content)
                break

        # If no system prompt found, that's unexpected but add scratchpad anyway
        if not system_prompt_found:
            # This shouldn't happen if frontend is working correctly
            pass

        # Format agent scratchpad
        scratchpad_str = ""
        if agent_scratchpad:
            scratchpad_parts: list[str] = []
            for unit in agent_scratchpad:
                if unit.thought:
                    scratchpad_parts.append(f"Thought: {unit.thought}")
                if unit.action_str:
                    scratchpad_parts.append(f"Action:\n```\n{unit.action_str}\n```")
                if unit.observation:
                    scratchpad_parts.append(f"Observation: {unit.observation}")
            scratchpad_str = "\n".join(scratchpad_parts)

        # If there's a scratchpad, append it to the last message
        if scratchpad_str:
            messages.append(AssistantPromptMessage(content=scratchpad_str))

        return messages

    def _handle_chunks(
        self,
        chunks: Union[Generator[LLMResultChunk, None, None], LLMResult],
        llm_usage: dict[str, Any],
        model_log: AgentLog,
        current_messages: list[PromptMessage],
    ) -> Generator[
        LLMResultChunk | AgentLog,
        None,
        tuple[AgentScratchpadUnit, str | None],
    ]:
        """Handle LLM response chunks and extract action/thought.

        Returns a tuple of (scratchpad_unit, finish_reason).
        """
        usage_dict: dict[str, Any] = {}

        # Convert non-streaming to streaming format if needed
        if isinstance(chunks, LLMResult):
            # Create a generator from the LLMResult
            def result_to_chunks() -> Generator[LLMResultChunk, None, None]:
                yield LLMResultChunk(
                    model=chunks.model,
                    prompt_messages=chunks.prompt_messages,
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=chunks.message,
                        usage=chunks.usage,
                        finish_reason=None,  # LLMResult doesn't have finish_reason, only streaming chunks do
                    ),
                    system_fingerprint=chunks.system_fingerprint or "",
                )

            streaming_chunks = result_to_chunks()
        else:
            streaming_chunks = chunks

        react_chunks = CotAgentOutputParser.handle_react_stream_output(streaming_chunks, usage_dict)

        # Initialize scratchpad unit
        scratchpad = AgentScratchpadUnit(
            agent_response="",
            thought="",
            action_str="",
            observation="",
            action=None,
        )

        finish_reason: str | None = None

        # Process chunks
        for chunk in react_chunks:
            if isinstance(chunk, AgentScratchpadUnit.Action):
                # Action detected
                action_str = json.dumps(chunk.model_dump())
                scratchpad.agent_response = (scratchpad.agent_response or "") + action_str
                scratchpad.action_str = action_str
                scratchpad.action = chunk

                yield self._create_text_chunk(json.dumps(chunk.model_dump()), current_messages)
            else:
                # Text chunk
                chunk_text = str(chunk)
                scratchpad.agent_response = (scratchpad.agent_response or "") + chunk_text
                scratchpad.thought = (scratchpad.thought or "") + chunk_text

                yield self._create_text_chunk(chunk_text, current_messages)

        # Update usage
        if usage_dict.get("usage"):
            if llm_usage.get("usage"):
                self._accumulate_usage(llm_usage, usage_dict["usage"])
            else:
                llm_usage["usage"] = usage_dict["usage"]

        # Clean up thought
        scratchpad.thought = (scratchpad.thought or "").strip() or "I am thinking about how to help you"

        # Finish model log
        yield self._finish_log(
            model_log,
            data={
                "thought": scratchpad.thought,
                "action": scratchpad.action_str if scratchpad.action else None,
            },
            usage=llm_usage.get("usage"),
        )

        return scratchpad, finish_reason

    def _handle_tool_call(
        self,
        action: AgentScratchpadUnit.Action,
        prompt_messages: list[PromptMessage],
        round_log: AgentLog,
    ) -> Generator[AgentLog, None, tuple[str, list[File]]]:
        """Handle tool call and return observation with files."""
        tool_name = action.action_name
        tool_args: dict[str, Any] | str = action.action_input

        # Start tool log
        tool_log = self._create_log(
            label=f"CALL {tool_name}",
            log_type=AgentLog.LogType.TOOL_CALL,
            status=AgentLog.LogStatus.START,
            data={
                "tool_name": tool_name,
                "tool_args": tool_args,
            },
            parent_id=round_log.id,
        )
        yield tool_log

        # Find tool instance
        tool_instance = self._find_tool_by_name(tool_name)
        if not tool_instance:
            # Finish tool log with error
            yield self._finish_log(
                tool_log,
                data={
                    **tool_log.data,
                    "error": f"Tool {tool_name} not found",
                },
            )
            return f"Tool {tool_name} not found", []

        # Ensure tool_args is a dict
        tool_args_dict: dict[str, Any]
        if isinstance(tool_args, str):
            try:
                tool_args_dict = json.loads(tool_args)
            except json.JSONDecodeError:
                tool_args_dict = {"input": tool_args}
        elif not isinstance(tool_args, dict):
            tool_args_dict = {"input": str(tool_args)}
        else:
            tool_args_dict = tool_args

        # Invoke tool using base class method
        response_content, tool_files, tool_invoke_meta = self._invoke_tool(tool_instance, tool_args_dict, tool_name)

        # Finish tool log
        yield self._finish_log(
            tool_log,
            data={
                **tool_log.data,
                "output": response_content,
                "files": len(tool_files),
                "meta": tool_invoke_meta.to_dict() if tool_invoke_meta else None,
            },
        )

        return response_content or "Tool executed successfully", tool_files
