import json
import time
from collections.abc import Generator, Mapping
from typing import Any, Optional, cast

from dify_plugin.entities.agent import AgentInvokeMessage
from dify_plugin.entities.model.llm import LLMModelConfig, LLMUsage
from dify_plugin.entities.model.message import (
    AssistantPromptMessage,
    PromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)
from dify_plugin.entities.tool import (
    LogMetadata,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from dify_plugin.interfaces.agent import (
    AgentModelConfig,
    AgentScratchpadUnit,
    AgentStrategy,
    ToolEntity,
)
from output_parser.cot_output_parser import CotAgentOutputParser
from prompt.template import REACT_PROMPT_TEMPLATES
from pydantic import BaseModel, Field

ignore_observation_providers = ["wenxin"]


class ReActParams(BaseModel):
    query: str
    instruction: str | None
    model: AgentModelConfig
    tools: list[ToolEntity] | None
    inputs: dict[str, Any] = {}
    maximum_iterations: int = 3


class AgentPromptEntity(BaseModel):
    """
    Agent Prompt Entity.
    """

    first_prompt: str
    next_iteration: str


class ToolInvokeMeta(BaseModel):
    """
    Tool invoke meta
    """

    time_cost: float = Field(..., description="The time cost of the tool invoke")
    error: Optional[str] = None
    tool_config: Optional[dict] = None

    @classmethod
    def empty(cls) -> "ToolInvokeMeta":
        """
        Get an empty instance of ToolInvokeMeta
        """
        return cls(time_cost=0.0, error=None, tool_config={})

    @classmethod
    def error_instance(cls, error: str) -> "ToolInvokeMeta":
        """
        Get an instance of ToolInvokeMeta with error
        """
        return cls(time_cost=0.0, error=error, tool_config={})

    def to_dict(self) -> dict:
        return {
            "time_cost": self.time_cost,
            "error": self.error,
            "tool_config": self.tool_config,
        }


class ReActAgentStrategy(AgentStrategy):
    def _invoke(self, parameters: dict[str, Any]) -> Generator[AgentInvokeMessage]:
        react_params = ReActParams(**parameters)
        query = react_params.query
        model = react_params.model
        agent_scratchpad = []
        history_prompt_messages: list[PromptMessage] = []
        current_session_messages = []
        self._organize_historic_prompt_messages(
            history_prompt_messages, current_session_messages=current_session_messages
        )
        tools = react_params.tools
        tool_instances = {tool.identity.name: tool for tool in tools} if tools else {}
        react_params.model.completion_params = (
            react_params.model.completion_params or {}
        )
        # check model mode
        stop = (
            react_params.model.completion_params.get("stop", [])
            if react_params.model.completion_params
            else []
        )

        if (
            "Observation" not in stop
            and model.provider not in ignore_observation_providers
        ):
            stop.append("Observation")
        # init instruction
        inputs = react_params.inputs
        instruction = react_params.instruction or ""
        self._instruction = self._fill_in_inputs_from_external_data_tools(
            instruction, inputs
        )

        iteration_step = 1
        max_iteration_steps = react_params.maximum_iterations

        # convert tools into ModelRuntime Tool format
        prompt_messages_tools = self._init_prompt_tools(tools)
        self._prompt_messages_tools = prompt_messages_tools

        run_agent_state = True
        llm_usage: dict[str, Optional[LLMUsage]] = {"usage": None}
        final_answer = ""
        prompt_messages = []
        while run_agent_state and iteration_step <= max_iteration_steps:
            # continue to run until there is not any tool call
            run_agent_state = False
            round_started_at = time.perf_counter()
            round_log = self.create_log_message(
                label=f"ROUND {iteration_step}",
                data={},
                metadata={
                    LogMetadata.STARTED_AT: round_started_at,
                },
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
            )
            yield round_log
            if iteration_step == max_iteration_steps:
                # the last iteration, remove all tools
                self._prompt_messages_tools = []

            message_file_ids: list[str] = []

            # recalc llm max tokens
            prompt_messages = self._organize_prompt_messages(agent_scratchpad, query)
            if model.completion_params:
                self.recalc_llm_max_tokens(
                    model.entity, prompt_messages, model.completion_params
                )
            # invoke model
            chunks = self.session.model.llm.invoke(
                model_config=LLMModelConfig(**model.model_dump(mode="json")),
                prompt_messages=prompt_messages,
                stream=True,
                stop=stop,
            )

            usage_dict = {}
            react_chunks = CotAgentOutputParser.handle_react_stream_output(
                chunks, usage_dict
            )
            scratchpad = AgentScratchpadUnit(
                agent_response="",
                thought="",
                action_str="",
                observation="",
                action=None,
            )

            model_started_at = time.perf_counter()
            model_log = self.create_log_message(
                label=f"{model.model} Thought",
                data={},
                metadata={
                    LogMetadata.STARTED_AT: model_started_at,
                    LogMetadata.PROVIDER: model.provider,
                },
                parent=round_log,
                status=ToolInvokeMessage.LogMessage.LogStatus.START,
            )
            yield model_log

            for chunk in react_chunks:
                if isinstance(chunk, AgentScratchpadUnit.Action):
                    action = chunk
                    # detect action
                    assert scratchpad.agent_response is not None
                    scratchpad.agent_response += json.dumps(chunk.model_dump())

                    scratchpad.action_str = json.dumps(chunk.model_dump())
                    scratchpad.action = action
                else:
                    scratchpad.agent_response = scratchpad.agent_response or ""
                    scratchpad.thought = scratchpad.thought or ""
                    scratchpad.agent_response += chunk
                    scratchpad.thought += chunk
            scratchpad.thought = (
                scratchpad.thought.strip()
                if scratchpad.thought
                else "I am thinking about how to help you"
            )
            agent_scratchpad.append(scratchpad)

            # get llm usage
            if "usage" in usage_dict:
                if usage_dict["usage"] is not None:
                    self.increase_usage(llm_usage, usage_dict["usage"])
            else:
                usage_dict["usage"] = LLMUsage.empty_usage()

            action = (
                scratchpad.action.to_dict()
                if scratchpad.action
                else {"action": scratchpad.agent_response}
            )

            yield self.finish_log_message(
                log=model_log,
                data={"thought": scratchpad.thought, **action},
                metadata={
                    LogMetadata.STARTED_AT: model_started_at,
                    LogMetadata.FINISHED_AT: time.perf_counter(),
                    LogMetadata.ELAPSED_TIME: time.perf_counter() - model_started_at,
                    LogMetadata.PROVIDER: model.provider,
                    LogMetadata.TOTAL_PRICE: usage_dict["usage"].total_price
                    if usage_dict["usage"]
                    else 0,
                    LogMetadata.CURRENCY: usage_dict["usage"].currency
                    if usage_dict["usage"]
                    else "",
                    LogMetadata.TOTAL_TOKENS: usage_dict["usage"].total_tokens
                    if usage_dict["usage"]
                    else 0,
                },
            )
            if not scratchpad.action:
                final_answer = scratchpad.thought
            else:
                if scratchpad.action.action_name.lower() == "final answer":
                    # action is final answer, return final answer directly
                    try:
                        if isinstance(scratchpad.action.action_input, dict):
                            final_answer = json.dumps(scratchpad.action.action_input)
                        elif isinstance(scratchpad.action.action_input, str):
                            final_answer = scratchpad.action.action_input
                        else:
                            final_answer = f"{scratchpad.action.action_input}"
                    except json.JSONDecodeError:
                        final_answer = f"{scratchpad.action.action_input}"
                else:
                    run_agent_state = True
                    # action is tool call, invoke tool
                    tool_call_started_at = time.perf_counter()
                    tool_name = scratchpad.action.action_name
                    tool_call_log = self.create_log_message(
                        label=f"CALL {tool_name}",
                        data={},
                        metadata={
                            LogMetadata.STARTED_AT: time.perf_counter(),
                            LogMetadata.PROVIDER: tool_instances[
                                tool_name
                            ].identity.provider
                            if tool_instances.get(tool_name)
                            else "",
                        },
                        parent=round_log,
                        status=ToolInvokeMessage.LogMessage.LogStatus.START,
                    )
                    yield tool_call_log
                    tool_invoke_response, tool_invoke_parameters = (
                        self._handle_invoke_action(
                            action=scratchpad.action,
                            tool_instances=tool_instances,
                            message_file_ids=message_file_ids,
                        )
                    )
                    scratchpad.observation = tool_invoke_response
                    scratchpad.agent_response = tool_invoke_response
                    yield self.finish_log_message(
                        log=tool_call_log,
                        data={
                            "tool_name": tool_name,
                            "tool_call_args": tool_invoke_parameters,
                            "output": tool_invoke_response,
                        },
                        metadata={
                            LogMetadata.STARTED_AT: tool_call_started_at,
                            LogMetadata.PROVIDER: tool_instances[
                                tool_name
                            ].identity.provider
                            if tool_instances.get(tool_name)
                            else "",
                            LogMetadata.FINISHED_AT: time.perf_counter(),
                            LogMetadata.ELAPSED_TIME: time.perf_counter()
                            - tool_call_started_at,
                        },
                    )

                # update prompt tool message
                for prompt_tool in self._prompt_messages_tools:
                    self.update_prompt_message_tool(
                        tool_instances[prompt_tool.name], prompt_tool
                    )
            yield self.finish_log_message(
                log=round_log,
                data={
                    "action_name": scratchpad.action.action_name
                    if scratchpad.action
                    else "",
                    "action_input": scratchpad.action.action_input
                    if scratchpad.action
                    else "",
                    "thought": scratchpad.thought,
                    "observation": scratchpad.observation,
                },
                metadata={
                    LogMetadata.STARTED_AT: round_started_at,
                    LogMetadata.FINISHED_AT: time.perf_counter(),
                    LogMetadata.ELAPSED_TIME: time.perf_counter() - round_started_at,
                    LogMetadata.TOTAL_PRICE: usage_dict["usage"].total_price
                    if usage_dict["usage"]
                    else 0,
                    LogMetadata.CURRENCY: usage_dict["usage"].currency
                    if usage_dict["usage"]
                    else "",
                    LogMetadata.TOTAL_TOKENS: usage_dict["usage"].total_tokens
                    if usage_dict["usage"]
                    else 0,
                },
            )
            iteration_step += 1

        yield self.create_text_message(final_answer)
        yield self.create_json_message(
            {
                "execution_metadata": {
                    LogMetadata.TOTAL_PRICE: llm_usage["usage"].total_price
                    if llm_usage["usage"] is not None
                    else 0,
                    LogMetadata.CURRENCY: llm_usage["usage"].currency
                    if llm_usage["usage"] is not None
                    else "",
                    LogMetadata.TOTAL_TOKENS: llm_usage["usage"].total_tokens
                    if llm_usage["usage"] is not None
                    else 0,
                }
            }
        )

    def _organize_system_prompt(self) -> SystemPromptMessage:
        """
        Organize system prompt
        """

        prompt_entity = AgentPromptEntity(
            first_prompt=REACT_PROMPT_TEMPLATES["english"]["chat"]["prompt"],
            next_iteration=REACT_PROMPT_TEMPLATES["english"]["chat"][
                "agent_scratchpad"
            ],
        )
        if not prompt_entity:
            raise ValueError("Agent prompt configuration is not set")
        first_prompt = prompt_entity.first_prompt

        system_prompt = (
            first_prompt.replace("{{instruction}}", self._instruction)
            .replace(
                "{{tools}}",
                json.dumps(
                    [
                        tool.model_dump(mode="json")
                        for tool in self._prompt_messages_tools
                    ]
                ),
            )
            .replace(
                "{{tool_names}}",
                ", ".join([tool.name for tool in self._prompt_messages_tools]),
            )
        )

        return SystemPromptMessage(content=system_prompt)

    def _organize_user_query(
        self, query, prompt_messages: list[PromptMessage]
    ) -> list[PromptMessage]:
        """
        Organize user query
        """
        prompt_messages.append(UserPromptMessage(content=query))

        return prompt_messages

    def _organize_prompt_messages(
        self, agent_scratchpad: list, query: str
    ) -> list[PromptMessage]:
        """
        Organize
        """
        # organize system prompt
        system_message = self._organize_system_prompt()

        # organize current assistant messages
        agent_scratchpad = agent_scratchpad
        if not agent_scratchpad:
            assistant_messages = []
        else:
            assistant_message = AssistantPromptMessage(content="")
            assistant_message.content = (
                ""  # FIXME: type check tell mypy that assistant_message.content is str
            )
            for unit in agent_scratchpad:
                if unit.is_final():
                    assert isinstance(assistant_message.content, str)
                    assistant_message.content += f"Final Answer: {unit.agent_response}"
                else:
                    assert isinstance(assistant_message.content, str)
                    assistant_message.content += f"Thought: {unit.thought}\n\n"
                    if unit.action_str:
                        assistant_message.content += f"Action: {unit.action_str}\n\n"
                    if unit.observation:
                        assistant_message.content += (
                            f"Observation: {unit.observation}\n\n"
                        )

            assistant_messages = [assistant_message]

        # query messages
        query_messages = self._organize_user_query(query, [])

        if assistant_messages:
            # organize historic prompt messages
            historic_messages = self._organize_historic_prompt_messages(
                [
                    system_message,
                    *query_messages,
                    *assistant_messages,
                    UserPromptMessage(content="continue"),
                ]
            )
            messages = [
                system_message,
                *historic_messages,
                *query_messages,
                *assistant_messages,
                UserPromptMessage(content="continue"),
            ]
        else:
            # organize historic prompt messages
            historic_messages = self._organize_historic_prompt_messages(
                [system_message, *query_messages]
            )
            messages = [system_message, *historic_messages, *query_messages]

        # join all messages
        return messages

    def _handle_invoke_action(
        self,
        action: AgentScratchpadUnit.Action,
        tool_instances: Mapping[str, ToolEntity],
        message_file_ids: list[str],
    ) -> tuple[str, dict[str, Any] | str]:
        """
        handle invoke action
        :param action: action
        :param tool_instances: tool instances
        :param message_file_ids: message file ids
        :param trace_manager: trace manager
        :return: observation, meta
        """
        # action is tool call, invoke tool
        tool_call_name = action.action_name
        tool_call_args = action.action_input
        tool_instance = tool_instances.get(tool_call_name)

        if not tool_instance:
            answer = f"there is not a tool named {tool_call_name}"
            return answer, tool_call_args

        if isinstance(tool_call_args, str):
            try:
                tool_call_args = json.loads(tool_call_args)
            except json.JSONDecodeError as e:
                params = [
                    param.name
                    for param in tool_instance.parameters
                    if param.form == ToolParameter.ToolParameterForm.LLM
                ]
                if len(params) > 1:
                    raise ValueError("tool call args is not a valid json string") from e
                tool_call_args = {params[0]: tool_call_args} if len(params) == 1 else {}

        tool_invoke_parameters = {**tool_instance.runtime_parameters, **tool_call_args}
        try:
            tool_invoke_responses = self.session.tool.invoke(
                provider_type=ToolProviderType(tool_instance.provider_type),
                provider=tool_instance.identity.provider,
                tool_name=tool_instance.identity.name,
                parameters=tool_invoke_parameters,
            )
            result = ""
            for response in tool_invoke_responses:
                if response.type == ToolInvokeMessage.MessageType.TEXT:
                    result += cast(ToolInvokeMessage.TextMessage, response.message).text
                elif response.type == ToolInvokeMessage.MessageType.LINK:
                    result += (
                        f"result link: {cast(ToolInvokeMessage.TextMessage, response.message).text}."
                        + " please tell user to check it."
                    )
                elif response.type in {
                    ToolInvokeMessage.MessageType.IMAGE_LINK,
                    ToolInvokeMessage.MessageType.IMAGE,
                }:
                    result += (
                        "image has been created and sent to user already, "
                        + "you do not need to create it, just tell the user to check it now."
                    )
                elif response.type == ToolInvokeMessage.MessageType.JSON:
                    text = json.dumps(
                        cast(
                            ToolInvokeMessage.JsonMessage, response.message
                        ).json_object,
                        ensure_ascii=False,
                    )
                    result += f"tool response: {text}."
                else:
                    result += f"tool response: {response.message!r}."
        except Exception as e:
            result = f"tool invoke error: {str(e)}"

        return result, tool_invoke_parameters

    def _convert_dict_to_action(self, action: dict) -> AgentScratchpadUnit.Action:
        """
        convert dict to action
        """
        return AgentScratchpadUnit.Action(
            action_name=action["action"], action_input=action["action_input"]
        )

    def _fill_in_inputs_from_external_data_tools(
        self, instruction: str, inputs: Mapping[str, Any]
    ) -> str:
        """
        fill in inputs from external data tools
        """
        for key, value in inputs.items():
            try:
                instruction = instruction.replace(f"{{{{{key}}}}}", str(value))
            except Exception:
                continue

        return instruction

    def _format_assistant_message(
        self, agent_scratchpad: list[AgentScratchpadUnit]
    ) -> str:
        """
        format assistant message
        """
        message = ""
        for scratchpad in agent_scratchpad:
            if scratchpad.is_final():
                message += f"Final Answer: {scratchpad.agent_response}"
            else:
                message += f"Thought: {scratchpad.thought}\n\n"
                if scratchpad.action_str:
                    message += f"Action: {scratchpad.action_str}\n\n"
                if scratchpad.observation:
                    message += f"Observation: {scratchpad.observation}\n\n"

        return message

    def _organize_historic_prompt_messages(
        self,
        history_prompt_messages: list[PromptMessage],
        current_session_messages: list[PromptMessage] | None = None,
    ) -> list[PromptMessage]:
        """
        organize historic prompt messages
        """
        result: list[PromptMessage] = []
        scratchpads: list[AgentScratchpadUnit] = []
        current_scratchpad: AgentScratchpadUnit | None = None

        for message in history_prompt_messages:
            if isinstance(message, AssistantPromptMessage):
                if not current_scratchpad:
                    assert isinstance(message.content, str)
                    current_scratchpad = AgentScratchpadUnit(
                        agent_response=message.content,
                        thought=message.content
                        or "I am thinking about how to help you",
                        action_str="",
                        action=None,
                        observation=None,
                    )
                    scratchpads.append(current_scratchpad)
                if message.tool_calls:
                    try:
                        current_scratchpad.action = AgentScratchpadUnit.Action(
                            action_name=message.tool_calls[0].function.name,
                            action_input=json.loads(
                                message.tool_calls[0].function.arguments
                            ),
                        )
                        current_scratchpad.action_str = json.dumps(
                            current_scratchpad.action.to_dict()
                        )
                    except Exception:
                        pass
            elif isinstance(message, ToolPromptMessage):
                if current_scratchpad:
                    assert isinstance(message.content, str)
                    current_scratchpad.observation = message.content
                else:
                    raise NotImplementedError("expected str type")
            elif isinstance(message, UserPromptMessage):
                if scratchpads:
                    result.append(
                        AssistantPromptMessage(
                            content=self._format_assistant_message(scratchpads)
                        )
                    )
                    scratchpads = []
                    current_scratchpad = None

                result.append(message)

        if scratchpads:
            result.append(
                AssistantPromptMessage(
                    content=self._format_assistant_message(scratchpads)
                )
            )

        return current_session_messages or []
