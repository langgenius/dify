"""ReAct strategy implementation."""

from __future__ import annotations

import json
from collections.abc import Generator
from typing import TYPE_CHECKING, Any

from core.agent.entities import AgentLog, AgentResult, AgentScratchpadUnit, ExecutionContext
from core.agent.output_parser.cot_output_parser import CotAgentOutputParser
from core.agent.output_tools import (
    FINAL_OUTPUT_TOOL,
    FINAL_STRUCTURED_OUTPUT_TOOL,
    ILLEGAL_OUTPUT_TOOL,
    OUTPUT_TEXT_TOOL,
    OUTPUT_TOOL_NAME_SET,
)
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
        self, prompt_messages: list[PromptMessage], model_parameters: dict[str, Any], stop: list[str]
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
        tool_instance_names = {tool.entity.identity.name for tool in self.tools}
        available_output_tool_names = {
            tool_name
            for tool_name in tool_instance_names
            if tool_name in OUTPUT_TOOL_NAME_SET and tool_name != ILLEGAL_OUTPUT_TOOL
        }
        if FINAL_STRUCTURED_OUTPUT_TOOL in available_output_tool_names:
            terminal_tool_name = FINAL_STRUCTURED_OUTPUT_TOOL
        elif FINAL_OUTPUT_TOOL in available_output_tool_names:
            terminal_tool_name = FINAL_OUTPUT_TOOL
        else:
            raise ValueError("No terminal output tool configured")
        allow_illegal_output = ILLEGAL_OUTPUT_TOOL in tool_instance_names

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
                data={},
            )
            yield round_log

            # Build prompt with tool restrictions on last iteration
            if iteration_step == max_iterations:
                tools_for_prompt = [
                    tool for tool in self.tools if tool.entity.identity.name in available_output_tool_names
                ]
            else:
                tools_for_prompt = [tool for tool in self.tools if tool.entity.identity.name != ILLEGAL_OUTPUT_TOOL]
            current_messages = self._build_prompt_with_react_format(
                prompt_messages, agent_scratchpad, tools_for_prompt, self.instruction
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
            chunks = self.model_instance.invoke_llm(
                prompt_messages=messages_to_use,
                model_parameters=model_parameters,
                stop=stop,
                stream=False,
                user=self.context.user_id or "",
                callbacks=[],
            )

            # Process response
            scratchpad, chunk_finish_reason = yield from self._handle_chunks(
                chunks, round_usage, model_log, current_messages, emit_chunks=False
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
            if scratchpad.action is None:
                if not allow_illegal_output:
                    raise ValueError("Model did not call any tools")
                illegal_action = AgentScratchpadUnit.Action(
                    action_name=ILLEGAL_OUTPUT_TOOL,
                    action_input={"raw": scratchpad.thought or ""},
                )
                scratchpad.action = illegal_action
                scratchpad.action_str = illegal_action.model_dump_json()
                react_state = True
                observation, tool_files = yield from self._handle_tool_call(illegal_action, current_messages, round_log)
                scratchpad.observation = observation
                output_files.extend(tool_files)
            else:
                action_name = scratchpad.action.action_name
                if action_name == OUTPUT_TEXT_TOOL and isinstance(scratchpad.action.action_input, dict):
                    pass  # output_text_payload = scratchpad.action.action_input.get("text")
                elif action_name == FINAL_STRUCTURED_OUTPUT_TOOL and isinstance(scratchpad.action.action_input, dict):
                    data = scratchpad.action.action_input.get("data")
                    if isinstance(data, dict):
                        pass  # structured_output_payload = data
                elif action_name == FINAL_OUTPUT_TOOL:
                    if isinstance(scratchpad.action.action_input, dict):
                        final_text = self._format_output_text(scratchpad.action.action_input.get("text"))
                    else:
                        final_text = self._format_output_text(scratchpad.action.action_input)

                observation, tool_files = yield from self._handle_tool_call(
                    scratchpad.action, current_messages, round_log
                )
                scratchpad.observation = observation
                output_files.extend(tool_files)

                if action_name == terminal_tool_name:
                    pass  # terminal_output_seen = True
                    react_state = False
                else:
                    react_state = True

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

        output_payload: str | dict

        # TODO

        return AgentResult(
            output=output_payload,
            files=output_files,
            usage=total_usage.get("usage"),
            finish_reason=finish_reason,
        )

    def _build_prompt_with_react_format(
        self,
        original_messages: list[PromptMessage],
        agent_scratchpad: list[AgentScratchpadUnit],
        tools: list[Tool] | None,
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
                if tools:
                    # Convert tools to prompt message tools format
                    prompt_tools = [
                        tool.to_prompt_message_tool()
                        for tool in tools
                        if tool.entity.identity.name != ILLEGAL_OUTPUT_TOOL
                    ]
                    tool_names = [tool.name for tool in prompt_tools]

                    # Format tools as JSON for comprehensive information
                    from core.model_runtime.utils.encoders import jsonable_encoder

                    tools_str = json.dumps(jsonable_encoder(prompt_tools), indent=2)
                    tool_names_str = ", ".join(f'"{name}"' for name in tool_names)
                else:
                    tools_str = "No tools available"
                    tool_names_str = ""

                final_tool_name = FINAL_OUTPUT_TOOL
                if FINAL_STRUCTURED_OUTPUT_TOOL in tool_names:
                    final_tool_name = FINAL_STRUCTURED_OUTPUT_TOOL
                if final_tool_name not in tool_names:
                    raise ValueError("No terminal output tool available for prompt")

                # Replace placeholders in the existing system prompt
                updated_content = msg.content
                assert isinstance(updated_content, str)
                updated_content = updated_content.replace("{{instruction}}", instruction)
                updated_content = updated_content.replace("{{tools}}", tools_str)
                updated_content = updated_content.replace("{{tool_names}}", tool_names_str)
                updated_content = updated_content.replace("{{final_tool_name}}", final_tool_name)

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
        chunks: LLMResult,
        llm_usage: dict[str, Any],
        model_log: AgentLog,
        current_messages: list[PromptMessage],
        *,
        emit_chunks: bool,
    ) -> Generator[
        LLMResultChunk | AgentLog,
        None,
        tuple[AgentScratchpadUnit, str | None],
    ]:
        """Handle LLM response chunks and extract action/thought.

        Returns a tuple of (scratchpad_unit, finish_reason).
        """
        usage_dict: dict[str, Any] = {}

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

                if emit_chunks:
                    yield self._create_text_chunk(json.dumps(chunk.model_dump()), current_messages)
            elif isinstance(chunk, str):
                # Text chunk
                chunk_text = str(chunk)
                scratchpad.agent_response = (scratchpad.agent_response or "") + chunk_text
                scratchpad.thought = (scratchpad.thought or "") + chunk_text

                if emit_chunks:
                    yield self._create_text_chunk(chunk_text, current_messages)
            else:
                raise ValueError(f"Unexpected chunk type: {type(chunk)}")

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

    @staticmethod
    def _format_output_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False)

    def _handle_tool_call(
        self,
        action: AgentScratchpadUnit.Action,
        prompt_messages: list[PromptMessage],
        round_log: AgentLog,
    ) -> Generator[AgentLog, None, tuple[str, list[File]]]:
        """Handle tool call and return observation with files."""
        tool_name = action.action_name
        tool_args: dict[str, Any] | str = action.action_input

        # Find tool instance first to get metadata
        tool_instance = self._find_tool_by_name(tool_name)
        tool_metadata = self._get_tool_metadata(tool_instance) if tool_instance else {}

        # Start tool log with tool metadata
        tool_log = self._create_log(
            label=f"CALL {tool_name}",
            log_type=AgentLog.LogType.TOOL_CALL,
            status=AgentLog.LogStatus.START,
            data={
                "tool_name": tool_name,
                "tool_args": tool_args,
            },
            parent_id=round_log.id,
            extra_metadata=tool_metadata,
        )
        yield tool_log

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

        # Invoke tool using base class method with error handling
        try:
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
        except Exception as e:
            # Tool invocation failed, yield error log
            error_message = str(e)
            tool_log.status = AgentLog.LogStatus.ERROR
            tool_log.error = error_message
            tool_log.data = {
                **tool_log.data,
                "error": error_message,
            }
            yield tool_log

            return f"Tool execution failed: {error_message}", []
